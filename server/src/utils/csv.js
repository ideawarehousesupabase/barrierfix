import { parse } from 'csv-parse/sync';
import { badRequest } from './http.js';

export const MAX_CSV_ROWS = 2000;

const normaliseHeader = (h) =>
  String(h)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

export function parseCsv(text, { required = [] } = {}) {
  if (!text || !String(text).trim()) throw badRequest('The CSV file is empty');
  let rows;
  try {
    rows = parse(String(text), {
      columns: (header) => header.map(normaliseHeader),
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw badRequest(`The CSV file could not be read: ${err.message}`);
  }
  if (rows.length > MAX_CSV_ROWS) throw badRequest(`Please upload at most ${MAX_CSV_ROWS} rows at a time`);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length) throw badRequest(`The CSV is missing these columns: ${missing.join(', ')}`);
  return rows;
}

const escapeCell = (value) => {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const head = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','));
  return [head, ...body].join('\r\n');
}
