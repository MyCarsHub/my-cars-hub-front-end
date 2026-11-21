import { describe, expect, it } from 'vitest';

import {
  CreatePlanInput,
  buildCreatePlan,
  caucaoNet,
  createCharges,
  defaultSplitFor,
  isFullValue,
  periodLastDay,
  scaleParts,
  toggleCheck,
} from './create-plan';

/** R$ 600 por semana, 24/11 a 22/12/2026 (4 semanas, toda terça); hoje 20/11. */
function input(over: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    frequency: 'WEEKLY',
    startDate: '2026-11-24',
    periods: 4,
    firstDue: '2026-11-24',
    rateCents: 60_000,
    today: '2026-11-20',
    discount: null,
    split: null,
    caucaoCents: 0,
    caucaoPaid: false,
    caucaoParts: null,
    ...over,
  };
}

const TUE_FRI = [
  { amountCents: 30_000, offsetDays: 0 },
  { amountCents: 30_000, offsetDays: 3 },
];

describe('as três caixas (valor cheio · desconto · parcelar)', () => {
  it('"Valor cheio" desliga as outras duas', () => {
    expect(toggleCheck({ descOn: true, splitOn: true }, 'full')).toEqual({ descOn: false, splitOn: false });
  });

  it('desconto e parcelar vão juntos; tirar as duas volta o "Valor cheio"', () => {
    let s = toggleCheck({ descOn: false, splitOn: false }, 'desc');
    expect(isFullValue(s)).toBe(false);
    s = toggleCheck(s, 'split');
    expect(s).toEqual({ descOn: true, splitOn: true });
    s = toggleCheck(toggleCheck(s, 'desc'), 'split');
    expect(isFullValue(s)).toBe(true);
  });
});

describe('caução líquida', () => {
  it('R$ 1.200 − R$ 200 = R$ 1.000; sem a caixa ou com "Recebi por fora", o valor cheio', () => {
    expect(caucaoNet(120_000, true, 20_000, false)).toBe(100_000);
    expect(caucaoNet(120_000, false, 20_000, false)).toBe(120_000);
    expect(caucaoNet(120_000, true, 20_000, true)).toBe(120_000);
  });
});

describe('partes do período → defaultSplit ou overrides', () => {
  it('todas, iguais, 1ª no vencimento, mesmo intervalo: defaultSplit em dias', () => {
    expect(defaultSplitFor(TUE_FRI, 60_000, 'ALL')).toEqual({ count: 2, intervalDays: 3, intervalUnit: 'DAYS' });
    const three = [0, 2, 4].map((o) => ({ amountCents: 20_000, offsetDays: o }));
    expect(defaultSplitFor(three, 60_000, 'ALL')).toEqual({ count: 3, intervalDays: 2, intervalUnit: 'DAYS' });
  });

  it('a divisão do servidor com centavos na última também é defaultSplit', () => {
    const parts = [
      { amountCents: 33_333, offsetDays: 0 },
      { amountCents: 33_333, offsetDays: 1 },
      { amountCents: 33_334, offsetDays: 2 },
    ];
    expect(defaultSplitFor(parts, 100_000, 'ALL')?.count).toBe(3);
  });

  it('não serve: "Só algumas", valores diferentes, 1ª depois do vencimento, intervalo irregular ou no mesmo dia', () => {
    expect(defaultSplitFor(TUE_FRI, 60_000, 'SOME')).toBeNull();
    expect(defaultSplitFor([{ amountCents: 40_000, offsetDays: 0 }, { amountCents: 20_000, offsetDays: 3 }], 60_000, 'ALL')).toBeNull();
    expect(defaultSplitFor([{ amountCents: 30_000, offsetDays: 1 }, { amountCents: 30_000, offsetDays: 4 }], 60_000, 'ALL')).toBeNull();
    const irregular = [0, 1, 4].map((o) => ({ amountCents: 20_000, offsetDays: o }));
    expect(defaultSplitFor(irregular, 60_000, 'ALL')).toBeNull();
    const sameDay = [{ amountCents: 30_000, offsetDays: 0 }, { amountCents: 30_000, offsetDays: 0 }];
    expect(defaultSplitFor(sameDay, 60_000, 'ALL')).toBeNull();
  });

  it('limites do servidor: de 2 a 12 partes', () => {
    expect(defaultSplitFor([{ amountCents: 60_000, offsetDays: 0 }], 60_000, 'ALL')).toBeNull();
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ amountCents: i < 12 ? 4_615 : 60_000 - 4_615 * 12, offsetDays: i }));
    expect(defaultSplitFor(thirteen, 60_000, 'ALL')).toBeNull();
  });

  it('partes diferentes: um PERIOD por semana, com as datas e valores digitados', () => {
    const plan = buildCreatePlan(
      input({
        split: {
          scope: 'ALL',
          selected: [],
          parts: [
            { amountCents: 40_000, offsetDays: 0 },
            { amountCents: 20_000, offsetDays: 3 },
          ],
        },
      }),
    );
    expect(plan?.defaultSplit).toBeNull();
    expect(plan?.overrides).toHaveLength(4);
    expect(plan?.overrides?.[1]).toEqual({
      target: 'PERIOD',
      periodIndex: 1,
      instalments: [
        { dueDate: '2026-12-01', amountCents: 40_000 },
        { dueDate: '2026-12-04', amountCents: 20_000 },
      ],
    });
  });

  it('com desconto, as partes de uma semana encolhem na mesma proporção e somam o valor com desconto', () => {
    expect(scaleParts([{ amountCents: 40_000, offsetDays: 0 }, { amountCents: 20_000, offsetDays: 3 }], 60_000, 50_000)).toEqual([33_333, 16_667]);
    const plan = buildCreatePlan(
      input({
        discount: { valueCents: 10_000, firstPeriods: 1 },
        split: { scope: 'SOME', selected: [0, 2], parts: TUE_FRI },
      }),
    );
    expect(plan?.overrides?.map((o) => [o.periodIndex, o.instalments.map((i) => i.amountCents)])).toEqual([
      [0, [25_000, 25_000]],
      [2, [30_000, 30_000]],
    ]);
  });

  it('semana já vencida nunca é parcelada (o servidor a registra inteira)', () => {
    const plan = buildCreatePlan(
      input({ today: '2026-12-02', split: { scope: 'SOME', selected: [0, 1, 2], parts: TUE_FRI } }),
    );
    expect(plan?.overrides?.map((o) => o.periodIndex)).toEqual([2]);
  });

  it('valor cheio e caução inteira: sem chargePlan', () => {
    expect(buildCreatePlan(input({ caucaoCents: 120_000 }))).toBeNull();
  });
});

