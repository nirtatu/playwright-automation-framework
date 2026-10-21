import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// Scans a Playwright HTML report for credential patterns before it is published (GitHub Pages).
// It reads the report data embedded in index.html, every attachment, and every ZIP archive
// (traces) inside them. It fails closed: anything it cannot read or does not support is an error.
// Output names the file and the kind of match only, never the matched value. File and ZIP entry
// names are scanned too, and are printed only when they are plain [\w./@-] names.
//
// Limitations: pattern-based, so it cannot prove a report is free of sensitive data. Files whose
// bytes are a recognised image, video or font format are not inspected (metadata inside them is
// not read), and Playwright's own trace-viewer assets (trace/) are not scanned. Small ZIP header
// fields (times, attributes, CRCs, extended timestamps) are checked for structure only.
//
// This module only exports functions; scripts/report-scan-cli.ts is the command-line entry point.

export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

export interface Finding {
  /** Where the match was found, e.g. "data/abc.zip > trace.network". Never contains the value. */
  location: string;
  rule: string;
  count: number;
}

export interface ScanResult {
  findings: Finding[];
  scannedEntries: number;
  skippedMedia: number;
}

// Each rule needs at least one character of an actual value, and ignores values already
// replaced by the framework's redactor ("<redacted>"). \\* allows JSON-escaped quotes.
const RULES: { id: string; pattern: RegExp }[] = [
  { id: 'json-credential', pattern: /\\*"(?:token|password)\\*"\s*:\s*\\*"(?!<redacted>)[^"\\\s]/gi },
  { id: 'token-parameter', pattern: /\btoken=(?!<redacted>)[^\s;"&\\<]/gi },
  { id: 'credential-header', pattern: /\b(?:set-cookie|cookie|authorization)\s*:\s*(?!<redacted>)[^\s"\\<]/gi },
  {
    id: 'har-credential-header',
    pattern: /"name"\s*:\s*"(?:set-cookie|cookie|authorization)"\s*,\s*"value"\s*:\s*"(?!<redacted>)[^"]/gi,
  },
  { id: 'har-cookies', pattern: /"cookies"\s*:\s*\[\s*\{/gi },
];

const MAX_ZIP_DEPTH = 3;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
// The blob must run up to the closing tag, so nothing after a stray character goes unscanned.
const EMBEDDED_REPORT_DATA = /data:application\/zip;base64,([A-Za-z0-9+/=]+)(?=<\/template>)/g;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Labels from ZIP entry names and report paths are printed only when they consist of these
// characters, which cannot form a credential pattern (no "=", ":" or quotes). "@" appears in
// Playwright's own trace names (screencast/page@<id>-<time>.jpeg).
const SAFE_LABEL = /^[\w./@-]{1,200}$/;

/** Counts matches per rule. Returns only rule ids and counts, never the matched text. */
export function scanText(text: string): { rule: string; count: number }[] {
  const results: { rule: string; count: number }[] = [];
  for (const { id, pattern } of RULES) {
    const count = text.match(pattern)?.length ?? 0;
    if (count > 0) results.push({ rule: id, count });
  }
  return results;
}

/**
 * True only when the bytes start with a recognised image, video or font signature (PNG, JPEG, GIF,
 * WebP, WebM/Matroska, MP4, WOFF, WOFF2, OpenType/CFF). File names and extensions are not trusted.
 * Raw TrueType (00 01 00 00) is deliberately not listed: it is too generic to identify media.
 * Callers must also reject media that contains ZIP data (see containsZipSignature).
 */
export function isMedia(data: Buffer): boolean {
  const starts = (bytes: number[], at = 0) => bytes.every((byte, i) => data[at + i] === byte);
  const ascii = (text: string, at = 0) => data.toString('latin1', at, at + text.length) === text;
  return (
    starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    starts([0xff, 0xd8, 0xff]) || // JPEG
    ascii('GIF87a') ||
    ascii('GIF89a') ||
    (ascii('RIFF') && ascii('WEBP', 8)) ||
    starts([0x1a, 0x45, 0xdf, 0xa3]) || // WebM / Matroska
    ascii('ftyp', 4) || // MP4 / ISO base media
    ascii('wOFF') ||
    ascii('wOF2') ||
    ascii('OTTO')
  );
}

const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/** True when the bytes contain a ZIP local-file-header or end-of-central-directory signature. */
export function containsZipSignature(data: Buffer): boolean {
  return data.includes(ZIP_LOCAL_HEADER) || data.includes(ZIP_END_OF_CENTRAL_DIRECTORY);
}

/** Report-wide size budget: bytes are reserved before they are read or inflated into memory. */
export interface ScanBudget {
  reserve(bytes: number): void;
}

/** Creates one budget for a whole report; nested archives and sibling entries all draw from it. */
export function createBudget(limit = MAX_TOTAL_BYTES): ScanBudget {
  let used = 0;
  return {
    reserve(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new ScanError('invalid data size');
      if (bytes > limit - used) throw new ScanError('report is larger than the scan limit');
      used += bytes;
    },
  };
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;
const EXTENDED_TIMESTAMP = 0x5455; // the only extra field Playwright's ZIP writer (yazl) emits

/** Extra fields are not scanned, so only well-formed extended-timestamp fields are accepted. */
function checkExtraField(buffer: Buffer, start: number, length: number) {
  const end = start + length;
  for (let at = start; at < end;) {
    if (at + 4 > end) throw new ScanError('corrupt ZIP extra field');
    const id = buffer.readUInt16LE(at);
    const size = buffer.readUInt16LE(at + 2);
    if (id !== EXTENDED_TIMESTAMP || size > 13) throw new ScanError('unsupported ZIP extra field');
    at += 4 + size;
    if (at > end) throw new ScanError('corrupt ZIP extra field');
  }
}

/**
 * Inflates one deflated entry. Output is capped at the declared (already reserved) size, so a
 * mismatched or hostile entry cannot expand beyond it. zlib stops at the end of the deflate stream
 * and ignores anything after it, so the whole compressed payload must have been consumed:
 * otherwise the leftover bytes would be published without ever being scanned.
 */
function inflateEntry(raw: Buffer, size: number): Buffer {
  // With info: true, inflateRawSync returns the output buffer and the engine (not reflected in
  // @types/node); engine.bytesWritten is the number of compressed bytes the decompressor consumed.
  const { buffer, engine } = inflateRawSync(raw, { info: true, maxOutputLength: Math.max(size, 1) }) as unknown as {
    buffer: Buffer;
    engine: { bytesWritten: number };
  };
  if (engine.bytesWritten !== raw.length) throw new ScanError('unexpected data after a compressed ZIP entry');
  return buffer;
}

/**
 * Strict ZIP reader for stored and deflate entries. Every byte must be accounted for: local
 * entries (header, data and optional data descriptor) back to back from byte 0, then the central
 * directory, then the end record as the last bytes. Prefixes, gaps, overlaps, unlisted entries,
 * trailing data, comments, unknown extra fields, ZIP64 and multi-disk archives are rejected,
 * because they could hold data that would never be scanned. The whole layout is checked before
 * anything is inflated, and each entry's declared size is reserved from `budget` before it is
 * inflated. scanReport passes one budget for the whole report, including nested archives.
 */
export function readZip(buffer: Buffer, budget: ScanBudget = createBudget()): { name: string; data: Buffer }[] {
  try {
    const eocd = buffer.length - 22;
    if (eocd < 0 || buffer.readUInt32LE(eocd) !== END_OF_CENTRAL_DIRECTORY) {
      throw new ScanError('not a ZIP archive, or unexpected data after its end');
    }
    if (buffer.readUInt16LE(eocd + 20) !== 0) throw new ScanError('ZIP comments are not supported');
    const count = buffer.readUInt16LE(eocd + 10);
    const directorySize = buffer.readUInt32LE(eocd + 12);
    const directoryOffset = buffer.readUInt32LE(eocd + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new ScanError('ZIP64 archives are not supported');
    }
    if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) {
      throw new ScanError('multi-disk ZIP archives are not supported');
    }
    if (buffer.readUInt16LE(eocd + 8) !== count) throw new ScanError('corrupt ZIP end record');
    // Also rejects ZIP64 end records, which would sit between the directory and the end record.
    if (directoryOffset + directorySize !== eocd) throw new ScanError('ZIP central directory does not match its size');

    const pending: { name: string; method: number; raw: Buffer; size: number }[] = [];
    let central = directoryOffset;
    let local = 0; // where the next local entry must start
    for (let n = 0; n < count; n++) {
      if (buffer.readUInt32LE(central) !== CENTRAL_HEADER) throw new ScanError('corrupt ZIP central directory');
      const flags = buffer.readUInt16LE(central + 8);
      const method = buffer.readUInt16LE(central + 10);
      const crc = buffer.readUInt32LE(central + 16);
      const compressedSize = buffer.readUInt32LE(central + 20);
      const size = buffer.readUInt32LE(central + 24);
      const nameStart = central + 46;
      const nameLength = buffer.readUInt16LE(central + 28);
      const extraLength = buffer.readUInt16LE(central + 30);
      if (buffer.readUInt16LE(central + 32) !== 0) throw new ScanError('ZIP comments are not supported');
      if (buffer.readUInt16LE(central + 34) !== 0) throw new ScanError('multi-disk ZIP archives are not supported');
      const localOffset = buffer.readUInt32LE(central + 42);
      const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
      checkExtraField(buffer, nameStart + nameLength, extraLength);
      central = nameStart + nameLength + extraLength;
      if (central > eocd) throw new ScanError('corrupt ZIP central directory');
      if (flags & FLAG_ENCRYPTED) throw new ScanError('encrypted ZIP entries are not supported');

      // The local entry must start exactly where the previous one ended (no gap, no overlap).
      if (localOffset !== local) throw new ScanError('unexpected data between ZIP entries');
      if (buffer.readUInt32LE(local) !== LOCAL_HEADER) throw new ScanError('corrupt ZIP local header');
      const localNameLength = buffer.readUInt16LE(local + 26);
      const localExtraLength = buffer.readUInt16LE(local + 28);
      const localName = buffer.subarray(local + 30, local + 30 + localNameLength);
      if (
        buffer.readUInt16LE(local + 8) !== method ||
        !localName.equals(buffer.subarray(nameStart, nameStart + nameLength))
      ) {
        throw new ScanError('ZIP local header does not match the central directory');
      }
      checkExtraField(buffer, local + 30 + localNameLength, localExtraLength);
      const start = local + 30 + localNameLength + localExtraLength;
      let end = start + compressedSize;
      const matches = (at: number) =>
        buffer.readUInt32LE(at) === crc &&
        buffer.readUInt32LE(at + 4) === compressedSize &&
        buffer.readUInt32LE(at + 8) === size;
      if (flags & FLAG_DATA_DESCRIPTOR) {
        // The descriptor after the data has an optional signature: 16 bytes with it, 12 without.
        if (buffer.readUInt32LE(end) === DATA_DESCRIPTOR && matches(end + 4)) end += 16;
        else if (matches(end)) end += 12;
        else throw new ScanError('ZIP data descriptor does not match the central directory');
      } else if (!matches(local + 14)) {
        throw new ScanError('ZIP local header does not match the central directory');
      }
      if (end > directoryOffset) throw new ScanError('ZIP entry overlaps the central directory');
      local = end;

      if (name.endsWith('/')) {
        // A directory entry must be empty; data hidden behind a directory name would go unscanned.
        if (compressedSize !== 0 || size !== 0) throw new ScanError('ZIP directory entry contains data');
        continue;
      }
      if (method !== 0 && method !== 8) throw new ScanError(`unsupported ZIP compression method ${method}`);
      if (size > MAX_TOTAL_BYTES) throw new ScanError('ZIP entry is larger than the scan limit');
      pending.push({ name, method, raw: buffer.subarray(start, start + compressedSize), size });
    }
    if (central !== eocd) throw new ScanError('unexpected data in the ZIP central directory');
    // Anything left before the directory is an unlisted entry or unexplained data.
    if (local !== directoryOffset) throw new ScanError('unexpected data between ZIP entries');

    return pending.map(({ name, method, raw, size }) => {
      budget.reserve(size);
      const data = method === 0 ? Buffer.from(raw) : inflateEntry(raw, size);
      if (data.length !== size) throw new ScanError('ZIP entry size mismatch');
      return { name, data };
    });
  } catch (error) {
    if (error instanceof ScanError) throw error;
    // Buffer range or inflate errors: report the kind of failure, never any content.
    throw new ScanError(`unreadable ZIP archive (${error instanceof Error ? error.name : 'error'})`);
  }
}

const isZip = (data: Buffer) => data.length >= 4 && data.readUInt32LE(0) === LOCAL_HEADER;

/**
 * Returns the exact decoded length of canonical Base64, computed from the text alone so the budget
 * can be reserved before anything is decoded. Throws on anything else: a length that is not a
 * multiple of 4, padding other than one or two final "=", or non-zero unused bits before the
 * padding (non-canonical forms that decoders treat differently). The error never contains data.
 */
export function canonicalBase64Length(base64: string): number {
  const malformed = () => new ScanError('malformed embedded report data in index.html');
  if (base64.length === 0 || base64.length % 4 !== 0) throw malformed();
  const firstPad = base64.indexOf('=');
  const padding = firstPad === -1 ? 0 : base64.length - firstPad;
  if (padding > 2 || (padding > 0 && base64.slice(firstPad) !== '='.repeat(padding))) throw malformed();
  if (padding > 0) {
    const last = BASE64_ALPHABET.indexOf(base64[firstPad - 1]!);
    if (last < 0 || (last & (padding === 2 ? 0x0f : 0x03)) !== 0) throw malformed();
  }
  return (base64.length / 4) * 3 - padding;
}

/** Location label for an untrusted name: the name only when it cannot carry a credential pattern. */
const label = (name: string, fallback: string) => (SAFE_LABEL.test(name) ? name : fallback);

/**
 * Scans a report directory. Throws ScanError if anything cannot be read. `limit` caps the bytes
 * held for scanning across the whole report (files, embedded data and every ZIP entry at any
 * depth); each is reserved once, before it is read or inflated.
 */
export function scanReport(reportDir: string, limit = MAX_TOTAL_BYTES): ScanResult {
  const result: ScanResult = { findings: [], scannedEntries: 0, skippedMedia: 0 };
  const budget = createBudget(limit);

  // Names are untrusted: they are scanned like content, and a finding in a name is reported at a
  // location that does not contain it. `location` (from label) is safe to print.
  const scanName = (location: string, name: string) => {
    for (const { rule, count } of scanText(name)) result.findings.push({ location: `${location} (name)`, rule, count });
  };

  const scanData = (location: string, data: Buffer, depth: number) => {
    if (isZip(data)) {
      if (depth >= MAX_ZIP_DEPTH) throw new ScanError(`ZIP archives nested too deeply in ${location}`);
      for (const [index, entry] of readZip(data, budget).entries()) {
        const entryLocation = `${location} > ${label(entry.name, `entry #${index + 1}`)}`;
        scanName(`${location} > entry #${index + 1}`, entry.name);
        scanData(entryLocation, entry.data, depth + 1);
      }
      return;
    }
    // ZIP data that does not start at byte 0 (a prefix, an appended archive, a media/ZIP
    // polyglot) cannot be read reliably, and scanning it as text would miss compressed content.
    if (containsZipSignature(data)) throw new ScanError(`unrecognised ZIP data in ${location}`);
    if (isMedia(data)) {
      result.skippedMedia++;
      return;
    }
    // Everything else is scanned as text, whatever its name or extension says.
    result.scannedEntries++;
    for (const { rule, count } of scanText(data.toString('latin1'))) result.findings.push({ location, rule, count });
  };

  let entries: Dirent[];
  try {
    entries = readdirSync(reportDir, { recursive: true, withFileTypes: true });
  } catch {
    throw new ScanError(`cannot read report directory ${reportDir}`);
  }
  const relativePath = (entry: Dirent) => relative(reportDir, join(entry.parentPath, entry.name)).split(sep).join('/');
  // Symlinks, sockets, devices and the like are never produced by the HTML reporter, and a symlink
  // would be followed when the folder is published, so anything unexpected is an error.
  const unexpected = entries.find((entry) => !entry.isFile() && !entry.isDirectory());
  if (unexpected) {
    throw new ScanError(`unsupported entry type in report: ${label(relativePath(unexpected), '(unprintable name)')}`);
  }
  const files = entries.filter((entry) => entry.isFile()).map(relativePath);
  if (!files.includes('index.html')) throw new ScanError('index.html not found in the report directory');

  const readReportFile = (file: string, location: string): Buffer => {
    const path = join(reportDir, file);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw new ScanError(`cannot read ${location}`);
    }
    budget.reserve(size); // before the file is read into memory
    let data: Buffer | undefined;
    try {
      data = readFileSync(path);
    } catch {
      // reported below
    }
    if (data?.length === size) return data;
    throw new ScanError(`cannot read ${location}`);
  };

  for (const [index, file] of files.sort().entries()) {
    if (file.startsWith('trace/')) continue; // Playwright's trace-viewer application, not test data
    const location = label(file, `report file #${index + 1}`);
    scanName(`report file #${index + 1}`, file);
    const data = readReportFile(file, location);
    if (file === 'index.html') {
      // The HTML is Playwright's report application; the test data is the embedded ZIP. Exactly
      // one embedded blob is expected; anything else means an unknown format.
      const blobs = [...data.toString('utf8').matchAll(EMBEDDED_REPORT_DATA)];
      if (blobs.length === 0) throw new ScanError('no embedded report data found in index.html');
      if (blobs.length > 1) throw new ScanError('more than one embedded report data blob in index.html');
      const base64 = blobs[0]![1]!;
      // The exact decoded size is computed from the text, so it is reserved before the decoded
      // buffer is allocated; the length check below guards that calculation.
      const size = canonicalBase64Length(base64);
      budget.reserve(size);
      const decoded = Buffer.from(base64, 'base64');
      if (decoded.length !== size) throw new ScanError('malformed embedded report data in index.html');
      scanData('index.html (report data)', decoded, 0);
    } else {
      scanData(location, data, 0);
    }
  }
  return result;
}

/** Runs the scan and returns the exit code. Messages never include matched values. */
export function main(args: string[], log: (line: string) => void = console.log): number {
  const reportDir = args[0];
  if (!reportDir) {
    log('report-scan: usage: report-scan-cli.ts <report-dir>');
    return 2;
  }
  let result: ScanResult;
  try {
    result = scanReport(reportDir);
  } catch (error) {
    const reason = error instanceof ScanError ? error.message : 'unexpected error';
    log(`report-scan: FAILED, not safe to publish: ${reason}`);
    return 2;
  }
  log(`report-scan: scanned ${result.scannedEntries} file(s), skipped ${result.skippedMedia} media file(s)`);
  for (const { location, rule, count } of result.findings) {
    log(`report-scan: found ${rule} (${count} match${count === 1 ? '' : 'es'}) in ${location}`);
  }
  if (result.findings.length > 0) {
    log('report-scan: FAILED, not safe to publish (values are not shown)');
    return 1;
  }
  log('report-scan: no credential patterns found');
  return 0;
}
