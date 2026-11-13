import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon, CouponRedemptions } from '../../../types/admin-coupon.types';
import type { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { PlanResponse } from '../../../types/billing.types';
import { AdminCoupons } from './admin-coupons';
import { AdminCouponsService } from './admin-coupons.service';
import { CouponCardRenderer } from './coupon-card-image';
import { CouponDetail } from './coupon-detail';

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

const PLANS: PlanResponse[] = [
  plan('STARTER_MONTHLY_STRIPE', 'STARTER', 'MONTHLY', 79.9),
  plan('STARTER_YEARLY_STRIPE', 'STARTER', 'YEARLY', 799),
  plan('PRO_MONTHLY_STRIPE', 'PRO', 'MONTHLY', 149.9),
  plan('PRO_YEARLY_STRIPE', 'PRO', 'YEARLY', 1499),
  plan('SCALE_MONTHLY_STRIPE', 'SCALE', 'MONTHLY', 299),
  plan('SCALE_YEARLY_STRIPE', 'SCALE', 'YEARLY', 2990),
];

const BEMVINDO20: AdminCoupon = {
  couponId: 'mch_all',
  mode: 'OPEN_CODE',
  status: 'ACTIVE',
  companyId: null,
  planCode: 'ALL',
  allPlans: true,
  planCodes: PLANS.map((p) => p.code),
  uncoveredPlanCodes: [],
  amountOffCents: null,
  percentOff: 20,
  duration: 'REPEATING',
  durationMonths: 3,
  timesRedeemed: 4,
  maxRedemptions: 100,
  promotionCode: 'BEMVINDO20',
  expiresAt: '2099-12-13T10:00:00',
  createdAt: '2026-11-13T10:00:00',
};

const HORIZONTE: AdminCoupon = {
  couponId: 'mch_sub',
  mode: 'APPLIED_TO_SUBSCRIPTION',
  status: 'ACTIVE',
  companyId: 'co-1',
  planCode: 'STARTER_MONTHLY_STRIPE',
  amountOffCents: null,
  percentOff: 10,
  duration: 'ONCE',
  durationMonths: null,
  timesRedeemed: 1,
  promotionCode: null,
  expiresAt: null,
  createdAt: '2026-11-13T10:00:00',
};

const DONO: AdminCapabilityCode[] = ['ver', 'cupom.gerir'];

describe('Cupons — todos os planos na lista e compartilhar', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let render: ReturnType<typeof vi.fn>;

  const mount = (): { fixture: ComponentFixture<AdminCoupons>; el: HTMLElement } => {
    TestBed.configureTestingModule({
      imports: [AdminCoupons],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AdminCouponsService, useValue: service },
        {
          provide: AdminCapabilitiesService,
          useValue: { can: (c: AdminCapabilityCode) => DONO.includes(c), ensureLoaded: () => of(null) },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: CouponCardRenderer, useValue: { render } },
      ],
    });
    const fixture = TestBed.createComponent(AdminCoupons);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  const stubWide = (wide: boolean): void => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: wide && query.includes('min-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  };

  const card = (el: HTMLElement, text: string): HTMLElement =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="coupon-card"]')).find((c) =>
      c.textContent?.includes(text),
    ) as HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    render = vi.fn(() => Promise.resolve(new Blob(['png'], { type: 'image/png' })));
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:cupom'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    service = {
      list: vi.fn(() => of([BEMVINDO20, HORIZONTE])),
      company: vi.fn(() => of({ id: 'co-1', name: 'Locadora Horizonte', documentMasked: null, planCode: null, planName: null })),
      deactivate: vi.fn(() => NEVER),
      plans: vi.fn(() => of(PLANS)),
      searchCompanies: vi.fn(() => of([])),
      preview: vi.fn(() => NEVER),
      create: vi.fn(() => NEVER),
      redemptions: vi.fn(() => NEVER),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('no celular: "Todos os planos · qualquer pessoa" e quanto cada plano economiza por mês', () => {
    const { el } = mount();
    const open = card(el, 'BEMVINDO20');
    expect(open.querySelector('[data-testid="coupon-summary"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Todos os planos · qualquer pessoa',
    );
    expect(open.querySelector('[data-testid="coupon-discount"]')?.textContent).toContain('por 3 meses');
    expect(open.querySelector('[data-testid="coupon-savings"]')?.textContent?.trim()).toBe(
      'Desconto por mês: Starter R$ 15,98 · Pro R$ 29,98 · Scale R$ 59,80',
    );
    const direct = card(el, 'Locadora Horizonte');
    expect(direct.querySelector('[data-testid="coupon-summary"]')?.textContent).toContain('Plano Starter');
    expect(direct.querySelector('[data-testid="coupon-discount"]')?.textContent).toContain('uma vez');
  });

  it('no computador: a coluna Desconto traz a duração e o desconto por mês', () => {
    stubWide(true);
    const { el } = mount();
    const discount = card(el, 'BEMVINDO20').querySelector('[data-testid="coupon-discount"]')?.textContent ?? '';
    expect(discount.replace(/\s+/g, ' ')).toContain('3 meses · por mês: Starter R$ 15,98 · Pro R$ 29,98 · Scale R$ 59,80');
    expect(card(el, 'BEMVINDO20').querySelector('[data-testid="coupon-summary"]')?.textContent).toContain(
      'Todos os planos',
    );
  });

  it('o kebab ganha Compartilhar, que abre a folha com a imagem', async () => {
    const { fixture, el } = mount();
    const open = card(el, 'BEMVINDO20');
    (open.querySelector('app-actions-menu button[aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(open.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent?.trim());
    expect(items).toEqual(['Ver detalhes', 'Compartilhar', 'Copiar código', 'Desativar']);
    (open.querySelector('[data-testid="menu-share"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="coupon-share"]')).not.toBeNull();
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ code: 'BEMVINDO20' }), 'SQUARE', 'ORANGE');
  });

  it('desconto direto na assinatura não tem o que compartilhar', () => {
    const { fixture, el } = mount();
    const direct = card(el, 'Locadora Horizonte');
    (direct.querySelector('app-actions-menu button[aria-haspopup="menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(direct.querySelector('[data-testid="menu-share"]')).toBeNull();
  });

  it('Compartilhar no detalhe troca o detalhe pela folha de compartilhar', async () => {
    const { fixture, el } = mount();
    card(el, 'BEMVINDO20').click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="detail-share"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="coupon-detail"]')).toBeNull();
    expect(el.querySelector('[data-testid="coupon-share"]')).not.toBeNull();
  });
});

