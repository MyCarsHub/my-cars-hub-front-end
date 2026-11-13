import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, AdminCouponPreview, CouponCompany } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { AdminCouponsService } from './admin-coupons.service';
import { CouponSheet, MAX_MONTHS, PREVIEW_DEBOUNCE_MS } from './coupon-sheet';

const plan = (over: Partial<PlanResponse>): PlanResponse => ({
  id: 'p',
  code: 'PRO_MONTHLY_STRIPE',
  name: 'PRO',
  period: 'MONTHLY',
  price: 149.9,
  vehicleLimit: 25,
  trialDays: 0,
  productExternalId: null,
  gateway: 'stripe',
  purchasable: true,
  ...over,
});

const PLANS = [
  plan({ id: 'st', code: 'STARTER_MONTHLY_STRIPE', name: 'STARTER', price: 79.9 }),
  plan({ id: 'sty', code: 'STARTER_YEARLY_STRIPE', name: 'STARTER', period: 'YEARLY', price: 799 }),
  plan({ id: 'pro' }),
  plan({ id: 'sc', code: 'SCALE_MONTHLY_STRIPE', name: 'SCALE', price: 299 }),
  plan({ id: 'ent', code: 'ENTERPRISE_MONTHLY_STRIPE', name: 'ENTERPRISE', price: 999, contactOnly: true }),
];

const COMPANY: CouponCompany = {
  id: 'co-1',
  name: 'Alfa Rent a Car',
  documentMasked: '45.***.***/0001-**',
  planCode: null,
  planName: null,
};

/** BEMVINDO20 do canvas: 20% em todos os planos, por 3 meses. */
const ALL_PREVIEW: AdminCouponPreview = {
  mode: 'OPEN_CODE',
  duration: 'REPEATING',
  allPlans: true,
  listAmountCents: 7990,
  discountedAmountCents: 6392,
  summary: 'Paga R$ 63,92 por 3 meses, depois R$ 79,90',
  discountedInvoices: null,
  firstFullInvoice: null,
  plans: [
    { planCode: 'STARTER_MONTHLY_STRIPE', planName: 'STARTER', period: 'MONTHLY', listAmountCents: 7990, discountedAmountCents: 6392 },
    { planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', period: 'MONTHLY', listAmountCents: 14990, discountedAmountCents: 11992 },
    { planCode: 'STARTER_YEARLY_STRIPE', planName: 'STARTER', period: 'YEARLY', listAmountCents: 79900, discountedAmountCents: 63920 },
    { planCode: 'SCALE_MONTHLY_STRIPE', planName: 'SCALE', period: 'MONTHLY', listAmountCents: 29900, discountedAmountCents: 23920 },
  ],
};

const CREATED: AdminCoupon = {
  couponId: 'c-all',
  mode: 'OPEN_CODE',
  status: 'ACTIVE',
  companyId: null,
  planCode: 'ALL',
  allPlans: true,
  planCodes: ['STARTER_MONTHLY_STRIPE', 'PRO_MONTHLY_STRIPE', 'SCALE_MONTHLY_STRIPE'],
  uncoveredPlanCodes: [],
  amountOffCents: null,
  percentOff: 20,
  duration: 'REPEATING',
  durationMonths: 3,
  timesRedeemed: 0,
  promotionCode: 'BEMVINDO20',
  expiresAt: '2026-12-13T10:00:00',
  createdAt: '2026-11-13T10:00:00',
  maxRedemptions: 100,
};

const apiError = (status: number, code: string, field: string, message = 'texto do servidor'): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: { message, code, fieldErrors: { [field]: message } } });

