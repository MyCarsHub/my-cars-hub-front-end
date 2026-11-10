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

  it('Gastos entra como sexta linha, depois de Financiamento, quando o back-end manda', () => {
    const rows = expenseRows({ maintenance: 100, fines: 100, ipva: 100, insurance: 100, financing: 100, expenses: 500 });
    expect(rows.map((r) => r.key)).toEqual(['maintenance', 'fines', 'ipva', 'insurance', 'financing', 'expenses']);
    expect(rows[5]).toMatchObject({ label: 'Gastos', cents: 500 });
    expect(rows[5].share).toBeCloseTo(0.5);
  });

  it('back-end anterior (sem `expenses`): nenhuma linha Gastos, nem R$ 0,00 inventado', () => {
    const rows = expenseRows({ maintenance: 100, fines: 100, ipva: 100, insurance: 100, financing: 100 });
    expect(rows.map((r) => r.key)).not.toContain('expenses');
    expect(rows).toHaveLength(5);
  });

  it('empresa SEM gastos (expenses = 0): a linha Gastos some e o resto é idêntico ao de antes', () => {
    const before = expenseRows({ maintenance: 100, fines: 300, ipva: 0, insurance: 0, financing: 0 });
    const after = expenseRows({ maintenance: 100, fines: 300, ipva: 0, insurance: 0, financing: 0, expenses: 0 });
    expect(after).toEqual(before);
    expect(after).toHaveLength(5);
  });
});