describe('o exemplo inteiro: R$ 600/semana, 4 semanas, R$ 100 nas 2 primeiras, terça/sexta, caução R$ 1.200 − R$ 200 em 2 partes', () => {
  const full = input({
    discount: { valueCents: 10_000, firstPeriods: 2 },
    split: { scope: 'ALL', selected: [], parts: TUE_FRI },
    caucaoCents: 100_000,
    caucaoParts: [
      { dueDate: '2026-11-24', amountCents: 50_000 },
      { dueDate: '2026-12-08', amountCents: 50_000 },
    ],
  });

  it('o chargePlan', () => {
    expect(buildCreatePlan(full)).toEqual({
      discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 2 },
      defaultSplit: { count: 2, intervalDays: 3, intervalUnit: 'DAYS' },
      overrides: [
        {
          target: 'CAUCAO',
          periodIndex: null,
          instalments: [
            { dueDate: '2026-11-24', amountCents: 50_000 },
            { dueDate: '2026-12-08', amountCents: 50_000 },
          ],
        },
      ],
    });
  });

  it('as cobranças na hora (a mesma divisão do servidor)', () => {
    const rows = createCharges(full).map((c) => `${c.kind[0]}${c.index} ${c.dueDate} ${c.amountCents}`);
    expect(rows).toEqual([
      'C0 2026-11-24 50000',
      'R0 2026-11-24 25000',
      'R0 2026-11-27 25000',
      'R1 2026-12-01 25000',
      'R1 2026-12-04 25000',
      'C0 2026-12-08 50000',
      'R2 2026-12-08 30000',
      'R2 2026-12-11 30000',
      'R3 2026-12-15 30000',
      'R3 2026-12-18 30000',
    ]);
  });
});

describe('"Semana N · até dd/mm"', () => {
  it('o último dia de cada período; o último para na véspera da devolução', () => {
    expect(periodLastDay('2026-11-24', '2026-12-22', 0, 'WEEKLY')).toBe('2026-11-30');
    expect(periodLastDay('2026-11-24', '2026-12-22', 3, 'WEEKLY')).toBe('2026-12-21');
    expect(periodLastDay('2026-11-24', '2026-12-20', 3, 'WEEKLY')).toBe('2026-12-19');
  });
});
