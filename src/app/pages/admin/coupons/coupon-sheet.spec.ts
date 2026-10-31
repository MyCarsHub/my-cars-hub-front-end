import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, AdminCouponPreview, CouponCompany } from '../../../types/admin-coupon.types';
import { PlanResponse } from '../../../types/billing.types';
import { AdminCouponsService } from './admin-coupons.service';
import { CREATE_TIMEOUT_MS, CouponSheet, PREVIEW_DEBOUNCE_MS } from './coupon-sheet';

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
  plan({ id: 'trial', code: 'TRIAL_MONTHLY_STRIPE', name: 'TRIAL', price: 0 }),
  plan({ id: 'st', code: 'STARTER_MONTHLY_STRIPE', name: 'STARTER', price: 79.9 }),
  plan({ id: 'pro' }),
  plan({ id: 'soon', code: 'SCALE_MONTHLY_STRIPE', name: 'SCALE', price: 299, purchasable: false }),
  plan({ id: 'ent', code: 'ENTERPRISE_MONTHLY_STRIPE', name: 'ENTERPRISE', price: 999, contactOnly: true }),
  plan({ id: 'abacate', code: 'PRO_MONTHLY_ABACATE', gateway: 'abacate' }),
];

const COMPANY: CouponCompany = {
  id: 'co-1',
  name: 'Locadora Teste',
  documentMasked: '12.345.678/0001-90',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
};

const APPLIED_PREVIEW: AdminCouponPreview = {
  mode: 'APPLIED_TO_SUBSCRIPTION',
  listAmountCents: 14990,
  discountedAmountCents: 10000,
  summary: 'Paga R$ 100,00 por 2 meses, depois R$ 149,90',
  discountedInvoices: ['2026-11-13T10:00:00', '2026-12-13T10:00:00'],
  firstFullInvoice: '2027-01-13T10:00:00',
};

const CODE_PREVIEW: AdminCouponPreview = {
  ...APPLIED_PREVIEW,
  mode: 'PROMOTION_CODE',
  discountedInvoices: null,
  firstFullInvoice: null,
};

const CREATED: AdminCoupon = {
  couponId: 'abc',
  mode: 'PROMOTION_CODE',
  status: 'ACTIVE',
  companyId: 'co-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  amountOffCents: 4990,
  percentOff: null,
  durationMonths: 2,
  timesRedeemed: 0,
  promotionCode: 'MCH-7KQ2M9XA',
  expiresAt: '2026-11-29T10:00:00',
  createdAt: '2026-10-30T10:00:00',
};

const apiError = (status: number, code?: string, message = 'texto do servidor'): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: { message, code } });