describe('CouponSheet — todos os planos e duração', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let writeText: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<CouponSheet>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(testId: string): T =>
    el().querySelector(`[data-testid="${testId}"]`) as T;

  const render = (company: CouponCompany | null = null): void => {
    fixture = TestBed.createComponent(CouponSheet);
    fixture.componentRef.setInput('company', company);
    fixture.detectChanges();
  };

  const type = (testId: string, value: string): void => {
    const input = q<HTMLInputElement | HTMLTextAreaElement>(testId);
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));
    fixture.detectChanges();
  };

  const click = (testId: string): void => {
    q(testId).click();
    fixture.detectChanges();
  };

  const choosePlan = (value: string): void => {
    const select = q<HTMLSelectElement>('coupon-plan');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  };

  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS + 1);
    fixture.detectChanges();
  };

  const lastBody = (): Record<string, unknown> =>
    service['preview'].mock.lastCall?.[0] as Record<string, unknown>;

  /** Código aberto, todos os planos, 20% por 3 meses. */
  const fillOpenAllPlans = async (): Promise<void> => {
    render();
    click('coupon-audience-open');
    choosePlan('ALL');
    click('coupon-kind-percent');
    type('coupon-percent', '20');
    type('coupon-months', '3');
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    service = {
      plans: vi.fn(() => of(PLANS)),
      preview: vi.fn(() => of(ALL_PREVIEW)),
      create: vi.fn(() => of(CREATED)),
      searchCompanies: vi.fn(() => of([COMPANY])),
      company: vi.fn(() => of(COMPANY)),
    };
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      imports: [CouponSheet],
      providers: [
        { provide: AdminCouponsService, useValue: service },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('plano', () => {
    it('a primeira opção é Todos os planos, e o Enterprise fica de fora', () => {
      render();
      const options = Array.from(q<HTMLSelectElement>('coupon-plan').options).filter((o) => o.value);
      expect(options[0].value).toBe('ALL');
      expect(options[0].textContent?.trim()).toBe('Todos os planos (Starter, Pro e Scale)');
      expect(options.map((o) => o.value)).not.toContain('ENTERPRISE_MONTHLY_STRIPE');
    });

    it('Todos os planos manda allPlans e planCode nulo, nunca os dois', async () => {
      await fillOpenAllPlans();
      const body = lastBody();
      expect(body['allPlans']).toBe(true);
      expect(body['planCode']).toBeNull();
      expect(q('coupon-plan-all-hint').textContent).toContain('O Enterprise fica de fora');
    });

    it('vale nos três modos: empresa com assinatura também manda allPlans', async () => {
      render({ ...COMPANY, planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' });
      choosePlan('ALL');
      type('coupon-amount', '10,00');
      click('coupon-duration-once');
      await settle();
      expect(lastBody()).toEqual({
        companyId: 'co-1',
        planCode: null,
        allPlans: true,
        amountOffCents: 1000,
        percentOff: null,
        duration: 'ONCE',
        durationMonths: null,
        reason: '',
      });
    });
  });

  describe('duração', () => {
    it('Por meses aceita de 1 a 36 e manda REPEATING com os meses', async () => {
      await fillOpenAllPlans();
      expect(lastBody()).toEqual(expect.objectContaining({ duration: 'REPEATING', durationMonths: 3 }));
      type('coupon-months', String(MAX_MONTHS));
      await settle();
      expect(lastBody()).toEqual(expect.objectContaining({ durationMonths: 36 }));
    });

    it('fora da faixa mostra o erro e não pergunta nada', async () => {
      await fillOpenAllPlans();
      service['preview'].mockClear();
      for (const bad of ['0', '37', '3,5']) {
        type('coupon-months', bad);
        await settle();
        expect(q('coupon-months-error').textContent).toContain('De 1 a 36 meses');
      }
      expect(service['preview']).not.toHaveBeenCalled();
    });

    it('a folha abre com os meses vazios: sem meses, sem prévia e sem erro', async () => {
      render();
      click('coupon-audience-open');
      choosePlan('ALL');
      type('coupon-amount', '10,00');
      await settle();
      expect(q<HTMLInputElement>('coupon-months').value).toBe('');
      expect(q('coupon-months-error')).toBeNull();
      expect(service['preview']).not.toHaveBeenCalled();
    });

    it('Uma vez e Para sempre mandam durationMonths nulo e escondem os meses', async () => {
      await fillOpenAllPlans();
      click('coupon-duration-once');
      await settle();
      expect(lastBody()).toEqual(expect.objectContaining({ duration: 'ONCE', durationMonths: null }));
      expect(q('coupon-months')).toBeNull();
      expect(q('coupon-duration-hint').textContent).toContain('só na próxima fatura');
      click('coupon-duration-forever');
      await settle();
      expect(lastBody()).toEqual(expect.objectContaining({ duration: 'FOREVER', durationMonths: null }));
      expect(q('coupon-duration-hint').textContent).toContain('vale em todas, até você desativar o cupom');
    });

    it('na assinatura, Para sempre mostra a data "em diante" e nenhuma fatura cheia', async () => {
      service['preview'].mockReturnValue(
        of({
          mode: 'APPLIED_TO_SUBSCRIPTION',
          duration: 'FOREVER',
          listAmountCents: 14990,
          discountedAmountCents: 9990,
          summary: 'Paga R$ 99,90 em todas as faturas',
          discountedInvoices: ['2026-12-10T10:00:00'],
          firstFullInvoice: null,
        } satisfies AdminCouponPreview),
      );
      render({ ...COMPANY, planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' });
      type('coupon-amount', '50,00');
      click('coupon-duration-forever');
      await settle();
      expect(q('coupon-headline').textContent).toContain('Paga R$ 99,90 em todas as faturas');
      expect(q('coupon-discounted-dates').textContent).toContain('10/12/2026 em diante');
      expect(q('coupon-first-full').textContent?.trim()).toBe('Não tem');
    });
  });

  describe('prévia por plano', () => {
    it('mostra a oferta e quanto cada plano paga, no mensal e no anual', async () => {
      await fillOpenAllPlans();
      expect(q('coupon-headline').textContent?.trim()).toBe('20% de desconto por 3 meses.');
      const rows = Array.from(el().querySelectorAll('[data-testid="coupon-plan-price-row"]'));
      expect(rows.map((r) => r.querySelector('[role="rowheader"]')?.textContent?.trim())).toEqual([
        'Starter',
        'Pro',
        'Scale',
      ]);
      const starter = rows[0].textContent ?? '';
      expect(starter).toContain('R$ 63,92');
      expect(starter).toContain('era R$ 79,90');
      expect(starter).toContain('R$ 639,20');
      expect(starter).toContain('era R$ 799,00');
      expect(q('coupon-price-note').textContent).toContain('No mensal, vale nas 3 próximas faturas');
    });

    it('um plano só continua com o resumo do servidor, sem tabela', async () => {
      service['preview'].mockReturnValue(of({ ...ALL_PREVIEW, allPlans: false, plans: undefined }));
      render();
      click('coupon-audience-open');
      choosePlan('PRO_MONTHLY_STRIPE');
      type('coupon-amount', '10,00');
      type('coupon-months', '3');
      await settle();
      expect(q('coupon-headline').textContent).toContain('Paga R$ 63,92 por 3 meses');
      expect(q('coupon-plan-prices')).toBeNull();
    });
  });

  describe('limite do valor em R$', () => {
    it('avisa o limite antes de digitar', () => {
      render();
      click('coupon-audience-open');
      choosePlan('ALL');
      expect(q('coupon-amount-limit').textContent).toContain(
        'Em todos os planos, o valor precisa ser menor que R$ 79,90: é o Starter mensal, o plano mais barato.',
      );
    });

    it('valor igual ou acima do mais barato mostra o erro e desliga o botão', async () => {
      render();
      click('coupon-audience-open');
      choosePlan('ALL');
      type('coupon-months', '2');
      type('coupon-reason', 'Teste');
      type('coupon-amount', '100,00');
      await settle();
      expect(q('coupon-amount-limit-error').textContent).toContain(
        'R$ 100,00 é mais que o Starter mensal (R$ 79,90), o plano mais barato.',
      );
      expect(q<HTMLInputElement>('coupon-amount').getAttribute('aria-invalid')).toBe('true');
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(true);
      expect(service['preview']).not.toHaveBeenCalled();
      type('coupon-amount', '79,90');
      await settle();
      expect(q('coupon-amount-limit-error').textContent).toContain('é o preço do Starter mensal');
    });

    it('um plano só não tem esse limite', () => {
      render();
      click('coupon-audience-open');
      choosePlan('PRO_MONTHLY_STRIPE');
      expect(q('coupon-amount-limit')).toBeNull();
    });
  });

  describe('100% para sempre', () => {
    const fillFree = async (): Promise<void> => {
      render();
      click('coupon-audience-open');
      choosePlan('ALL');
      click('coupon-kind-percent');
      type('coupon-percent', '100');
      click('coupon-duration-forever');
      type('coupon-reason', 'Parceiras');
      await settle();
    };

    it('nada bloqueia: só pede uma confirmação antes de criar', async () => {
      await fillFree();
      click('coupon-submit');
      expect(service['create']).not.toHaveBeenCalled();
      expect(q('coupon-free-confirm').textContent).toContain('Esse cupom deixa o plano grátis para sempre. Confirmar?');
      click('coupon-free-confirm-button');
      expect(service['create']).toHaveBeenCalledWith(
        expect.objectContaining({ percentOff: 100, duration: 'FOREVER', durationMonths: null, allPlans: true }),
      );
    });

    it('Voltar não cria nada', async () => {
      await fillFree();
      click('coupon-submit');
      click('coupon-free-cancel');
      expect(q('coupon-free-confirm')).toBeNull();
      expect(service['create']).not.toHaveBeenCalled();
    });

    it('99% para sempre não pede confirmação', async () => {
      render();
      click('coupon-audience-open');
      choosePlan('ALL');
      click('coupon-kind-percent');
      type('coupon-percent', '99');
      click('coupon-duration-forever');
      type('coupon-reason', 'Parceiras');
      await settle();
      click('coupon-submit');
      expect(service['create']).toHaveBeenCalled();
    });
  });

  describe('depois de criar', () => {
    it('resume a oferta de todos os planos e copia a mensagem nova', async () => {
      await fillOpenAllPlans();
      type('coupon-reason', 'Campanha de lançamento de novembro.');
      click('coupon-submit');
      expect(q('coupon-share-message').textContent?.trim()).toBe(
        'Use o código BEMVINDO20 na hora de assinar qualquer plano (Starter, Pro ou Scale) e ganhe 20% de desconto nos primeiros 3 meses.',
      );
      click('coupon-copy-message');
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledWith(
        [
          'Oi! Tem desconto para você assinar o MyCarsHub.',
          '20% de desconto nos primeiros 3 meses, em qualquer plano: Starter, Pro ou Scale.',
          'Use o código:\nBEMVINDO20',
          'Vale até 13/12/2026. Assine em mycarshub.app.br',
        ].join('\n\n'),
      );
    });
  });

  describe('erros do servidor', () => {
    it.each([
      ['COUPON_AMOUNT_NOT_BELOW_CHEAPEST_PLAN', 400, 'amountOffCents', 'menor que o plano mais barato'],
      ['COUPON_ALL_PLANS_SHARED_PRODUCT', 409, 'allPlans', 'Separe os produtos na Stripe'],
      ['COUPON_NO_PLAN_ON_SALE', 400, 'allPlans', 'Nenhum plano pago está à venda'],
      ['COUPON_PLAN_MISMATCH', 409, 'allPlans', 'não entra em Todos os planos'],
    ])('%s vira texto próprio na prévia', async (code, status, field, text) => {
      service['preview'].mockReturnValue(throwError(() => apiError(status, code, field)));
      await fillOpenAllPlans();
      const banner = q('coupon-preview-error').textContent ?? '';
      expect(banner).toContain(text);
      expect(banner).not.toContain('texto do servidor');
    });
  });
});
