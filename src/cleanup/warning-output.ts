/**
 * Console line for a cleanup warning. Locally it is the plain `[cleanup-warning] …` line. On
 * GitHub Actions the same text becomes a workflow command, so the runner shows it as a warning
 * annotation on the run summary instead of printing it a second time.
 */
export function cleanupWarningLine(testTitle: string, message: string, githubActions: boolean): string {
  const text = `[cleanup-warning] ${testTitle}: ${message}`;
  return githubActions ? `::warning title=cleanup-warning::${escapeCommandData(text)}` : text;
}

// Workflow-command message escaping, so a %, CR or LF in the text cannot break or end the command.
function escapeCommandData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
