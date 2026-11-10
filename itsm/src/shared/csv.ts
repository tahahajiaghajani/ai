// CSV cells for files people open in a spreadsheet program (shared by the server's CSV writers; imported by the UI
// too: keep it free of server imports).

/** A plain number (a decimal stored as text included): never a formula, kept as it is. */
const NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * Text a spreadsheet program shows as text: a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would
 * be read as a formula (`=HYPERLINK(…)`, `=cmd|…`) — it gets a leading single quote. Plain numbers stay as they are.
 */
export function csvSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !NUMBER.test(s) ? `'${s}` : s;
}

/** One CSV cell: formula-safe, and quoted when it holds a quote, a comma or a line break. */
export function csvCell(s: string): string {
  const safe = csvSafe(s);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
