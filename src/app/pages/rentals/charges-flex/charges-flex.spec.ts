import { describe, expect, it } from 'vitest';

import {
  EMPTY_PLAN,
  addDaysIso,
  buildChargePlan,
  buildInstalments,
  discountFor,
  flexChargeLabel,
  instalmentProblems,
  intervalToDays,
  isReceivableOutsideCharge,
  isRenegotiableCharge,
  percentTextToBps,
  renegotiatedTotalCents,
  splitEvenly,
} from './charges-flex';

describe('charges-flex — regras puras (FEAT-0573)', () => {
  describe('splitEvenly: centavos que sobram vão na última', () => {
    it('R$ 650,00 em 3 → 216,66 / 216,66 / 216,68', () => {
      expect(splitEvenly(65_000, 3)).toEqual([21_666, 21_666, 21_668]);
    });

    it('multa fixa de R$ 10,00 em 3 → 3,33 / 3,33 / 3,34', () => {
      expect(splitEvenly(1_000, 3)).toEqual([333, 333, 334]);
    });

    it('multa de R$ 50,00 em 3 → 16,66 / 16,66 / 16,68 (canvas C3)', () => {
      expect(splitEvenly(5_000, 3)).toEqual([1_666, 1_666, 1_668]);
    });

    it('sempre soma o total', () => {
      for (const [total, n] of [[160_000, 4], [1, 2], [99_999, 7]] as const) {
        expect(splitEvenly(total, n).reduce((a, b) => a + b, 0)).toBe(total);
      }
    });
  });

  describe('datas e intervalos (G5: dias, semanas, meses de 30 dias)', () => {
    it('converte a unidade em dias', () => {
      expect(intervalToDays(2, 'DAYS')).toBe(2);
      expect(intervalToDays(1, 'WEEKS')).toBe(7);
      expect(intervalToDays(2, 'MONTHS')).toBe(60);
    });

    it('soma dias atravessando o mês e o ano', () => {
      expect(addDaysIso('2026-12-30', 7)).toBe('2027-01-06');
    });

    it('monta as parcelas com a 1ª na data escolhida', () => {
      expect(buildInstalments(75_000, 3, '2026-11-16', 2)).toEqual([
        { dueDate: '2026-11-16', amountCents: 25_000 },
        { dueDate: '2026-11-18', amountCents: 25_000 },
        { dueDate: '2026-11-20', amountCents: 25_000 },
      ]);
    });
  });

  describe('instalmentProblems (textos do contrato B2)', () => {
    const today = '2026-11-12';

    it('aceita parcelas certas', () => {
      expect(instalmentProblems(buildInstalments(75_000, 3, today, 7), { expectedTotal: 75_000, today, minCents: 500 })).toEqual([]);
    });

    it('recusa parcela abaixo de R$ 5,00 no Asaas', () => {
      const [p] = instalmentProblems([{ dueDate: today, amountCents: 499 }, { dueDate: today, amountCents: 501 }], {
        expectedTotal: 1_000,
        today,
        minCents: 500,
      });
      expect(p).toBe('Cada parcela precisa ser de pelo menos R$ 5,00. A parcela 1 ficou com R$ 4,99.');
    });

    it('recusa soma diferente, data passada e ordem trocada', () => {
      const problems = instalmentProblems(
        [{ dueDate: '2026-11-20', amountCents: 1_000 }, { dueDate: '2026-11-01', amountCents: 1_000 }],
        { expectedTotal: 3_000, today, minCents: 1 },
      );
      expect(problems).toContain('As parcelas somam R$ 20,00, mas o valor da cobrança é R$ 30,00.');
      expect(problems).toContain('As datas das parcelas precisam ser de hoje em diante.');
      expect(problems).toContain('As datas das parcelas precisam estar em ordem.');
    });
  });

  describe('desconto (G4: % arredondado HALF_UP por cobrança)', () => {
    it('valor fixo', () => {
      expect(discountFor(75_000, 'AMOUNT', 10_000)).toBe(10_000);
    });

    it('porcentagem em basis points, meio centavo para cima', () => {
      // 12,5% de R$ 333,33 = 41,66625 → 41,67
      expect(discountFor(33_333, 'PERCENT', 1_250)).toBe(4_167);
    });

    it('texto do % vira basis points', () => {
      expect(percentTextToBps('10')).toBe(1_000);
      expect(percentTextToBps('12,5')).toBe(1_250);
      expect(percentTextToBps('abc')).toBeNull();
      expect(percentTextToBps('')).toBeNull();
    });
  });

  describe('buildChargePlan', () => {
    it('sem nada escolhido é null (a chave chargePlan nem vai no corpo)', () => {
      expect(buildChargePlan(EMPTY_PLAN)).toBeNull();
    });

    it('B — desconto de R$ 100,00 nas 3 primeiras', () => {
      expect(
        buildChargePlan({ ...EMPTY_PLAN, discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 } }),
      ).toEqual({ discount: { type: 'AMOUNT', value: 10_000, firstPeriods: 3 }, defaultSplit: null, overrides: null });
    });

    it('C — caução 1.300 + 200 e a Semana 1 em 3 parcelas', () => {
      const plan = buildChargePlan({
        ...EMPTY_PLAN,
        caucaoParts: [
          { dueDate: '2026-11-16', amountCents: 130_000 },
          { dueDate: '2026-11-21', amountCents: 20_000 },
        ],
        periodOverrides: [{ periodIndex: 0, instalments: buildInstalments(75_000, 3, '2026-11-16', 2) }],
      });
      expect(plan?.discount).toBeNull();
      expect(plan?.defaultSplit).toBeNull();
      expect(plan?.overrides).toEqual([
        { target: 'CAUCAO', periodIndex: null, instalments: [{ dueDate: '2026-11-16', amountCents: 130_000 }, { dueDate: '2026-11-21', amountCents: 20_000 }] },
        { target: 'PERIOD', periodIndex: 0, instalments: buildInstalments(75_000, 3, '2026-11-16', 2) },
      ]);
    });

    it('parcelar todas vira defaultSplit', () => {
      expect(
        buildChargePlan({ ...EMPTY_PLAN, splitAll: { count: 2, intervalN: 7, intervalUnit: 'DAYS' } })?.defaultSplit,
      ).toEqual({ count: 2, intervalDays: 7, intervalUnit: 'DAYS' });
    });

    it('desconto vazio não entra', () => {
      expect(buildChargePlan({ ...EMPTY_PLAN, discount: { type: 'AMOUNT', value: null, firstPeriods: 3 } })).toBeNull();
    });
  });

  describe('rótulos', () => {
    it('cobrança inteira não ganha rótulo novo (fica o de hoje)', () => {
      expect(flexChargeLabel({ kind: 'RENTAL_PERIOD', periodIndex: 0 }, 'WEEKLY')).toBeNull();
      expect(flexChargeLabel({ kind: 'CAUCAO', periodIndex: null, instalmentIndex: 1, instalmentCount: 1 }, 'WEEKLY')).toBeNull();
    });

    it('parcela de período, parte de caução e parcela de acordo', () => {
      expect(flexChargeLabel({ kind: 'RENTAL_PERIOD', periodIndex: 0, instalmentIndex: 2, instalmentCount: 3 }, 'WEEKLY')).toBe(
        'Semana 1, parcela 2 de 3',
      );
      expect(flexChargeLabel({ kind: 'CAUCAO', periodIndex: null, instalmentIndex: 1, instalmentCount: 2 }, 'WEEKLY')).toBe(
        'Caução, parte 1 de 2',
      );
      expect(flexChargeLabel({ kind: 'AGREEMENT', periodIndex: null, instalmentIndex: 1, instalmentCount: 4, agreementSeq: 1 }, 'WEEKLY')).toBe(
        'Acordo, parcela 1 de 4',
      );
      expect(flexChargeLabel({ kind: 'AGREEMENT', periodIndex: null, instalmentIndex: 3, instalmentCount: 3, agreementSeq: 2 }, 'MONTHLY')).toBe(
        'Acordo 2, parcela 3 de 3',
      );
    });
  });

  describe('o que pode entrar num acordo / ser recebido por fora (G7)', () => {
    it.each([
      ['RENTAL_PERIOD', 'PAST_DUE', true],
      ['RENTAL_TOTAL', 'PENDING', true],
      ['CAUCAO', 'FAILED', true],
      ['AGREEMENT', 'PENDING', true],
      ['ADJUSTMENT', 'PENDING', false],
      ['OVERDUE_FEE', 'PAST_DUE', false],
      ['RENTAL_PERIOD', 'PAID', false],
      ['RENTAL_PERIOD', 'RENEGOTIATED', false],
      ['RENTAL_PERIOD', 'DISPUTED', false],
    ] as const)('%s %s → %s', (kind, status, ok) => {
      expect(isRenegotiableCharge({ kind, status })).toBe(ok);
      expect(isReceivableOutsideCharge({ kind, status })).toBe(ok);
    });

    it('soma só o que virou acordo', () => {
      expect(
        renegotiatedTotalCents([
          { status: 'RENEGOTIATED', amount: 75_000 },
          { status: 'RENEGOTIATED', amount: 75_000 },
          { status: 'PAID', amount: 75_000 },
        ]),
      ).toBe(150_000);
    });
  });
});
