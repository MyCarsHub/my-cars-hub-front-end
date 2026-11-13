import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { AdminCoupon } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import {
  couponErrorMessage,
  couponPlanLabel,
  couponPlanName,
  discountSummary,
  durationNote,
  durationShort,
  durationText,
  isAllPlans,
  offerHeadline,
  openCodeMessage,
  shareMessage,
  uncoveredNote,
} from './coupon-copy';
import { redemptionView } from './coupon-detail-copy';
import { couponPriceRows, monthlySavingsLine, planPriceRows } from './coupon-plan-prices';
import { computeCouponStats, monthlyPriceByPlan } from './coupon-stats';

const NOW = new Date('2026-11-13T12:00:00Z');

const plan = (code: string, name: string, period: 'MONTHLY' | 'YEARLY', price: number): PlanResponse => ({
  id: code,
  code,
  name,
  period,
  price,
  vehicleLimit: null,
  trialDays: 0,
  productExternalId: null,
  gateway: 'stripe',
  purchasable: true,
});

/** Os preços do canvas. */
const PLANS: PlanResponse[] = [
  plan('STARTER_MONTHLY_STRIPE', 'STARTER', 'MONTHLY', 79.9),
  plan('STARTER_YEARLY_STRIPE', 'STARTER', 'YEARLY', 799),
  plan('PRO_MONTHLY_STRIPE', 'PRO', 'MONTHLY', 149.9),
  plan('PRO_YEARLY_STRIPE', 'PRO', 'YEARLY', 1499),
  plan('SCALE_MONTHLY_STRIPE', 'SCALE', 'MONTHLY', 299),
  plan('SCALE_YEARLY_STRIPE', 'SCALE', 'YEARLY', 2990),
  { ...plan('ENTERPRISE_MONTHLY_STRIPE', 'ENTERPRISE', 'MONTHLY', 999), contactOnly: true },
];

/** BEMVINDO20: 20% em todos os planos, por 3 meses, para qualquer pessoa. */
const BEMVINDO20: AdminCoupon = {
  couponId: 'mch_1',
  mode: 'OPEN_CODE',
  status: 'ACTIVE',
  companyId: null,
  planCode: 'ALL',
  allPlans: true,
  planCodes: PLANS.filter((p) => !p.contactOnly).map((p) => p.code),
  uncoveredPlanCodes: [],
  amountOffCents: null,
  percentOff: 20,
  duration: 'REPEATING',
  durationMonths: 3,
  timesRedeemed: 4,
  maxRedemptions: 100,
  promotionCode: 'BEMVINDO20',
  expiresAt: '2026-12-13T10:00:00',
  createdAt: '2026-11-13T10:00:00',
};

const apiError = (status: number, code: string, field?: string): HttpErrorResponse =>
  new HttpErrorResponse({
    status,
    error: { message: 'texto do servidor', code, fieldErrors: field ? { [field]: 'texto do servidor' } : {} },
  });

describe('cupom de todos os planos', () => {
  it('reconhece pelo allPlans ou pelo planCode "ALL"', () => {
    expect(isAllPlans({ allPlans: true, planCode: null })).toBe(true);
    expect(isAllPlans({ planCode: 'ALL' })).toBe(true);
    expect(isAllPlans({ planCode: 'PRO_MONTHLY_STRIPE', allPlans: false })).toBe(false);
  });

  it('"ALL" vira "Todos os planos", nunca um plano chamado ALL', () => {
    expect(couponPlanName('ALL')).toBe('Todos os planos');
    expect(couponPlanLabel('ALL')).toBe('Todos os planos');
    expect(couponPlanName('PRO_MONTHLY_STRIPE')).toBe('Pro');
  });

  it('o uso aplicado e ainda sem fatura, com plano "ALL", não ganha chip de plano', () => {
    const view = redemptionView(
      {
        source: 'APPLIED_NO_INVOICE_YET',
        companyId: 'co',
        companyName: 'Litoral Locadora',
        planCode: 'ALL',
        redeemedAt: '2026-11-13T08:05:00',
        amountPaidCents: 0,
        amountWithoutDiscountCents: 0,
        discountCents: 0,
        subscriptionId: 'sub_1',
        subscriptionStatus: 'active',
      },
      0,
    );
    expect(view.plan).toBeNull();
    expect(view.pending).toBe(true);
  });
});

