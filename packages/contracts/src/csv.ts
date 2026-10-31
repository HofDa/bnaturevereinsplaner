// Quoted CSV cell; a leading formula character is neutralized against spreadsheet injection.
export function csvCell(v: unknown) {
  let value = v == null ? '' : String(v);
  if (/^[\s]*[=+@\-\t\r]/.test(value)) value = "'" + value;
  return '"' + value.replaceAll('"', '""') + '"';
}