describe('CouponSheet', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let notify: Record<'success' | 'error' | 'warning', ReturnType<typeof vi.fn>>;
  let writeText: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<CouponSheet>;

  const q = <T extends HTMLElement>(testId: string): T =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`) as T;

  const render = (company: CouponCompany | null = COMPANY): void => {
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

  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS + 1);
    fixture.detectChanges();
  };

  const fill = async (amount = '49,90'): Promise<void> => {
    type('coupon-amount', amount);
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    service = {
      plans: vi.fn(() => of(PLANS)),
      preview: vi.fn(() => of(APPLIED_PREVIEW)),
      create: vi.fn(() => of(CREATED)),
      searchCompanies: vi.fn(() => of([COMPANY])),
      company: vi.fn(() => of(COMPANY)),
    };
    notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      imports: [CouponSheet],
      providers: [
        { provide: AdminCouponsService, useValue: service },
        { provide: NotificationService, useValue: notify },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('formulário', () => {
    it('só oferece plano pago, da Stripe, à venda', () => {
      render();
      const options = Array.from(q<HTMLSelectElement>('coupon-plan').options).map((o) => o.value).filter(Boolean);
      expect(options).toEqual(['STARTER_MONTHLY_STRIPE', 'PRO_MONTHLY_STRIPE']);
    });

    it('pré-seleciona o plano atual da empresa', () => {
      render();
      expect(q<HTMLSelectElement>('coupon-plan').value).toBe('PRO_MONTHLY_STRIPE');
    });

    it('empresa preenchida aparece e pode ser trocada', () => {
      render();
      expect(q('coupon-company-selected').textContent).toContain('Locadora Teste');
      q('coupon-company-change').click();
      fixture.detectChanges();
      expect(q('coupon-company-search')).not.toBeNull();
    });

    it('busca empresa e, ao escolher, adota o plano dela', async () => {
      render(null);
      type('coupon-company-search', 'loca');
      await settle();
      expect(service['searchCompanies']).toHaveBeenCalledExactlyOnceWith('loca');
      q('coupon-company-option').click();
      fixture.detectChanges();
      expect(q('coupon-company-selected').textContent).toContain('Locadora Teste');
      expect(q<HTMLSelectElement>('coupon-plan').value).toBe('PRO_MONTHLY_STRIPE');
    });

    it('todo campo tem 16px e alvo de pelo menos 44px', () => {
      render(null);
      const fields = (fixture.nativeElement as HTMLElement).querySelectorAll('input, select, textarea');
      expect(fields.length).toBeGreaterThanOrEqual(4);
      fields.forEach((field) => {
        expect(field.className).toContain('text-base');
        expect(field.className).toMatch(/min-h-12/);
      });
    });

    it('o valor em R$ é texto mascarado', () => {
      render();
      const input = q<HTMLInputElement>('coupon-amount');
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('decimal');
      type('coupon-amount', '1234,5');
      expect(q<HTMLInputElement>('coupon-amount').value).toBe('1.234,5');
    });
  });

  describe('prévia ao vivo', () => {
    it('só pergunta com empresa, plano, desconto e meses', async () => {
      render(null);
      type('coupon-amount', '49,90');
      await settle();
      expect(service['preview']).not.toHaveBeenCalled();
    });

    it('junta as teclas numa consulta só e manda centavos', async () => {
      render();
      type('coupon-amount', '4');
      type('coupon-amount', '49');
      type('coupon-amount', '49,90');
      await settle();
      expect(service['preview']).toHaveBeenCalledTimes(1);
      expect(service['preview']).toHaveBeenCalledWith({
        companyId: 'co-1',
        planCode: 'PRO_MONTHLY_STRIPE',
        amountOffCents: 4990,
        percentOff: null,
        durationMonths: 1,
        reason: '',
      });
    });

    it('em percentual manda percentOff e nunca os dois', async () => {
      render();
      q('coupon-kind-percent').click();
      fixture.detectChanges();
      type('coupon-percent', '12,5');
      await settle();
      expect(service['preview']).toHaveBeenCalledWith(
        expect.objectContaining({ amountOffCents: null, percentOff: 12.5 }),
      );
    });

    it('mostra o resumo, as faturas com desconto e a primeira cheia', async () => {
      render();
      await fill();
      const preview = q('coupon-preview');
      expect(preview.textContent).toContain('Paga R$ 100,00 por 2 meses, depois R$ 149,90');
      expect(preview.textContent).toContain('13/11/2026');
      expect(preview.textContent).toContain('13/12/2026');
      expect(preview.textContent).toContain('13/01/2027');
    });

    it('diz que o desconto vai direto na assinatura', async () => {
      render();
      await fill();
      expect(q('coupon-mode').textContent).toMatch(/direto na assinatura/i);
      expect(q('coupon-submit').textContent).toMatch(/aplicar/i);
    });

    it('diz que é um código para enviar, sem inventar datas', async () => {
      service['preview'].mockReturnValue(of(CODE_PREVIEW));
      render();
      await fill();
      expect(q('coupon-mode').textContent).toMatch(/código para enviar/i);
      expect(q('coupon-submit').textContent).toMatch(/gerar código/i);
      expect(q('coupon-preview').textContent).not.toContain('13/11/2026');
    });

    it('sem fatura na janela: tira a frase falsa e não deixa criar', async () => {
      service['preview'].mockReturnValue(of({ ...APPLIED_PREVIEW, discountedInvoices: [] }));
      render();
      type('coupon-reason', 'Negociação');
      await fill();
      expect(q('coupon-no-invoice').textContent).toMatch(/nenhuma fatura/i);
      expect(q('coupon-preview').textContent).not.toContain('Paga R$ 100,00');
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(true);
    });

    it('resposta velha não sobrescreve a nova', async () => {
      const slow = new Subject<AdminCouponPreview>();
      service['preview'].mockReturnValueOnce(slow).mockReturnValueOnce(of(CODE_PREVIEW));
      render();
      await fill('10,00');
      await fill('20,00');
      slow.next(APPLIED_PREVIEW);
      fixture.detectChanges();
      expect(q('coupon-mode').textContent).toMatch(/código para enviar/i);
    });

    it.each([
      ['COUPON_ZEROES_PLAN', 400, /zera o plano/i],
      ['COUPON_PLAN_MISMATCH', 409, /plano atual/i],
      ['COUPON_ALREADY_APPLIED', 409, /já tem um desconto/i],
      ['COUPON_NO_OWNER', 409, /dono/i],
      ['COUPON_NO_INVOICE_IN_WINDOW', 400, /nenhuma fatura/i],
      [undefined, 404, /empresa ou plano/i],
      [undefined, 503, /stripe/i],
    ])('%s traduz e não deixa criar', async (code, status, copy) => {
      service['preview'].mockReturnValue(throwError(() => apiError(status, code)));
      render();
      type('coupon-reason', 'Negociação');
      await fill();
      expect(q('coupon-preview-error').textContent).toMatch(copy);
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(true);
    });

    it('depois de um erro, corrigir o campo pergunta de novo', async () => {
      service['preview'].mockReturnValueOnce(throwError(() => apiError(503)));
      render();
      await fill('49,90');
      await fill('40,00');
      expect(q('coupon-preview').textContent).toContain('Paga R$ 100,00');
    });
  });

  describe('criar', () => {
    const ready = async (): Promise<void> => {
      type('coupon-reason', 'Negociação com o dono');
      await fill();
    };

    it('exige motivo', async () => {
      render();
      await fill();
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(true);
      type('coupon-reason', '   ');
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(true);
      type('coupon-reason', 'Negociação');
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(false);
    });

    it('prévia desatualizada trava o botão até responder', async () => {
      render();
      await ready();
      service['preview'].mockReturnValue(NEVER);
      type('coupon-amount', '10,00');
      expect(q<HTMLButtonElement>('coupon-submit').disabled).toBe(true);
    });

    it('dois cliques criam um cupom só, com o motivo', async () => {
      const pending = new Subject<AdminCoupon>();
      service['create'].mockReturnValue(pending);
      render();
      await ready();
      const button = q<HTMLButtonElement>('coupon-submit');
      button.click();
      button.click();
      fixture.detectChanges();
      expect(service['create']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ amountOffCents: 4990, reason: 'Negociação com o dono' }),
      );
      expect(button.disabled).toBe(true);
    });

    it('código criado aparece com copiar e avisa a lista', async () => {
      const saved = vi.fn();
      service['preview'].mockReturnValue(of(CODE_PREVIEW));
      render();
      fixture.componentInstance.saved.subscribe(saved);
      await ready();
      q('coupon-submit').click();
      fixture.detectChanges();
      expect(q('coupon-created-code').textContent).toContain('MCH-7KQ2M9XA');
      expect(q('coupon-done').textContent).toContain('29/11/2026');
      expect(saved).toHaveBeenCalledWith({ coupon: CREATED, company: COMPANY });
      q('coupon-copy').click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledWith('MCH-7KQ2M9XA');
      expect(notify.success).toHaveBeenCalledWith('Código copiado.');
    });

    it('desconto aplicado não mostra código nenhum', async () => {
      service['create'].mockReturnValue(of({ ...CREATED, mode: 'APPLIED_TO_SUBSCRIPTION', promotionCode: null, expiresAt: null }));
      render();
      await ready();
      q('coupon-submit').click();
      fixture.detectChanges();
      expect(q('coupon-done').textContent).toMatch(/aplicado/i);
      expect(q('coupon-done').textContent).toContain('Paga R$ 100,00');
      expect(q('coupon-created-code')).toBeNull();
    });

    it('sem resposta da criação, solta a folha e não finge que falhou', async () => {
      service['create'].mockReturnValue(NEVER);
      const changed = vi.fn();
      render();
      fixture.componentInstance.listMayHaveChanged.subscribe(changed);
      await ready();
      q('coupon-submit').click();
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(CREATE_TIMEOUT_MS + 1);
      fixture.detectChanges();
      expect(q('coupon-create-error').textContent).toMatch(/confira a lista/i);
      expect(q<HTMLButtonElement>('coupon-submit').textContent).not.toMatch(/criando/i);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('503 na criação pede para a lista reler', async () => {
      service['create'].mockReturnValue(throwError(() => apiError(503)));
      const changed = vi.fn();
      render();
      fixture.componentInstance.listMayHaveChanged.subscribe(changed);
      await ready();
      q('coupon-submit').click();
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('recusa de negócio não mexe na lista', async () => {
      service['create'].mockReturnValue(throwError(() => apiError(409, 'COUPON_ALREADY_APPLIED')));
      const changed = vi.fn();
      render();
      fixture.componentInstance.listMayHaveChanged.subscribe(changed);
      await ready();
      q('coupon-submit').click();
      expect(changed).not.toHaveBeenCalled();
    });

    it.each([
      ['COUPON_ZEROES_PLAN', 400, /zera o plano/i],
      ['COUPON_PLAN_MISMATCH', 409, /plano atual/i],
      ['COUPON_ALREADY_APPLIED', 409, /já tem um desconto/i],
      ['COUPON_NO_OWNER', 409, /dono/i],
      ['COUPON_NO_INVOICE_IN_WINDOW', 400, /nenhuma fatura/i],
      [undefined, 503, /confira a lista/i],
      [undefined, 403, /dono/i],
      [undefined, 404, /empresa ou plano/i],
    ])('%s na criação traduz e mantém o formulário', async (code, status, copy) => {
      service['create'].mockReturnValue(throwError(() => apiError(status, code)));
      render();
      await ready();
      q('coupon-submit').click();
      fixture.detectChanges();
      expect(q('coupon-create-error').textContent).toMatch(copy);
      expect(q<HTMLInputElement>('coupon-amount').value).toBe('49,90');
      expect(q('coupon-done')).toBeNull();
    });
  });
});
