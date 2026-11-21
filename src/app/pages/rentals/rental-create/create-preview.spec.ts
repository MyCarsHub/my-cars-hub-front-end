import { describe, expect, it } from 'vitest';

import { createCharges } from './create-plan';
import { caucaoPreview, chargesPreview } from './create-preview';

describe('prévia da caução (prancha CauC5)', () => {
  it('2 partes: total verde, "Parte 1 de 2 · Junto com a retirada" e a nota', () => {
    const p = caucaoPreview({
      netCents: 120_000,
      discountCents: 0,
      parts: [
        { dueDate: '2026-11-24', amountCents: 60_000 },
        { dueDate: '2026-12-08', amountCents: 60_000 },
      ],
      singleDue: '2026-11-24',
      pickupDay: '2026-11-24',
    })!;
    expect(p.tone).toBe('green');
    expect(p.total).toBe('R$ 1.200,00');
    expect(p.caption).toBe('Em 2 partes. Volta para ele no fim, se estiver tudo certo.');
    expect(p.rows).toEqual([
      { key: 'c0', day: '24/11', weekday: 'terça', title: 'Parte 1 de 2', sub: 'Junto com a retirada', amount: 'R$ 600,00', discount: null },
      { key: 'c1', day: '08/12', weekday: 'terça', title: 'Parte 2 de 2', sub: null, amount: 'R$ 600,00', discount: null },
    ]);
    expect(p.note).toBe('Cada parte vira uma cobrança, enviada para ele na data.');
  });

  it('inteira com desconto: uma linha com o valor líquido e o desconto na legenda', () => {
    const p = caucaoPreview({ netCents: 100_000, discountCents: 20_000, parts: null, singleDue: '2026-11-24', pickupDay: '2026-11-24' })!;
    expect(p.total).toBe('R$ 1.000,00');
    expect(p.caption).toContain('já com R$ 200,00 de desconto');
    expect(p.rows.map((r) => r.amount)).toEqual(['R$ 1.000,00']);
  });

  it('sem caução: sem prévia', () => {
    expect(caucaoPreview({ netCents: 0, discountCents: 0, parts: null, singleDue: '', pickupDay: '' })).toBeNull();
  });
});

describe('prévia das cobranças (prancha CobK4)', () => {
  const charges = createCharges({
    frequency: 'WEEKLY',
    startDate: '2026-11-24',
    periods: 4,
    firstDue: '2026-11-24',
    rateCents: 60_000,
    today: '2026-11-20',
    discount: { valueCents: 10_000, firstPeriods: 2 },
    split: null,
    caucaoCents: 120_000,
    caucaoPaid: false,
    caucaoParts: null,
  });

  it('total laranja sem a caução, uma linha por semana e o desconto em verde nas 2 primeiras', () => {
    const p = chargesPreview({
      frequency: 'WEEKLY',
      startDate: '2026-11-24',
      endDate: '2026-12-22',
      firstDue: '2026-11-24',
      discount: { valueCents: 10_000, firstPeriods: 2 },
      charges,
    })!;
    expect(p.tone).toBe('orange');
    expect(p.label).toBe('Total previsto');
    expect(p.total).toBe('R$ 2.200,00');
    expect(p.caption).toBe('4 cobranças, toda terça. Sem a caução.');
    expect(p.rows.map((r) => [r.day, r.weekday, r.title, r.sub, r.amount, r.discount])).toEqual([
      ['24/11', 'terça', 'Semana 1', 'até 30/11', 'R$ 500,00', '− R$ 100,00'],
      ['01/12', 'terça', 'Semana 2', 'até 07/12', 'R$ 500,00', '− R$ 100,00'],
      ['08/12', 'terça', 'Semana 3', 'até 14/12', 'R$ 600,00', null],
      ['15/12', 'terça', 'Semana 4', 'até 21/12', 'R$ 600,00', null],
    ]);
    expect(p.note).toBe('O aluguel acaba em 22/12. Nenhuma cobrança depois disso.');
  });
});