describe('Detalhe — todos os planos', () => {
  const mountDetail = (coupon: AdminCoupon, canShare = true): { fixture: ComponentFixture<CouponDetail>; el: HTMLElement } => {
    TestBed.configureTestingModule({
      imports: [CouponDetail],
      providers: [
        provideNoopAnimations(),
        {
          provide: AdminCouponsService,
          useValue: {
            redemptions: vi.fn(() =>
              of<CouponRedemptions>({ coupon, redemptions: [], uses: 0, totalDiscountCents: 0, truncated: false }),
            ),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(CouponDetail);
    fixture.componentRef.setInput('coupon', coupon);
    fixture.componentRef.setInput('plans', PLANS);
    fixture.componentRef.setInput('canShare', canShare);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };
  const q = (el: HTMLElement, id: string): HTMLElement | null => el.querySelector(`[data-testid="${id}"]`);

  beforeEach(() => TestBed.resetTestingModule());

  it('mostra Todos os planos, a duração e quanto cada plano paga com o cupom (prancha D)', () => {
    const { el } = mountDetail(BEMVINDO20);
    expect(q(el, 'detail-plan')?.textContent?.trim()).toBe('Todos os planos · qualquer pessoa');
    expect(q(el, 'detail-discount')?.textContent).toContain('por 3 meses');
    const prices = q(el, 'detail-prices')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(prices).toContain('Quanto cada plano paga com o cupom');
    const rows = Array.from(el.querySelectorAll('[data-testid="coupon-plan-price-row"]')).map((row) =>
      Array.from(row.querySelectorAll('[role="rowheader"], b, small')).map((n) => n.textContent?.trim()),
    );
    expect(rows[0]).toEqual(['Starter', 'R$ 63,92', 'era R$ 79,90', 'R$ 639,20', 'era R$ 799,00']);
    expect(rows[2]).toEqual(['Scale', 'R$ 239,20', 'era R$ 299,00', 'R$ 2.392,00', 'era R$ 2.990,00']);
    expect(q(el, 'detail-price-note')?.textContent).toContain('No mensal, vale nas 3 próximas faturas');
  });

  it('o botão Compartilhar avisa a página', () => {
    const { fixture, el } = mountDetail(BEMVINDO20);
    const share = vi.fn();
    fixture.componentInstance.share.subscribe(share);
    (q(el, 'detail-share') as HTMLButtonElement).click();
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('cupom esgotado, desativado ou sem código não oferece compartilhar', () => {
    expect(q(mountDetail({ ...BEMVINDO20, timesRedeemed: 100 }).el, 'detail-share')).toBeNull();
    TestBed.resetTestingModule();
    expect(q(mountDetail({ ...BEMVINDO20, status: 'DEACTIVATED' }).el, 'detail-share')).toBeNull();
    TestBed.resetTestingModule();
    expect(q(mountDetail(HORIZONTE).el, 'detail-share')).toBeNull();
  });

  it('plano novo que o cupom não cobre aparece, pedindo outro cupom', () => {
    const { el } = mountDetail({ ...BEMVINDO20, uncoveredPlanCodes: ['PRO_YEARLY_STRIPE'] });
    expect(q(el, 'detail-uncovered')?.textContent?.trim()).toBe(
      'O plano Pro anual fica de fora deste cupom. Para cobri-lo, crie outro cupom.',
    );
  });

  it('um plano só não ganha a tabela de planos', () => {
    const { el } = mountDetail({ ...BEMVINDO20, planCode: 'PRO_MONTHLY_STRIPE', allPlans: false, planCodes: ['PRO_MONTHLY_STRIPE'] });
    expect(q(el, 'detail-prices')).toBeNull();
    expect(q(el, 'detail-plan')?.textContent).toContain('Pro');
  });
});