describe('planos que ficam de fora', () => {
  it('na prévia, diz que não está à venda; singular e plural', () => {
    expect(uncoveredNote(['PRO_MONTHLY_STRIPE'], true)).toBe(
      'O plano Pro mensal não está à venda e fica de fora deste cupom.',
    );
    expect(uncoveredNote(['PRO_MONTHLY_STRIPE', 'PRO_YEARLY_STRIPE'], true)).toBe(
      'Os planos Pro mensal e Pro anual não estão à venda e ficam de fora deste cupom.',
    );
  });

  it('no detalhe, não supõe o motivo e pede outro cupom', () => {
    expect(uncoveredNote(['SCALE_YEARLY_STRIPE'], false)).toBe(
      'O plano Scale anual fica de fora deste cupom. Para cobri-lo, crie outro cupom.',
    );
  });

  it('lista vazia ou nula: sem nota', () => {
    expect(uncoveredNote([], true)).toBeNull();
    expect(uncoveredNote(null, false)).toBeNull();
    expect(uncoveredNote(undefined, true)).toBeNull();
  });
});

describe('duração', () => {
  it('uma vez, por N meses e para sempre', () => {
    expect(durationText({ duration: 'ONCE', durationMonths: null })).toBe('uma vez');
    expect(durationText({ duration: 'REPEATING', durationMonths: 3 })).toBe('por 3 meses');
    expect(durationText({ duration: 'FOREVER', durationMonths: null })).toBe('para sempre');
    expect(durationShort({ duration: 'REPEATING', durationMonths: 1 })).toBe('1 mês');
  });

  it('cupom antigo, sem duration, continua sendo por meses', () => {
    expect(durationText({ durationMonths: 2 })).toBe('por 2 meses');
    expect(discountSummary({ amountOffCents: 10000, percentOff: null, durationMonths: 1 })).toBe(
      'R$ 100,00 de desconto por 1 mês',
    );
  });

  it('a oferta da prévia, como no canvas', () => {
    expect(offerHeadline({ amountOffCents: null, percentOff: 20, duration: 'REPEATING', durationMonths: 3 })).toBe(
      '20% de desconto por 3 meses.',
    );
    expect(offerHeadline({ amountOffCents: null, percentOff: 10, duration: 'ONCE', durationMonths: null })).toBe(
      '10% de desconto na próxima fatura.',
    );
    expect(offerHeadline({ amountOffCents: null, percentOff: 100, duration: 'FOREVER', durationMonths: null })).toBe(
      '100% de desconto, para sempre.',
    );
    expect(offerHeadline({ amountOffCents: 3000, percentOff: null, duration: 'REPEATING', durationMonths: 2 })).toBe(
      'R$ 30,00 de desconto por 2 meses.',
    );
  });

  it('a nota de quando começa: sempre na próxima fatura', () => {
    expect(durationNote({ duration: 'REPEATING', durationMonths: 3 })).toBe(
      'Começa na próxima fatura do cliente. No mensal, vale nas 3 próximas faturas. No anual, a próxima fatura do ano já sai com o desconto.',
    );
    expect(durationNote({ duration: 'ONCE' })).toContain('Vale só na próxima fatura');
    expect(durationNote({ duration: 'FOREVER' })).toBe(
      'Começa na próxima fatura e vale em todas, até você desativar o cupom.',
    );
  });
});

