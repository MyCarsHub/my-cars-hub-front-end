import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponRedemption, CouponRedemptions } from '../../../types/admin-coupon.types';
import { AdminCouponsService } from './admin-coupons.service';
import { CouponDetail } from './coupon-detail';
import { redemptionView } from './coupon-detail-copy';

const OPEN: AdminCoupon = {
  couponId: 'c-open',
  mode: 'OPEN_CODE',
  status: 'ACTIVE',
  companyId: null,
  planCode: 'PRO_MONTHLY_STRIPE',
  amountOffCents: 5000,
  percentOff: null,
  durationMonths: 3,
  timesRedeemed: 2,
  maxRedemptions: 5,
  promotionCode: 'MCH-ABCD1234',
  expiresAt: '2099-11-29T10:00:00',
  createdAt: '2026-10-30T10:00:00',
};

const DIRECT: AdminCoupon = {
  ...OPEN,
  couponId: 'c-sub',
  mode: 'APPLIED_TO_SUBSCRIPTION',
  companyId: 'co-1',
  promotionCode: null,
  expiresAt: null,
};

const PAID: CouponRedemption = {
  source: 'INVOICE',
  companyId: 'co-1',
  companyName: 'Locadora Teste',
  planCode: 'PRO_MONTHLY_STRIPE',
  redeemedAt: '2026-11-01T01:30:00Z',
  amountPaidCents: 9990,
  amountWithoutDiscountCents: 14990,
  discountCents: 5000,
  subscriptionId: 'sub_1',
  subscriptionStatus: 'active',
};

const NO_COMPANY: CouponRedemption = { ...PAID, companyId: null, companyName: null, subscriptionId: 'sub_2' };

const PENDING: CouponRedemption = {
  ...PAID,
  source: 'APPLIED_NO_INVOICE_YET',
  companyName: 'Frota Nova',
  amountPaidCents: 0,
  amountWithoutDiscountCents: 0,
  discountCents: 0,
  subscriptionId: 'sub_3',
};

const response = (over: Partial<CouponRedemptions> = {}): CouponRedemptions => ({
  coupon: OPEN,
  redemptions: [PAID, NO_COMPANY, PENDING],
  uses: 3,
  totalDiscountCents: 10000,
  truncated: false,
  ...over,
});

