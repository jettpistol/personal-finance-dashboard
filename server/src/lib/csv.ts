// RFC 4180 CSV serialisation. Cells starting with = + - @ are prefixed with ' to stop spreadsheet
// formula injection from merchant-controlled text such as payment descriptions.

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