describe('mensagens', () => {
  it('código aberto de todos os planos: o texto do canvas (prancha H)', () => {
    expect(shareMessage({ code: 'BEMVINDO20', coupon: BEMVINDO20 })).toBe(
      'Oi! Tem desconto para você assinar o MyCarsHub.\n\n' +
        '20% de desconto nos primeiros 3 meses, em qualquer plano: Starter, Pro ou Scale.\n\n' +
        'Use o código:\nBEMVINDO20\n\n' +
        'Vale até 13/12/2026. Assine em mycarshub.app.br',
    );
  });

  it('código de uma empresa: diz o nome dela e que é de uso único (prancha H)', () => {
    const coupon: AdminCoupon = {
      ...BEMVINDO20,
      mode: 'PROMOTION_CODE',
      companyId: 'co',
      percentOff: 10,
      duration: 'ONCE',
      durationMonths: null,
      promotionCode: 'MCH-7KQ2M9XA',
    };
    expect(shareMessage({ code: 'MCH-7KQ2M9XA', coupon, company: 'Alfa Rent a Car' })).toBe(
      'Oi! Separei um desconto só para a Alfa Rent a Car no MyCarsHub.\n\n' +
        '10% de desconto na próxima fatura, no plano que vocês escolherem.\n\n' +
        'Use o código:\nMCH-7KQ2M9XA\n\n' +
        'É de uso único e vale até 13/12/2026. Assine em mycarshub.app.br',
    );
  });

  it('um plano só nomeia o plano; sem validade, não inventa data', () => {
    const coupon = { ...BEMVINDO20, planCode: 'PRO_MONTHLY_STRIPE', allPlans: false, expiresAt: null };
    const text = shareMessage({ code: 'PRO50OFF', coupon });
    expect(text).toContain('20% de desconto nos primeiros 3 meses, no plano Pro.');
    expect(text).not.toContain('Vale até');
    expect(text.endsWith('Assine em mycarshub.app.br')).toBe(true);
  });

  it('o resumo da folha depois de gerar (prancha B)', () => {
    expect(openCodeMessage('BEMVINDO20', BEMVINDO20)).toBe(
      'Use o código BEMVINDO20 na hora de assinar qualquer plano (Starter, Pro ou Scale) e ganhe 20% de desconto nos primeiros 3 meses.',
    );
  });
});

describe('erros novos do contrato', () => {
  it.each([
    ['COUPON_AMOUNT_NOT_BELOW_CHEAPEST_PLAN', 400, 'amountOffCents', 'menor que o plano mais barato'],
    ['COUPON_ALL_PLANS_SHARED_PRODUCT', 409, 'allPlans', 'Separe os produtos na Stripe'],
    ['COUPON_NO_PLAN_ON_SALE', 400, 'allPlans', 'Nenhum plano pago está à venda'],
    ['COUPON_PLAN_MISMATCH', 409, 'allPlans', 'não entra em Todos os planos'],
    ['COUPON_BELOW_MIN_CHARGE', 400, 'percentOff', 'abaixo do mínimo'],
  ])('%s tem texto próprio, sem repetir o do servidor', (code, status, field, text) => {
    const message = couponErrorMessage(apiError(status, code, field), 'create');
    expect(message).toContain(text);
    expect(message).not.toContain('texto do servidor');
  });

  it('o mesmo código em outro campo mantém o texto de antes', () => {
    expect(couponErrorMessage(apiError(409, 'COUPON_PLAN_MISMATCH', 'planCode'), 'preview')).toContain(
      'Escolha o plano que a empresa já paga',
    );
  });

  it('COUPON_INVALID de meses mostra o texto do servidor, que já é em português', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: { code: 'COUPON_INVALID', message: 'A duração vai de 1 a 36 meses.', fieldErrors: { durationMonths: 'x' } },
    });
    expect(couponErrorMessage(err, 'preview')).toBe('A duração vai de 1 a 36 meses.');
  });
});

