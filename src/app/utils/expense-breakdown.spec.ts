import { describe, expect, it } from 'vitest';

import { expenseRows } from './expense-breakdown';

describe('expenseRows', () => {
  it('lists the five categories in the fixed order with their share of the total', () => {
    const rows = expenseRows({ maintenance: 100, fines: 100, ipva: 200, insurance: 0, financing: 600 });
    expect(rows.map((r) => r.key)).toEqual(['maintenance', 'fines', 'ipva', 'insurance', 'financing']);
    expect(rows.map((r) => r.label)).toEqual(['Manutenção', 'Multas', 'IPVA', 'Seguro', 'Financiamento']);
    expect(rows.map((r) => r.share)).toEqual([0.1, 0.1, 0.2, 0, 0.6]);
  });

  it('keeps out a category the backend did not send instead of showing it as zero', () => {
    const rows = expenseRows({ maintenance: 300, fines: 100 });
    expect(rows.map((r) => r.key)).toEqual(['maintenance', 'fines']);
    expect(rows[0].share).toBe(0.75);
  });

  it('gives share 0 when every category is zero, and nothing without a breakdown', () => {
    const rows = expenseRows({ maintenance: 0, fines: 0, ipva: 0, insurance: 0, financing: 0 });
    expect(rows.every((r) => r.share === 0)).toBe(true);
    expect(expenseRows(null)).toEqual([]);
    expect(expenseRows(undefined)).toEqual([]);
  });
});