describe('CouponDetail', () => {
  let service: { redemptions: ReturnType<typeof vi.fn> };
  let notify: Record<'success' | 'warning' | 'error', ReturnType<typeof vi.fn>>;

  const render = (coupon: AdminCoupon = OPEN, company = 'Locadora Teste'): {
    fixture: ComponentFixture<CouponDetail>;
    el: HTMLElement;
  } => {
    const fixture = TestBed.createComponent(CouponDetail);
    fixture.componentRef.setInput('coupon', coupon);
    fixture.componentRef.setInput('company', company);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };
  const q = (el: HTMLElement, id: string): HTMLElement | null => el.querySelector(`[data-testid="${id}"]`);
  const all = (el: HTMLElement, id: string): HTMLElement[] => Array.from(el.querySelectorAll(`[data-testid="${id}"]`));

  beforeEach(() => {
    TestBed.resetTestingModule();
    service = { redemptions: vi.fn(() => of(response())) };
    notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [CouponDetail],
      providers: [
        provideNoopAnimations(),
        { provide: AdminCouponsService, useValue: service },
        { provide: NotificationService, useValue: notify },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('pede os usos do cupom aberto', () => {
    render();
    expect(service.redemptions).toHaveBeenCalledWith('c-open');
  });

  it('mostra o cabeçalho na hora e o esqueleto enquanto os usos carregam', () => {
    service.redemptions.mockReturnValue(new Subject<CouponRedemptions>());
    const { el } = render();
    expect(q(el, 'detail-title')?.textContent).toContain('MCH-ABCD1234');
    expect(q(el, 'detail-discount')?.textContent).toContain('R$ 50,00');
    expect(q(el, 'detail-discount')?.textContent).toContain('por 3 meses');
    expect(q(el, 'detail-uses')?.textContent).toContain('2 / 5');
    expect(q(el, 'detail-skeleton')).not.toBeNull();
    expect(q(el, 'detail-list')).toBeNull();
    expect(q(el, 'detail-refund-note')).toBeNull();
  });

  it('lista um uso por linha, com empresa, plano, data no fuso de São Paulo e valores', () => {
    const { el } = render();
    expect(q(el, 'detail-skeleton')).toBeNull();
    const rows = all(el, 'redemption');
    expect(rows).toHaveLength(3);
    expect(q(rows[0], 'redemption-company')?.textContent).toContain('Locadora Teste');
    expect(q(rows[0], 'redemption-plan')?.textContent?.trim()).toBe('Pro');
    // 01:30Z do dia 01/11 ainda é 31/10 às 22:30 em São Paulo.
    expect(q(rows[0], 'redemption-when')?.textContent?.trim()).toBe('31/10/2026 às 22:30');
    expect(q(rows[0], 'redemption-paid')?.textContent).toContain('R$ 99,90');
    expect(q(rows[0], 'redemption-original')?.textContent).toContain('R$ 149,90');
    expect(q(rows[0], 'redemption-discount')?.textContent).toContain('− R$ 50,00');
    expect(el.querySelector('s')).not.toBeNull();
  });

  it('empresa nula vira "Empresa não identificada"', () => {
    const { el } = render();
    expect(q(all(el, 'redemption')[1], 'redemption-company')?.textContent).toContain('Empresa não identificada');
  });

  it('uso sem fatura paga diz que aguarda a primeira fatura e não mostra valores', () => {
    const { el } = render();
    const row = all(el, 'redemption')[2];
    expect(q(row, 'redemption-pending')?.textContent?.trim()).toBe('Aplicado · aguardando 1ª fatura paga');
    expect(q(row, 'redemption-paid')).toBeNull();
    expect(q(row, 'redemption-original')).toBeNull();
  });

  it('os cartões trazem usos e o desconto concedido real', () => {
    const { el } = render();
    const uses = el.querySelector('[data-kpi="uses"]') as HTMLElement;
    const discount = el.querySelector('[data-kpi="discount"]') as HTMLElement;
    expect(uses.textContent).toContain('3');
    expect(discount.textContent).toContain('Desconto concedido');
    expect(discount.textContent).toContain('R$ 100,00');
    expect(discount.textContent).not.toContain('≈');
  });

  it('sempre mostra a nota dos estornos; a de truncado só quando o servidor avisa', () => {
    const first = render();
    expect(q(first.el, 'detail-refund-note')?.textContent).toContain('Pagamentos estornados ainda contam como uso.');
    expect(q(first.el, 'detail-truncated')).toBeNull();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CouponDetail],
      providers: [
        provideNoopAnimations(),
        { provide: AdminCouponsService, useValue: { redemptions: () => of(response({ truncated: true })) } },
        { provide: NotificationService, useValue: notify },
      ],
    });
    const { el } = render();
    expect(q(el, 'detail-truncated')?.textContent).toContain(
      'Mostrando os usos mais recentes; os mais antigos podem não aparecer.',
    );
  });

  it('sem usos, mostra o estado vazio com a dica do código aberto', () => {
    service.redemptions.mockReturnValue(of(response({ redemptions: [], uses: 0, totalDiscountCents: 0 })));
    const { el } = render();
    const empty = q(el, 'detail-empty');
    expect(empty?.textContent).toContain('Ninguém usou este cupom ainda.');
    expect(empty?.textContent).toContain('Quando alguém usar o código, aparece aqui.');
    expect(q(el, 'detail-list')).toBeNull();
  });

  it('cupom direto na assinatura mostra a empresa no lugar do código e não tem copiar', () => {
    service.redemptions.mockReturnValue(of(response({ coupon: DIRECT, redemptions: [] })));
    const { el } = render(DIRECT, 'Locadora Teste');
    expect(q(el, 'detail-title')?.textContent).toContain('Locadora Teste');
    expect(q(el, 'detail-copy')).toBeNull();
    expect(q(el, 'detail-uses')).toBeNull();
  });

  it('falha mostra o erro e "Tentar novamente" pede de novo', () => {
    service.redemptions.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const { fixture, el } = render();
    expect(q(el, 'detail-error')?.textContent).toContain('A Stripe não respondeu');
    expect(q(el, 'detail-list')).toBeNull();
    (q(el, 'detail-retry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service.redemptions).toHaveBeenCalledTimes(2);
    expect(q(el, 'detail-error')).toBeNull();
    expect(all(el, 'redemption')).toHaveLength(3);
  });

  it('404 diz que o cupom não existe e não oferece nova tentativa', () => {
    service.redemptions.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { el } = render();
    expect(q(el, 'detail-error')?.textContent).toContain('Cupom não encontrado na Stripe.');
    expect(q(el, 'detail-retry')).toBeNull();
  });

  it('copia o código pelo botão do cabeçalho', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { el } = render();
    (q(el, 'detail-copy') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('MCH-ABCD1234');
  });

  it('só as primeiras linhas entram em cascata: o atraso é limitado', () => {
    service.redemptions.mockReturnValue(
      of(response({ redemptions: Array.from({ length: 12 }, () => PAID), uses: 12 })),
    );
    const { el } = render();
    const last = all(el, 'redemption')[11];
    expect(last.style.getPropertyValue('--stagger-i')).toBe('8');
  });
});

describe('redemptionView', () => {
  it('sem plano nem desconto, não inventa chip nem preço riscado', () => {
    const view = redemptionView(
      { ...PAID, planCode: null, discountCents: 0, amountWithoutDiscountCents: 9990 },
      0,
    );
    expect(view.plan).toBeNull();
    expect(view.original).toBeNull();
    expect(view.discount).toBeNull();
  });

  it('data inválida vira traço', () => {
    expect(redemptionView({ ...PAID, redeemedAt: 'lixo' }, 0).when).toBe('—');
  });
});
