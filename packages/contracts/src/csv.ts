// Quote every cell and neutralize spreadsheet formulas, including control/space prefixes.
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^\s*[=+@\-\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
