import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// Synthetic fixtures for tests/unit/report-scan.spec.ts: ZIP archives and report folders built in
// memory or under the test's output directory. No file here is a spec, so Playwright does not collect it.

export const kv = (key: string, value: string) => JSON.stringify({ [key]: value });
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

interface ZipOptions {
  method?: number; // 8 = deflate, 0 = stored; other values produce unsupported entries
  flags?: number;
  declaredSize?: number; // overrides the uncompressed size written to the headers
  descriptor?: 'signed' | 'unsigned'; // sizes in a data descriptor after the data (flag bit 3)
  prefix?: Buffer; // bytes before the first entry; offsets are shifted to point past them
  gap?: Buffer; // bytes between the last entry and the central directory
  unlisted?: string[]; // entries written to the archive but left out of the central directory
  afterStream?: Buffer; // bytes appended to each deflated payload, after the end of the deflate stream
}

/** Builds a ZIP archive with the given entries (synthetic fixture). CRCs are written as 0. */
export function zip(
  files: Record<string, string | Buffer>,
  {
    method = 8,
    flags = 0,
    declaredSize,
    descriptor,
    prefix = Buffer.alloc(0),
    gap,
    unlisted = [],
    afterStream = Buffer.alloc(0),
  }: ZipOptions = {},
): Buffer {
  const locals: Buffer[] = [prefix];
  const central: Buffer[] = [];
  const entryFlags = descriptor ? flags | 0x8 : flags;
  let offset = prefix.length;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const body = method === 8 ? Buffer.concat([deflateRawSync(data), afterStream]) : data;
    const size = declaredSize ?? data.length;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entryFlags, 6);
    local.writeUInt16LE(method, 8);
    if (!descriptor) {
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(nameBytes.length, 26);
    const trailer = descriptor === 'signed' ? Buffer.alloc(16) : descriptor ? Buffer.alloc(12) : Buffer.alloc(0);
    if (descriptor === 'signed') trailer.writeUInt32LE(0x08074b50, 0);
    if (descriptor) {
      trailer.writeUInt32LE(body.length, trailer.length - 8);
      trailer.writeUInt32LE(size, trailer.length - 4);
    }
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(entryFlags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body, trailer);
    if (!unlisted.includes(name)) central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length + trailer.length;
  }
  if (gap) {
    locals.push(gap);
    offset += gap.length;
  }
  const directory = Buffer.concat(central);
  const count = Object.keys(files).length - unlisted.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Returns a copy of a synthetic archive with one field of its end record overwritten. */
export function withEndField(archive: Buffer, field: number, value: number, bytes: 2 | 4): Buffer {
  const copy = Buffer.from(archive);
  const at = copy.length - 22 + field;
  if (bytes === 2) copy.writeUInt16LE(value, at);
  else copy.writeUInt32LE(value, at);
  return copy;
}

/** The report-data template holding exactly `base64`, which need not be valid Base64. */
export const embeddedBase64 = (base64: string) =>
  `<template id="playwrightReportBase64">data:application/zip;base64,${base64}</template>`;

export const embedded = (data: Record<string, string>) => embeddedBase64(zip(data).toString('base64'));

/** Writes `dir/index.html` with the given body markup. */
export function writeIndex(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<html>${body}</html>`);
  return dir;
}

/** Writes a synthetic report folder: index.html embedding `reportData`, plus extra files. */
export function writeReport(
  dir: string,
  reportData: Record<string, string>,
  files: Record<string, string | Buffer> = {},
) {
  writeIndex(dir, embedded(reportData));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
