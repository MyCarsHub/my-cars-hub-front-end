import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  pdfTables: [] as { head: string[][]; body: string[][] }[],
  sheets: {} as Record<string, (string | number)[][]>,
}));

vi.mock('jspdf', () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setFontSize() {}
    setFont() {}
    setTextColor() {}
    text() {}
    addImage() {}
    getNumberOfPages() {
      return 1;
    }
    setPage() {}
    save() {}
  },
}));
vi.mock('jspdf-autotable', () => ({
  default: (_doc: unknown, opts: { head: string[][]; body: string[][] }) => {
    captured.pdfTables.push({ head: opts.head, body: opts.body });
  },
}));
vi.mock('./report-pdf-logo', () => ({ PDF_TABLE_TOP_MARGIN: 20, stampLogoOnEveryPage: () => undefined }));
vi.mock('xlsx', () => ({
  utils: {
    book_new: () => ({}),
    aoa_to_sheet: (rows: (string | number)[][]) => rows,
    book_append_sheet: (_wb: unknown, rows: (string | number)[][], name: string) => {
      captured.sheets[name] = rows;
    },
  },
  write: () => new ArrayBuffer(0),
}));

import type { ReportsOverviewResponse } from '../types/reports.types';
import { exportReportExcel, exportReportPdf, reportToMarkdown } from './reports-export';

/**
 * V141 — motoristas com pendência: o Total do back-end JÁ inclui os ajustes e as cobranças não.
 * As três exportações mostram "Ajustes em aberto" para Multas + Cobranças + Ajustes fecharem
 * com o Total.
 */
describe('reports-export — Ajustes em aberto fecham o Total', () => {
  const report = {
    from: '2026-11-01',
    to: '2026-11-30',
    financial: {
      grossRevenueCents: 0,
      accruedRevenueCents: 0,
      revenueByGateway: [],
      operatingCostCents: 0,
      netProfitCents: 0,
      monthlyRevenue: [],
    },
    vehicleRanking: { topProfitable: [], topUnprofitable: [] },
    driverRanking: {
      topRevenue: [],
      topProblematic: [
        {
          driverId: 'd1',
          name: 'carlos mendes',
          unpaidFinesCents: 10000,
          unpaidChargesCents: 20000,
          unpaidAdjustmentsCents: 18000,
          totalProblematicCents: 48000,
        },
        // Back-end anterior ao V141: sem o campo, a coluna mostra zero e a conta ainda fecha.
        { driverId: 'd2', name: 'bruno', unpaidFinesCents: 500, unpaidChargesCents: 1500, totalProblematicCents: 2000 },
      ],
    },
    operations: { activeRentalsCount: 0, completedRentalsCount: 0, canceledRentalsCount: 0, fleetOccupancyRate: 0 },
  } as unknown as ReportsOverviewResponse;

  /** "R$ 1.234,56" (qualquer espaço) → centavos. */
  const cents = (brl: string) => Number(brl.replace(/[^\d,]/g, '').replace(',', ''));

  beforeEach(() => {
    captured.pdfTables.length = 0;
    for (const k of Object.keys(captured.sheets)) delete captured.sheets[k];
  });

  it('Markdown: coluna Ajustes em aberto e as partes somam o Total', () => {
    const md = reportToMarkdown(report);
    expect(md).toContain('| Nome | Multas abertas | Charges abertas | Ajustes em aberto | Total |');
    const rows = md.split('\n').filter((l) => /^\| (Carlos|Bruno)/i.test(l));
    expect(rows.length).toBe(2);
    for (const line of rows) {
      const [, fines, charges, adjustments, total] = line.split('|').slice(1, 6).map((c) => c.trim());
      expect(cents(fines) + cents(charges) + cents(adjustments)).toBe(cents(total));
    }
    expect(cents(rows[0].split('|')[4])).toBe(18000);
  });

  it('PDF: coluna Ajustes em aberto e as partes somam o Total', () => {
    exportReportPdf(report);
    const table = captured.pdfTables.find((t) => t.head[0][0].startsWith('Top 5 motoristas problemáticos'));
    expect(table?.head[0]).toEqual([
      'Top 5 motoristas problemáticos',
      'Multas em aberto',
      'Charges em aberto',
      'Ajustes em aberto',
      'Total',
    ]);
    for (const [, fines, charges, adjustments, total] of table!.body) {
      expect(cents(fines) + cents(charges) + cents(adjustments)).toBe(cents(total));
    }
    expect(cents(table!.body[0][3])).toBe(18000);
  });

  it('XLSX: coluna Ajustes em aberto e as partes somam o Total', () => {
    // O download real não interessa aqui: só a planilha montada.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    exportReportExcel(report);
    const rows = captured.sheets['Motoristas'];
    const header = rows.findIndex((r) => r[1] === 'Multas em aberto (R$)');
    expect(rows[header]).toEqual([
      'Nome',
      'Multas em aberto (R$)',
      'Charges em aberto (R$)',
      'Ajustes em aberto (R$)',
      'Total (R$)',
    ]);
    const data = rows.slice(header + 1) as [string, number, number, number, number][];
    expect(data.length).toBe(2);
    for (const [, fines, charges, adjustments, total] of data) {
      expect(Math.round((fines + charges + adjustments) * 100)).toBe(Math.round(total * 100));
    }
    expect(data[0][3]).toBe(180);
  });
});