describe('valores por plano', () => {
  it('agrupa a prévia por plano, mensal e anual lado a lado, do mais barato', () => {
    const rows = planPriceRows([
      { planCode: 'STARTER_MONTHLY_STRIPE', planName: 'STARTER', period: 'MONTHLY', listCents: 7990, discountedCents: 6392 },
      { planCode: 'STARTER_YEARLY_STRIPE', planName: 'STARTER', period: 'YEARLY', listCents: 79900, discountedCents: 63920 },
      { planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', period: 'MONTHLY', listCents: 14990, discountedCents: 11992 },
    ]);
    expect(rows).toEqual([
      {
        name: 'Starter',
        monthly: { price: 'R$ 63,92', was: 'era R$ 79,90' },
        yearly: { price: 'R$ 639,20', was: 'era R$ 799,00' },
      },
      { name: 'Pro', monthly: { price: 'R$ 119,92', was: 'era R$ 149,90' }, yearly: null },
    ]);
  });

  it('o detalhe calcula da tabela de planos: percentual em cada um, sem o Enterprise', () => {
    const rows = couponPriceRows(BEMVINDO20, PLANS);
    expect(rows.map((r) => r.name)).toEqual(['Starter', 'Pro', 'Scale']);
    expect(rows[2]).toEqual({
      name: 'Scale',
      monthly: { price: 'R$ 239,20', was: 'era R$ 299,00' },
      yearly: { price: 'R$ 2.392,00', was: 'era R$ 2.990,00' },
    });
  });

  it('valor fixo desconta o mesmo em todos, e nunca abaixo de zero', () => {
    const rows = couponPriceRows({ ...BEMVINDO20, percentOff: null, amountOffCents: 3000 }, PLANS);
    expect(rows[0].monthly?.price).toBe('R$ 49,90');
    expect(rows[0].yearly?.price).toBe('R$ 769,00');
    const free = couponPriceRows({ ...BEMVINDO20, percentOff: 100 }, PLANS);
    expect(free.every((r) => r.monthly?.price === 'R$ 0,00' && r.yearly?.price === 'R$ 0,00')).toBe(true);
  });

  it('cupom sem planCodes (resposta antiga) cobre STARTER, PRO e SCALE', () => {
    const { planCodes: _ignored, ...old } = BEMVINDO20;
    expect(couponPriceRows(old, PLANS).map((r) => r.name)).toEqual(['Starter', 'Pro', 'Scale']);
  });

  it('em %, a lista mostra quanto cada plano economiza por mês (prancha D)', () => {
    expect(monthlySavingsLine(BEMVINDO20, PLANS)).toBe('Starter R$ 15,98 · Pro R$ 29,98 · Scale R$ 59,80');
  });

  it('valor fixo e um plano só não têm essa linha', () => {
    expect(monthlySavingsLine({ ...BEMVINDO20, percentOff: null, amountOffCents: 3000 }, PLANS)).toBeNull();
    expect(monthlySavingsLine({ ...BEMVINDO20, planCode: 'PRO_MONTHLY_STRIPE', allPlans: false }, PLANS)).toBeNull();
  });
});

describe('desconto estimado do topo', () => {
  it('cupom de todos os planos em % conta pelo plano coberto mais barato', () => {
    const stats = computeCouponStats([BEMVINDO20], NOW, monthlyPriceByPlan(PLANS));
    // 4 usos x 3 meses, a 20% do Starter mensal (R$ 79,90): R$ 15,98 por mês.
    expect(stats.skippedNoPrice).toBe(0);
    expect(stats.monthsGranted).toBe(12);
    expect(stats.discountCents).toBe(1598 * 12);
  });

  it('uma vez e para sempre contam um mês por uso', () => {
    const once = computeCouponStats(
      [{ ...BEMVINDO20, duration: 'ONCE', durationMonths: null, amountOffCents: 1000, percentOff: null }],
      NOW,
      {},
    );
    expect(once.monthsGranted).toBe(4);
    expect(once.discountCents).toBe(4000);
  });
});
