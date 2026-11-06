/**
 * CSV export for `app-data-list`. Pure text builder + a thin download. Conventions follow
 * `utils/reports-export.ts` (pt-BR, local Blob download, no file-saver); that module is not
 * imported because it pulls jspdf/xlsx at load and keeps `downloadBlob` private.
 *
 * Format for Brazilian Excel: `;` separator, `,` decimal, UTF-8 BOM, CRLF lines. Money is a
 * plain number with two decimals ("1234,56") so the spreadsheet can sum it; the header says
 * what it is.
 */
export type CsvKind = 'text' | 'status' | 'money-cents' | 'integer';

export interface CsvColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly kind?: CsvKind;
  /** Raw value of the cell: text, or a number (cents for `money-cents`). */
  readonly value: (row: T) => string | number | null | undefined;
}

const SEP = ';';
const BOM = '﻿';

const MONEY = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** Quote a field when it holds the separator, a quote or a line break. */
function field(text: string): string {
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Text that a spreadsheet would run as a formula is neutralised with a leading apostrophe. */
function safeText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell<T>(col: CsvColumn<T>, row: T): string {
  const raw = col.value(row);
  if (raw === null || raw === undefined || raw === '') return '';
  if (col.kind === 'money-cents' || col.kind === 'integer') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return '';
    return col.kind === 'integer' ? String(Math.round(n)) : field(MONEY.format(n / 100));
  }
  return field(safeText(String(raw)));
}

/** The CSV text (with BOM) for `rows` — pass the rows AS FILTERED on screen. */
export function buildCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const head = columns.map((c) => field(c.header)).join(SEP);
  const lines = rows.map((r) => columns.map((c) => cell(c, r)).join(SEP));
  return BOM + [head, ...lines].join('\r\n') + '\r\n';
}

/** Saves `csv` as `filename` through a local Blob link. Browser only. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
