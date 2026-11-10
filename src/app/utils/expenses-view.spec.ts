import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { Expense } from '../types/expense.types';
import {
  categoryCounts,
  expenseAmountValidator,
  filterExpenses,
  monthName,
  monthOf,
  monthTitle,
  shiftMonth,
  summarize,
} from './expenses-view';

function exp(over: Partial<Expense>): Expense {
  return {
    id: 'e',
    createdDate: null,
    modifyDate: null,
    companyId: 'c',
    vehicleId: null,
    vehicleLabel: null,
    category: 'FUEL',
    categoryLabel: 'Abastecimento',
    description: 'x',
    expenseDate: '2026-11-08',
    amountCents: 100,
    ...over,
  };
}

describe('mês', () => {
  it('nome e título em pt-BR', () => {
    expect(monthName('2026-11')).toBe('novembro de 2026');
    expect(monthTitle('2026-03')).toBe('Março de 2026');
    expect(monthOf('2026-11-08')).toBe('2026-11');
  });

  it('passa de ano nos dois sentidos', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-11', -1)).toBe('2026-10');
  });
});

describe('summarize', () => {
  it('soma centavos, acha a maior categoria e separa a parte sem veículo', () => {
    const s = summarize([
      exp({ amountCents: 25000, vehicleId: 'v1', category: 'FUEL' }),
      exp({ amountCents: 23000, vehicleId: 'v2', category: 'FUEL' }),
      exp({ amountCents: 45000, vehicleId: null, category: 'ACCOUNTING_ADMIN' }),
      exp({ amountCents: 6000, vehicleId: 'v1', category: 'WASHING' }),
    ]);
    expect(s.totalCents).toBe(99000);
    expect(s.count).toBe(4);
    expect(s.biggest).toEqual({ label: 'Abastecimento', cents: 48000, count: 2 });
    expect(s.companyWideCents).toBe(45000);
  });

  it('mês vazio: zero, sem maior categoria', () => {
    expect(summarize([])).toEqual({ totalCents: 0, count: 0, biggest: null, companyWideCents: 0 });
  });
});

describe('categoryCounts e filterExpenses', () => {
  const list = [
    exp({ id: 'a', category: 'FUEL', description: 'Posto Avenida', vehicleId: 'v1', vehicleLabel: 'QWE4F21 · Chevrolet Onix' }),
    exp({ id: 'b', category: 'WASHING', description: 'Lavagem completa', vehicleId: null }),
    exp({ id: 'c', category: 'FUEL', description: 'Tanque', vehicleId: 'v2', vehicleLabel: 'RIO2A18 · Fiat Argo' }),
  ];

  it('sempre as cinco categorias mais Todas, com a contagem do mês', () => {
    const counts = categoryCounts(list);
    expect(counts).toHaveLength(6);
    expect(counts[0]).toMatchObject({ value: 'ALL', count: 3 });
    expect(counts.find((c) => c.value === 'FUEL')?.count).toBe(2);
    expect(counts.find((c) => c.value === 'OTHER')?.count).toBe(0);
  });

  it('filtra por categoria, veículo e busca sem acento nem caixa (descrição ou placa)', () => {
    const f = (q: Partial<Parameters<typeof filterExpenses>[1]>) =>
      filterExpenses(list, { category: 'ALL', vehicleId: '', query: '', ...q }).map((e) => e.id);
    expect(f({ category: 'FUEL' })).toEqual(['a', 'c']);
    expect(f({ vehicleId: 'v2' })).toEqual(['c']);
    expect(f({ query: 'avenida' })).toEqual(['a']);
    expect(f({ query: 'LAVAGEM' })).toEqual(['b']);
    expect(f({ query: 'rio2a' })).toEqual(['c']);
    expect(f({ query: 'zzz' })).toEqual([]);
  });
});

/**
 * O controle de dinheiro guarda TEXTO pt-BR. O validador lê texto; um NUMBER no controle é
 * lido como vazio/inválido, e a falha parece qualquer coisa menos erro de formato.
 */
describe('expenseAmountValidator (texto pt-BR)', () => {
  const run = (v: unknown) => expenseAmountValidator()(new FormControl(v));

  it('aceita texto pt-BR com milhar e vírgula', () => {
    expect(run('250,00')).toBeNull();
    expect(run('1.250,50')).toBeNull();
    expect(run('0,01')).toBeNull();
  });

  it('o teto é R$ 100.000.000,00: nele passa, um centavo acima não', () => {
    expect(run('100.000.000,00')).toBeNull();
    expect(run('100.000.000,01')).toEqual({ max: true });
  });

  it('vazio é obrigatório, zero é abaixo do mínimo, lixo é formato', () => {
    expect(run('')).toEqual({ required: true });
    expect(run('0,00')).toHaveProperty('min');
    expect(run('45.99')).toEqual({ moneyFormat: true });
    expect(run('abc')).toEqual({ moneyFormat: true });
  });

  it('um NUMBER no controle é recusado, nunca lido como valor', () => {
    expect(run(250)).toEqual({ moneyFormat: true });
  });
});
