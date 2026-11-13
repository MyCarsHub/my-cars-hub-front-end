import { describe, expect, it } from 'vitest';

import {
  WizardInput,
  billableDays,
  buildWizardPlan,
  localCharges,
  periodCount,
  totalsOf,
} from './wizard-math';

/**
 * As contas à mão do protótipo final (seção 8 de `2026-11-13_UX_estilo-clean.md`), fixadas
 * aqui: o resumo ao vivo do passo a passo precisa dar exatamente estes números.
 */
const BASE: WizardInput = {
  frequency: 'WEEKLY',
  startDate: '2026-11-16',
  periods: periodCount('2026-11-16', '2027-02-07', 'WEEKLY'),
  firstDue: '2026-11-16',
  rateCents: 75_000,
  today: '2026-11-13',
  discount: null,
  split: null,
  caucaoCents: 150_000,
  caucaoPaid: false,
  caucaoParts: null,
};

describe('wizard-math — contas do protótipo', () => {
  it('fim exclusivo: 16/11/2026 a 07/02/2027 são 12 semanas', () => {
    expect(billableDays('2026-11-16', '2027-02-07')).toBe(83);
    expect(BASE.periods).toBe(12);
  });

  it('teste 1, valor cheio: 12 × 750 + 1.500 = R$ 10.500,00 em 13 cobranças', () => {
    const t = totalsOf(localCharges(BASE));
    expect(t).toEqual({ rentCents: 900_000, caucaoCents: 150_000, totalCents: 1_050_000, count: 13 });
    expect(buildWizardPlan(BASE)).toBeNull();
  });

  it('teste 2: R$ 100 nas 3 primeiras, todas em 2 parcelas a cada 3 dias, caução 750 + 750 = R$ 10.200,00 em 26', () => {
    const input: WizardInput = {
      ...BASE,
      discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 },
      split: { count: 2, intervalN: 3, unit: 'DAYS', offsetDays: 0, scope: 'ALL', selected: [] },
      caucaoParts: [
        { dueDate: '2026-11-16', amountCents: 75_000 },
        { dueDate: '2026-11-23', amountCents: 75_000 },
      ],
    };
    const charges = localCharges(input);
    expect(totalsOf(charges)).toEqual({ rentCents: 870_000, caucaoCents: 150_000, totalCents: 1_020_000, count: 26 });
    const week1 = charges.filter((c) => c.kind === 'RENTAL_PERIOD' && c.index === 0);
    expect(week1.map((c) => [c.dueDate, c.amountCents])).toEqual([
      ['2026-11-16', 32_500],
      ['2026-11-19', 32_500],
    ]);
    const week4 = charges.filter((c) => c.kind === 'RENTAL_PERIOD' && c.index === 3);
    expect(week4.map((c) => c.amountCents)).toEqual([37_500, 37_500]);
    expect(buildWizardPlan(input)).toEqual({
      discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 },
      defaultSplit: { count: 2, intervalDays: 3, intervalUnit: 'DAYS' },
      overrides: [
        {
          target: 'CAUCAO',
          periodIndex: null,
          instalments: [
            { dueDate: '2026-11-16', amountCents: 75_000 },
            { dueDate: '2026-11-23', amountCents: 75_000 },
          ],
        },
      ],
    });
  });

  it('2b: só as semanas 6 e 7 parceladas dão 16 cobranças e o mesmo total', () => {
    const input: WizardInput = {
      ...BASE,
      discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 },
      split: { count: 2, intervalN: 3, unit: 'DAYS', offsetDays: 0, scope: 'SOME', selected: [5, 6] },
      caucaoParts: [
        { dueDate: '2026-11-16', amountCents: 75_000 },
        { dueDate: '2026-11-23', amountCents: 75_000 },
      ],
    };
    expect(totalsOf(localCharges(input))).toMatchObject({ totalCents: 1_020_000, count: 16 });
    const plan = buildWizardPlan(input)!;
    expect(plan.defaultSplit).toBeNull();
    expect(plan.overrides?.filter((o) => o.target === 'PERIOD').map((o) => o.periodIndex)).toEqual([5, 6]);
    expect(plan.overrides?.[1].instalments).toEqual([
      { dueDate: '2026-12-21', amountCents: 37_500 },
      { dueDate: '2026-12-24', amountCents: 37_500 },
    ]);
  });

  it('2c: 10% nas 3 primeiras = R$ 8.775 de aluguel e R$ 10.275 no total', () => {
    const t = totalsOf(localCharges({ ...BASE, discount: { type: 'PERCENT', value: 1_000, firstPeriods: 3 } }));
    expect(t.rentCents).toBe(877_500);
    expect(t.totalCents).toBe(1_027_500);
  });

  it('a 1ª parcela deslocada vira PERIOD em todas as semanas (o defaultSplit não tem deslocamento)', () => {
    const plan = buildWizardPlan({
      ...BASE,
      split: { count: 2, intervalN: 1, unit: 'WEEKS', offsetDays: 2, scope: 'ALL', selected: [] },
    })!;
    expect(plan.defaultSplit).toBeNull();
    expect(plan.overrides).toHaveLength(12);
    expect(plan.overrides?.[0].instalments).toEqual([
      { dueDate: '2026-11-18', amountCents: 37_500 },
      { dueDate: '2026-11-25', amountCents: 37_500 },
    ]);
  });

  it('centavos que sobram vão na última parcela; mês = 30 dias', () => {
    const plan = buildWizardPlan({
      ...BASE,
      rateCents: 100_000,
      split: { count: 3, intervalN: 1, unit: 'MONTHS', offsetDays: 0, scope: 'SOME', selected: [0] },
    })!;
    expect(plan.overrides?.[0].instalments).toEqual([
      { dueDate: '2026-11-16', amountCents: 33_333 },
      { dueDate: '2026-12-16', amountCents: 33_333 },
      { dueDate: '2027-01-15', amountCents: 33_334 },
    ]);
  });

  it('período já vencido nunca é parcelado (fica inteiro, como no servidor)', () => {
    const charges = localCharges({
      ...BASE,
      today: '2026-11-20',
      split: { count: 2, intervalN: 3, unit: 'DAYS', offsetDays: 0, scope: 'ALL', selected: [] },
    });
    expect(charges.filter((c) => c.index === 0 && c.kind === 'RENTAL_PERIOD')).toHaveLength(1);
  });

  it('caução recebida por fora não gera cobrança', () => {
    expect(totalsOf(localCharges({ ...BASE, caucaoPaid: true }))).toMatchObject({ caucaoCents: 0, count: 12 });
  });
});
