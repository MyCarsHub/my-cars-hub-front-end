import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NEVER, Subject, TimeoutError, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Billing } from './billing';
import { BillingAccessService } from '../../services/billing-access.service';
import { BillingService } from '../../services/billing.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import {
  BillingSummary,
  PlanChangePreview,
  PlanResponse,
  PlanUpgradeResponse,
  ScheduledPlanChange,
  SubscriptionResponse,
} from '../../types/billing.types';

const row = (over: Partial<PlanResponse>): PlanResponse => ({
  id: 'id-trial',
  code: 'TRIAL_MONTHLY_STRIPE',
  name: 'TRIAL',
  period: 'MONTHLY',
  price: 0,
  vehicleLimit: 3,
  trialDays: 14,
  productExternalId: null,
  gateway: 'stripe',
  purchasable: true,
  ...over,
});

const TRIAL = row({});
const STARTER = row({ id: 'id-st', code: 'STARTER_MONTHLY_STRIPE', name: 'STARTER', price: 79.9, trialDays: 0 });
const PRO = row({ id: 'id-pro', code: 'PRO_MONTHLY_STRIPE', name: 'PRO', price: 149.9, trialDays: 0 });
const STARTER_Y = row({
  id: 'id-st-y',
  code: 'STARTER_YEARLY_STRIPE',
  name: 'STARTER',
  period: 'YEARLY',
  price: 799,
  trialDays: 0,
});
const PRO_Y = row({
  id: 'id-pro-y',
  code: 'PRO_YEARLY_STRIPE',
  name: 'PRO',
  period: 'YEARLY',
  price: 1499,
  trialDays: 0,
});
const PLANS = [TRIAL, STARTER, PRO, STARTER_Y, PRO_Y];

const serverTime = (msFromNow: number): string =>
  new Date(Date.now() + msFromNow).toISOString().slice(0, 19);
const IN_40_DAYS = serverTime(40 * 86_400_000);

const subscription = (over: Partial<SubscriptionResponse> = {}): SubscriptionResponse => ({
  id: 'sub-1',
  planCode: 'STARTER_MONTHLY_STRIPE',
  planName: 'STARTER',
  status: 'ACTIVE',
  billingCycle: 'MONTHLY',
  trialEndsAt: null,
  currentPeriodStart: serverTime(-86_400_000),
  currentPeriodEnd: IN_40_DAYS,
  cancelAtPeriodEnd: false,
  externalId: 'sub_1',
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
  ...over,
});

const summary = (over: Partial<BillingSummary> = {}): BillingSummary => ({
  state: 'ACTIVE',
  canManage: true,
  plan: {
    code: 'STARTER_MONTHLY_STRIPE',
    name: 'STARTER',
    period: 'MONTHLY',
    price: 79.9,
    vehicleLimit: 15,
    contactOnly: false,
  },
  usage: { vehicles: 8, vehicleLimit: 15 },
  trialEndsAt: null,
  currentPeriodEnd: IN_40_DAYS,
  cancelAtPeriodEnd: false,
  pendingPlanCode: null,
  scheduledDowngradePlanCode: null,
  scheduledDowngradeAt: null,
  pastDueSince: null,
  graceEndsAt: null,
  amountDueCents: null,
  openInvoice: null,
  paymentMethod: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2027 },
  lastFailure: null,
  invoices: [],
  actions: ['UPDATE_CARD'],
  payWith: ['CARD'],
  providerDetailsAvailable: true,
  ...over,
});

const inPlace = (over: Partial<PlanChangePreview> = {}): PlanChangePreview => ({
  mode: 'IN_PLACE',
  reasonCode: null,
  message: null,
  currentPlanCode: 'STARTER_MONTHLY_STRIPE',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
  amountTodayCents: 0,
  listAmountCents: 14990,
  nextChargeAt: '2026-11-13T10:00:00',
  nextAmountCents: 14990,
  discountAfterChange: null,
  vehicleCount: 8,
  targetVehicleLimit: 25,
  fleetOverLimit: false,
  ...over,
});

const checkout = (reasonCode: PlanChangePreview['reasonCode']): PlanChangePreview =>
  inPlace({ mode: 'CHECKOUT', reasonCode, amountTodayCents: null, nextChargeAt: null, nextAmountCents: null });

const blocked = (reasonCode: PlanChangePreview['reasonCode'], message: string): PlanChangePreview =>
  inPlace({ mode: 'BLOCKED', reasonCode, message, amountTodayCents: null, nextChargeAt: null, nextAmountCents: null });

const applied: PlanUpgradeResponse = {
  outcome: 'APPLIED',
  planCode: 'PRO_MONTHLY_STRIPE',
  planName: 'PRO',
  amountTodayCents: 0,
  nextChargeAt: '2026-11-13T10:00:00',
  nextAmountCents: 14990,
  message: 'O PRO já está ativo. Você não paga nada hoje.',
};

const scheduled: ScheduledPlanChange = {
  outcome: 'SCHEDULED',
  currentPlanCode: 'PRO_MONTHLY_STRIPE',
  planCode: 'STARTER_MONTHLY_STRIPE',
  planName: 'STARTER',
  amountTodayCents: 0,
  effectiveAt: '2026-11-13T10:00:00',
  nextAmountCents: 7990,
  message: 'Você continua no PRO até 13/11/2026. Você não paga nada hoje.',
};

const undone: ScheduledPlanChange = { ...scheduled, outcome: 'UNDONE', planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', nextAmountCents: 14990, message: 'Mudança desfeita.' };

const schedule = (reasonCode: 'LOWER_PLAN' | 'INTERVAL_CHANGE', over: Partial<PlanChangePreview> = {}): PlanChangePreview =>
  inPlace({
    mode: 'SCHEDULED',
    reasonCode,
    currentPlanCode: 'PRO_MONTHLY_STRIPE',
    planCode: 'STARTER_MONTHLY_STRIPE',
    planName: 'STARTER',
    listAmountCents: 7990,
    nextAmountCents: 7990,
    targetVehicleLimit: 15,
    ...over,
  });

const apiError = (status: number, code?: string, message?: string): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: { message: message ?? `servidor ${status}`, code } });

type Probe = {
  onPlanCta(plan: PlanResponse): void;
  onColumn(col: { contact: boolean; plan: PlanResponse | null }): void;
  openPlans(): void;
  sheet(): string | null;
  revalidate(): void;
  planCardError(plan: PlanResponse): string | null;
  planCtaLabel(plan: PlanResponse): string;
  planCtaDisabled(plan: PlanResponse): boolean;
  periodSwitchTarget(): PlanResponse | null;
  periodSwitchVariant(): string;
  periodSwitchDialogMessage(): string;
  planColumns(): { contact: boolean; ctaDisabled: boolean; ctaLabel: string }[];
  heroAmount(): { reais: string; cents: string } | null;
  heroPer(): string;
  reactivate(): void;
  onCancelConfirmed(): void;
  accountActionError(): string | null;
  confirmPeriodSwitch(): void;
  downgradeTarget(): PlanResponse | null;
  confirmDowngrade(): void;
};

describe('Billing: upgrade decidido pelo servidor', () => {
  let subscriptionSignal: ReturnType<typeof signal<SubscriptionResponse | null>>;
  let summarySignal: ReturnType<typeof signal<BillingSummary | null>>;
  let plansSignal: ReturnType<typeof signal<PlanResponse[]>>;
  let billing: {
    plans: unknown;
    subscription: unknown;
    loading: unknown;
    error: unknown;
    summary: unknown;
    loadPlans: ReturnType<typeof vi.fn>;
    loadSubscription: ReturnType<typeof vi.fn>;
    loadSummary: ReturnType<typeof vi.fn>;
    startCheckout: ReturnType<typeof vi.fn>;
    downgrade: ReturnType<typeof vi.fn>;
    clearError: ReturnType<typeof vi.fn>;
    planChangePreview: ReturnType<typeof vi.fn>;
    upgrade: ReturnType<typeof vi.fn>;
    schedulePlanChange: ReturnType<typeof vi.fn>;
    undoPlanChange: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    reactivate: ReturnType<typeof vi.fn>;
  };
  let externalNav: { openExternal: ReturnType<typeof vi.fn>; openPendingTab: ReturnType<typeof vi.fn> };
  let access: { invalidate: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> };
  let notifications: Record<'success' | 'error' | 'warning', ReturnType<typeof vi.fn>>;
  let tab: { blocked: boolean; navigate: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    subscriptionSignal = signal<SubscriptionResponse | null>(subscription());
    summarySignal = signal<BillingSummary | null>(summary());
    plansSignal = signal<PlanResponse[]>(PLANS);
    billing = {
      plans: plansSignal.asReadonly(),
      subscription: subscriptionSignal.asReadonly(),
      loading: signal(false).asReadonly(),
      error: signal<string | null>(null).asReadonly(),
      summary: summarySignal.asReadonly(),
      loadPlans: vi.fn(() => of(PLANS)),
      loadSubscription: vi.fn(() => of(subscriptionSignal())),
      loadSummary: vi.fn(() => of(summarySignal())),
      startCheckout: vi.fn(() => of({ redirectUrl: 'https://pay.example/x', externalId: 'e' })),
      downgrade: vi.fn(() => NEVER),
      clearError: vi.fn(),
      planChangePreview: vi.fn(() => of(inPlace())),
      upgrade: vi.fn(() => of(applied)),
      schedulePlanChange: vi.fn(() => of(scheduled)),
      undoPlanChange: vi.fn(() => of(undone)),
      cancel: vi.fn(() => of(void 0)),
      reactivate: vi.fn(() => NEVER),
    };
    tab = { blocked: false, navigate: vi.fn(), close: vi.fn() };
    externalNav = { openExternal: vi.fn(), openPendingTab: vi.fn(() => tab) };
    access = { invalidate: vi.fn(), load: vi.fn(() => of(null)) };
    notifications = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: BillingService, useValue: billing },
        { provide: BillingAccessService, useValue: access },
        { provide: ExternalNavigationService, useValue: externalNav },
        { provide: NotificationService, useValue: notifications },
        {
          provide: SessionService,
          useValue: { isPlatformAdmin: () => false, getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    });
  });

  const render = (): { fixture: ComponentFixture<Billing>; c: Probe; el: HTMLElement } => {
    const fixture = TestBed.createComponent(Billing);
    fixture.detectChanges();
    return {
      fixture,
      c: fixture.componentInstance as unknown as Probe,
      el: fixture.nativeElement as HTMLElement,
    };
  };

  const startUpgrade = (): ReturnType<typeof render> => {
    const view = render();
    view.c.onPlanCta(PRO);
    view.fixture.detectChanges();
    return view;
  };

  const byTest = (el: HTMLElement, id: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${id}"]`) ?? el.querySelector(`[data-testid="${id}"]`);

  describe('antes de subir de plano', () => {
    it('pergunta ao servidor e não abre checkout nem aba enquanto ele não responde', () => {
      billing.planChangePreview.mockReturnValue(NEVER);
      const { c } = startUpgrade();
      expect(billing.planChangePreview).toHaveBeenCalledExactlyOnceWith('PRO_MONTHLY_STRIPE');
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).not.toHaveBeenCalled();
      expect(c.planCtaLabel(PRO)).toBe('Processando…');
    });

    it('dois cliques com a prévia em voo fazem uma consulta só', () => {
      billing.planChangePreview.mockReturnValue(NEVER);
      const { c } = startUpgrade();
      c.onPlanCta(PRO);
      expect(billing.planChangePreview).toHaveBeenCalledTimes(1);
      expect(c.planCtaDisabled(STARTER_Y)).toBe(true);
    });

    it('sem assinatura paga em vigor não consulta: o checkout abre dentro do gesto do clique', () => {
      subscriptionSignal.set(
        subscription({ planCode: 'TRIAL_MONTHLY_STRIPE', planName: 'TRIAL', externalId: null, currentPeriodEnd: null }),
      );
      summarySignal.set(
        summary({ plan: { code: 'TRIAL_MONTHLY_STRIPE', name: 'TRIAL', period: 'MONTHLY', price: 0, vehicleLimit: 3, contactOnly: false } }),
      );
      const { c } = render();
      c.onPlanCta(PRO);
      expect(billing.planChangePreview).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).toHaveBeenCalledTimes(1);
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });
  });

  describe('IN_PLACE', () => {
    it('abre o diálogo com a frase do §1, data e valor da API', () => {
      const { el, c } = startUpgrade();
      expect(c.sheet()).toBe('upgrade');
      expect(byTest(el, 'upgrade-copy')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'O Pro começa agora. Você não paga nada hoje. A partir de 13/11/2026 a mensalidade passa a R$ 149,90.',
      );
    });

    it('lê a data no fuso do negócio, não no do navegador', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ nextChargeAt: '2026-11-14T02:00:00' })));
      const { el } = startUpgrade();
      expect(byTest(el, 'upgrade-copy')?.textContent).toContain('13/11/2026');
    });

    it('usa o valor da prévia da Stripe, não o preço de tabela', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ nextAmountCents: 10000 })));
      const { el } = startUpgrade();
      expect(byTest(el, 'upgrade-copy')?.textContent).toContain('R$\u00A0100,00');
    });

    it('com desconto, a fatura com desconto não é chamada de mensalidade', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ nextAmountCents: 10000 })));
      const { el } = startUpgrade();
      const text = byTest(el, 'upgrade-copy')?.textContent ?? '';
      expect(text).not.toMatch(/mensalidade passa a R\$\s100,00/);
      expect(text).toContain('13/11/2026');
      expect(text).toContain('R$\u00A0149,90');
    });

    it('o valor nunca quebra entre "R$" e os números', () => {
      const { el } = startUpgrade();
      expect(byTest(el, 'upgrade-copy')?.textContent).toContain('R$\u00A0149,90');
    });

    it('tem só "Agora não" e "Confirmar upgrade", sem ícone de alerta nem vermelho', () => {
      const { el } = startUpgrade();
      const sheet = byTest(el, 'upgrade-sheet') as HTMLElement;
      const labels = Array.from(sheet.querySelectorAll('button'))
        .map((b) => b.textContent?.trim())
        .filter(Boolean);
      expect(labels).toEqual(['Agora não', 'Confirmar upgrade']);
      expect(sheet.querySelector('svg')).toBeNull();
      expect(sheet.outerHTML).not.toMatch(/\b(red|rose|amber)-\d/);
    });

    it('não dispara checkout nem reserva aba', () => {
      startUpgrade();
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).not.toHaveBeenCalled();
    });

    it('"Agora não" fecha sem chamar nada', () => {
      const { el, c, fixture } = startUpgrade();
      (byTest(el, 'upgrade-dismiss') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(c.sheet()).toBeNull();
      expect(billing.upgrade).not.toHaveBeenCalled();
    });

    it('resposta incompleta não vira frase com "—": erra no cartão e não abre o diálogo', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ nextChargeAt: null })));
      const { c } = startUpgrade();
      expect(c.sheet()).not.toBe('upgrade');
      expect(c.planCardError(PRO)).toBeTruthy();
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('recusa prometer "não paga nada hoje" se o servidor disser outro valor', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ amountTodayCents: 7000 })));
      const { c } = startUpgrade();
      expect(c.sheet()).not.toBe('upgrade');
      expect(c.planCardError(PRO)).toBeTruthy();
    });
  });

  describe('Confirmar upgrade', () => {
    const confirm = (view: ReturnType<typeof render>): void => {
      (byTest(view.el, 'upgrade-confirm') as HTMLButtonElement).click();
      view.fixture.detectChanges();
    };

    it('dois cliques mandam um POST só', () => {
      const pending = new Subject<PlanUpgradeResponse>();
      billing.upgrade.mockReturnValue(pending);
      const view = startUpgrade();
      const button = byTest(view.el, 'upgrade-confirm') as HTMLButtonElement;
      button.click();
      button.click();
      view.fixture.detectChanges();
      expect(billing.upgrade).toHaveBeenCalledExactlyOnceWith('PRO_MONTHLY_STRIPE');
      expect(button.disabled).toBe(true);
      expect((byTest(view.el, 'upgrade-dismiss') as HTMLButtonElement).disabled).toBe(true);
    });

    it('sucesso fecha, avisa com a frase do servidor e relê assinatura, resumo e acesso', () => {
      const view = startUpgrade();
      const subscriptionReads = billing.loadSubscription.mock.calls.length;
      const summaryReads = billing.loadSummary.mock.calls.length;
      confirm(view);
      expect(view.c.sheet()).toBeNull();
      expect(notifications.success).toHaveBeenCalledWith(applied.message);
      expect(billing.loadSubscription.mock.calls.length).toBeGreaterThan(subscriptionReads);
      expect(billing.loadSummary.mock.calls.length).toBeGreaterThan(summaryReads);
      expect(access.invalidate).toHaveBeenCalled();
    });

    it('NO_OP do clique repetido também relê a página', () => {
      billing.upgrade.mockReturnValue(of({ ...applied, outcome: 'NO_OP', message: null }));
      const view = startUpgrade();
      const reads = billing.loadSummary.mock.calls.length;
      confirm(view);
      expect(view.c.sheet()).toBeNull();
      expect(notifications.success).toHaveBeenCalledTimes(1);
      expect(billing.loadSummary.mock.calls.length).toBeGreaterThan(reads);
    });

    const REFUSALS: [number, string | undefined, RegExp, boolean][] = [
      [409, 'UPGRADE_DOWNGRADE_SCHEDULED', /mudança de plano agendada/i, false],
      [409, 'UPGRADE_CANCELLATION_SCHEDULED', /cancelamento agendado/i, false],
      [409, 'UPGRADE_USE_CHECKOUT', /checkout/i, false],
      [409, 'UPGRADE_NOT_AVAILABLE', /disponível/i, false],
      [409, 'UPGRADE_CHECKOUT_IN_PROGRESS', /pagamento em andamento/i, false],
      [409, 'UPGRADE_PROVIDER_MISMATCH', /stripe/i, false],
      [503, undefined, /stripe não respondeu.*nada mudou/i, true],
      [500, undefined, /Não conseguimos concluir a alteração do plano\. Tente de novo em instantes\./, true],
      [403, undefined, /dono da conta/i, false],
    ];

    it.each(REFUSALS)('%i %s: traduz, nada muda, sem checkout', (status, code, copy, canRetry) => {
      billing.upgrade.mockReturnValue(throwError(() => apiError(status, code)));
      const view = startUpgrade();
      confirm(view);
      expect(view.c.sheet()).toBe('upgrade');
      expect(byTest(view.el, 'upgrade-error')?.textContent).toMatch(copy);
      expect(byTest(view.el, 'upgrade-error')?.textContent).not.toContain(`servidor ${status}`);
      expect((byTest(view.el, 'upgrade-confirm') as HTMLButtonElement).disabled).toBe(!canRetry);
      expect((byTest(view.el, 'upgrade-dismiss') as HTMLButtonElement).disabled).toBe(false);
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('500 não afirma que a Stripe aceitou a troca', () => {
      billing.upgrade.mockReturnValue(throwError(() => apiError(500)));
      const view = startUpgrade();
      confirm(view);
      expect(byTest(view.el, 'upgrade-error')?.textContent).not.toMatch(/aceitou/i);
    });

    it.each([
      ['sem rede', () => new HttpErrorResponse({ status: 0 })],
      ['502', () => apiError(502)],
      ['504', () => apiError(504)],
      ['tempo esgotado', () => new TimeoutError()],
    ])('%s: resultado desconhecido, não afirma nada e relê o plano', (_label, make) => {
      billing.upgrade.mockReturnValue(throwError(make));
      const view = startUpgrade();
      const reads = billing.loadSubscription.mock.calls.length;
      confirm(view);
      const text = byTest(view.el, 'upgrade-error')?.textContent ?? '';
      expect(text).toContain('Não conseguimos confirmar a troca. Atualize a página para ver seu plano');
      expect(text).not.toMatch(/nada (mudou|foi)/i);
      expect(billing.loadSubscription.mock.calls.length).toBeGreaterThan(reads);
      expect((byTest(view.el, 'upgrade-confirm') as HTMLButtonElement).disabled).toBe(true);
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('DOWNGRADE_LOCKED_UNTIL_PAID no POST mostra a frase do servidor, que traz a data', () => {
      const text = 'A volta para um plano menor fica disponível depois que a fatura de 13/11/2026 for paga.';
      billing.upgrade.mockReturnValue(throwError(() => apiError(409, 'DOWNGRADE_LOCKED_UNTIL_PAID', text)));
      const view = startUpgrade();
      confirm(view);
      expect(byTest(view.el, 'upgrade-error')?.textContent).toContain(text);
    });

    it('503 deixa tentar de novo e o segundo envio conclui', () => {
      billing.upgrade.mockReturnValueOnce(throwError(() => apiError(503)));
      const view = startUpgrade();
      confirm(view);
      confirm(view);
      expect(billing.upgrade).toHaveBeenCalledTimes(2);
      expect(view.c.sheet()).toBeNull();
    });
  });

  describe('sessão somente leitura', () => {
    it('a prévia funciona, mas o diálogo não executa', () => {
      summarySignal.set(summary({ canManage: false }));
      const view = startUpgrade();
      const button = byTest(view.el, 'upgrade-confirm') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      expect(billing.upgrade).not.toHaveBeenCalled();
      expect(byTest(view.el, 'upgrade-sheet')?.textContent).toMatch(/somente leitura/i);
    });
  });

  describe('falha da prévia', () => {
    it.each([
      ['503', () => apiError(503)],
      ['500', () => apiError(500)],
      ['sem rede', () => new HttpErrorResponse({ status: 0 })],
      ['404', () => apiError(404)],
    ])('%s: nunca cai no upgrade pago antigo em silêncio', (_label, make) => {
      billing.planChangePreview.mockReturnValue(throwError(make));
      const { c } = startUpgrade();
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).not.toHaveBeenCalled();
      expect(c.periodSwitchTarget()).toBeNull();
      expect(c.sheet()).not.toBe('upgrade');
      expect(c.planCardError(PRO)).toMatch(/nada foi cobrado/i);
      expect(c.planCtaLabel(PRO)).not.toBe('Processando…');
    });

    it('modo desconhecido é falha, não checkout', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ mode: 'NOVO' as never })));
      const { c } = startUpgrade();
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(c.planCardError(PRO)).toMatch(/nada foi cobrado/i);
    });
  });

  describe('CHECKOUT', () => {
    it('com período pago mantém o aviso de hoje e só compra depois de confirmar', () => {
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c } = startUpgrade();
      expect(c.periodSwitchTarget()).toEqual(PRO);
      expect(c.periodSwitchVariant()).toBe('danger');
      expect(billing.startCheckout).not.toHaveBeenCalled();
      c.confirmPeriodSwitch();
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });

    it('a folha de planos fecha para o aviso ficar à vista', () => {
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c, fixture } = render();
      c.openPlans();
      fixture.detectChanges();
      c.onColumn({ contact: false, plan: PRO });
      expect(c.sheet()).toBeNull();
      expect(c.periodSwitchTarget()).toEqual(PRO);
    });

    it('sem dias pagos a perder vai direto, como hoje', () => {
      subscriptionSignal.set(subscription({ currentPeriodEnd: serverTime(-2 * 86_400_000) }));
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      startUpgrade();
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });
  });

  describe('BLOCKED', () => {
    it.each([
      ['ALREADY_ON_PLAN', 'Este já é o seu plano.'],
      ['PLAN_NOT_AVAILABLE', 'O plano PRO não está disponível para assinatura.'],
      ['DOWNGRADE_SCHEDULED', 'Há uma mudança de plano agendada. Desfaça o agendamento antes de fazer o upgrade.'],
      ['CANCELLATION_SCHEDULED', 'Há um cancelamento agendado. Desfaça o cancelamento antes de fazer o upgrade.'],
      ['DOWNGRADE_LOCKED_UNTIL_PAID', 'A volta para um plano menor fica disponível depois que a fatura de 13/11/2026 for paga.'],
    ] as const)('%s mostra a mensagem e não age', (reason, message) => {
      billing.planChangePreview.mockReturnValue(of(blocked(reason, message)));
      const { el, c } = startUpgrade();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toContain(message);
      expect(billing.upgrade).not.toHaveBeenCalled();
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('sem mensagem do servidor ainda explica', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ mode: 'BLOCKED', reasonCode: 'CANCELLATION_SCHEDULED', message: null })));
      const { el } = startUpgrade();
      expect(byTest(el, 'plan-notice-message')?.textContent).toMatch(/cancelamento agendado/i);
    });
  });

  describe('DOWNGRADE_LOCKED_UNTIL_PAID no caminho de descida', () => {
    const LOCK = 'A volta para um plano menor fica disponível depois que a fatura de 13/11/2026 for paga.';

    it('voltar ao gratuito mostra a data e não deixa o erro num cartão fechado', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' }));
      billing.downgrade.mockReturnValue(throwError(() => apiError(409, 'DOWNGRADE_LOCKED_UNTIL_PAID', LOCK)));
      const { c, el, fixture } = render();
      c.onPlanCta(TRIAL);
      expect(c.downgradeTarget()).toEqual(TRIAL);
      c.confirmDowngrade();
      fixture.detectChanges();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toContain(LOCK);
      expect(billing.clearError).toHaveBeenCalled();
    });

    it('plano pago menor, pelo checkout: fecha a aba reservada e mostra a data', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' }));
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      billing.startCheckout.mockReturnValue(throwError(() => apiError(409, 'DOWNGRADE_LOCKED_UNTIL_PAID', LOCK)));
      const { c, el, fixture } = render();
      c.onPlanCta(STARTER);
      c.confirmPeriodSwitch();
      fixture.detectChanges();
      expect(tab.close).toHaveBeenCalled();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toContain(LOCK);
    });

    it('outro erro de descida continua no cartão, como hoje', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' }));
      billing.downgrade.mockReturnValue(throwError(() => apiError(400, undefined, 'Não dá.')));
      const { c } = render();
      c.onPlanCta(TRIAL);
      c.confirmDowngrade();
      expect(c.sheet()).toBeNull();
      expect(c.planCardError(TRIAL)).toBe('Não dá.');
    });
  });

  describe('intenção só com dados completos (FE1)', () => {
    const noPurchase = (c: Probe): void => {
      c.onPlanCta(PRO);
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(billing.planChangePreview).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).not.toHaveBeenCalled();
      expect(c.periodSwitchTarget()).toBeNull();
    };
    const buyable = (c: Probe): string[] =>
      c
        .planColumns()
        .filter((col) => !col.contact && !col.ctaDisabled)
        .map((col) => col.ctaLabel);

    it('/subscription falhou: pede para tentar de novo e não oferece compra', () => {
      subscriptionSignal.set(null);
      billing.loadSubscription.mockReturnValue(throwError(() => apiError(500)));
      const { c, el, fixture } = render();
      c.openPlans();
      fixture.detectChanges();
      expect(byTest(el, 'plan-data-retry')).not.toBeNull();
      expect(buyable(c)).toEqual([]);
      expect(c.planColumns().map((col) => col.ctaLabel)).not.toContain('Assinar Pro');
      noPurchase(c);
    });

    it('tentar de novo relê tudo e devolve as ações', () => {
      billing.loadSubscription.mockReturnValueOnce(throwError(() => apiError(503)));
      const { c, el, fixture } = render();
      c.openPlans();
      fixture.detectChanges();
      const reads = billing.loadSummary.mock.calls.length;
      (byTest(el, 'plan-data-retry-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(billing.loadPlans.mock.calls.length).toBeGreaterThan(1);
      expect(billing.loadSummary.mock.calls.length).toBeGreaterThan(reads);
      expect(byTest(el, 'plan-data-retry')).toBeNull();
      expect(buyable(c)).toContain('Subir para Pro');
    });

    it('plano atual fora de /plans: não decide', () => {
      subscriptionSignal.set(subscription({ planCode: 'LEGACY_MONTHLY_STRIPE', planName: 'LEGACY' }));
      const { c, el, fixture } = render();
      c.openPlans();
      fixture.detectChanges();
      expect(byTest(el, 'plan-data-retry')).not.toBeNull();
      expect(buyable(c)).toEqual([]);
      noPurchase(c);
    });

    it('/plans falhou: mostra o caminho de volta', () => {
      plansSignal.set([]);
      billing.loadPlans.mockReturnValue(throwError(() => apiError(500)));
      const { c, el, fixture } = render();
      c.openPlans();
      fixture.detectChanges();
      expect(byTest(el, 'plan-data-retry')).not.toBeNull();
    });

    it('resumo diz assinatura paga e /subscription diz que não há: fontes em conflito, não decide', () => {
      subscriptionSignal.set(null);
      const { c, el, fixture } = render();
      c.openPlans();
      fixture.detectChanges();
      expect(byTest(el, 'plan-data-retry')).not.toBeNull();
      noPurchase(c);
    });

    it('primeira leitura em voo: sem dado ainda, sem compra', () => {
      subscriptionSignal.set(null);
      summarySignal.set(null);
      billing.loadSubscription.mockReturnValue(NEVER);
      const { c } = render();
      expect(buyable(c)).toEqual([]);
      noPurchase(c);
    });

    it('reler ao voltar para a aba não tira a compra de quem já sabemos que não tem assinatura', () => {
      subscriptionSignal.set(null);
      summarySignal.set(summary({ state: 'NONE', plan: null }));
      const { c } = render();
      expect(buyable(c)).toContain('Assinar Pro');
      billing.loadSubscription.mockReturnValue(NEVER);
      c.revalidate();
      expect(billing.loadSubscription.mock.calls.length).toBeGreaterThan(1);
      expect(buyable(c)).toContain('Assinar Pro');
    });

    it('sem assinatura de verdade (404 lido) continua comprando normalmente', () => {
      subscriptionSignal.set(null);
      summarySignal.set(summary({ state: 'NONE', plan: null, canManage: true }));
      const { c, el, fixture } = render();
      fixture.detectChanges();
      expect(byTest(el, 'plan-data-retry')).toBeNull();
      c.onPlanCta(PRO);
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });
  });

  describe('PENDING_PAYMENT passa pela mesma decisão (FE1)', () => {
    const pending = (over: Partial<SubscriptionResponse> = {}): SubscriptionResponse =>
      subscription({ pendingPlanCode: 'PRO_MONTHLY_STRIPE', ...over });

    it('cliente pagante com checkout pendente: oferece o upgrade sem cobrança', () => {
      subscriptionSignal.set(pending());
      const { c } = startUpgrade();
      expect(billing.planChangePreview).toHaveBeenCalledExactlyOnceWith('PRO_MONTHLY_STRIPE');
      expect(c.sheet()).toBe('upgrade');
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).not.toHaveBeenCalled();
    });

    it('CHECKOUT com dias pagos a perder: avisa antes, nunca retoma em silêncio', () => {
      subscriptionSignal.set(pending());
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c } = startUpgrade();
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(c.periodSwitchTarget()).toEqual(PRO);
      expect(c.periodSwitchVariant()).toBe('danger');
      expect(c.periodSwitchDialogMessage()).toMatch(/cobrados agora/);
      c.confirmPeriodSwitch();
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });

    it('BLOCKED mostra o motivo', () => {
      subscriptionSignal.set(pending());
      billing.planChangePreview.mockReturnValue(of(blocked('CANCELLATION_SCHEDULED', 'Há um cancelamento agendado.')));
      const { c } = startUpgrade();
      expect(c.sheet()).toBe('notice');
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('prévia falhou: não retoma', () => {
      subscriptionSignal.set(pending());
      billing.planChangePreview.mockReturnValue(throwError(() => apiError(503)));
      const { c } = startUpgrade();
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(c.planCardError(PRO)).toMatch(/nada foi cobrado/i);
    });

    it('quem não paga retoma como hoje, dentro do gesto do clique', () => {
      subscriptionSignal.set(
        subscription({ status: 'PENDING', planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', pendingPlanCode: 'PRO_MONTHLY_STRIPE', currentPeriodEnd: null }),
      );
      summarySignal.set(summary({ state: 'NONE', plan: null }));
      const { c } = render();
      c.onPlanCta(PRO);
      expect(billing.planChangePreview).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).toHaveBeenCalledTimes(1);
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });
  });

  describe('409 UPGRADE_USE_IN_PLACE no checkout', () => {
    const refused = (): void => {
      billing.startCheckout.mockReturnValue(throwError(() => apiError(409, 'UPGRADE_USE_IN_PLACE')));
    };
    /** Chega ao checkout pelo aviso, como faria um cartão com a decisão antiga. */
    const reachCheckout = (): ReturnType<typeof render> => {
      billing.planChangePreview.mockReturnValueOnce(of(checkout('NOT_ACTIVE')));
      const view = render();
      view.c.onPlanCta(PRO);
      view.c.confirmPeriodSwitch();
      view.fixture.detectChanges();
      return view;
    };

    it('relê plan-change e abre o diálogo sem cobrança', () => {
      refused();
      const { c, el } = reachCheckout();
      expect(tab.close).toHaveBeenCalled();
      expect(billing.planChangePreview).toHaveBeenCalledTimes(2);
      expect(c.sheet()).toBe('upgrade');
      expect(byTest(el, 'upgrade-copy')?.textContent).toContain('13/11/2026');
      expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    });

    it('se a releitura disser CHECKOUT, para: nunca volta ao checkout em laço', () => {
      refused();
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c } = reachCheckout();
      expect(billing.startCheckout).toHaveBeenCalledTimes(1);
      expect(c.periodSwitchTarget()).toBeNull();
      expect(c.sheet()).toBe('notice');
    });

    it('releitura com falha avisa em vez de sumir num cartão fechado', () => {
      refused();
      billing.planChangePreview.mockReturnValue(throwError(() => apiError(503)));
      const { c, el } = reachCheckout();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toMatch(/nada foi cobrado/i);
    });

    it.each([
      ['UPGRADE_DOWNGRADE_SCHEDULED', 'Há uma mudança de plano agendada.'],
      ['UPGRADE_CANCELLATION_SCHEDULED', 'Há um cancelamento agendado.'],
    ])('%s no checkout mostra o motivo, fora do cartão fechado', (code, message) => {
      billing.startCheckout.mockReturnValue(throwError(() => apiError(409, code, message)));
      const { c, el } = reachCheckout();
      expect(tab.close).toHaveBeenCalled();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toContain(message);
      expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    });

    it('UPGRADE_NOT_AVAILABLE: plano indisponível, nada cobrado, nada insinuado', () => {
      billing.startCheckout.mockReturnValue(throwError(() => apiError(409, 'UPGRADE_NOT_AVAILABLE', 'servidor')));
      const { c, el } = reachCheckout();
      expect(tab.close).toHaveBeenCalled();
      expect(c.sheet()).toBe('notice');
      const text = textOf(el, 'plan-notice-message');
      expect(text).toMatch(/não está disponível/i);
      expect(text).toMatch(/nada foi cobrado/i);
      expect(text).not.toContain('servidor');
      expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    });

    it('releitura BLOCKED mostra o motivo', () => {
      refused();
      billing.planChangePreview.mockReturnValue(of(blocked('DOWNGRADE_SCHEDULED', 'Há uma mudança agendada.')));
      const { c, el } = reachCheckout();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toContain('Há uma mudança agendada.');
    });
  });

  const textOf = (el: HTMLElement, id: string): string =>
    (byTest(el, id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const onPro = (over: Partial<SubscriptionResponse> = {}): void =>
    subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', ...over }));
  const proSummary = (over: Partial<BillingSummary> = {}): BillingSummary =>
    summary({
      plan: { code: 'PRO_MONTHLY_STRIPE', name: 'PRO', period: 'MONTHLY', price: 149.9, vehicleLimit: 25, contactOnly: false },
      ...over,
    });
  const choose = (plan: PlanResponse): ReturnType<typeof render> => {
    const view = render();
    view.c.onPlanCta(plan);
    view.fixture.detectChanges();
    return view;
  };
  const confirmOffer = (view: ReturnType<typeof render>): void => {
    (byTest(view.el, 'upgrade-confirm') as HTMLButtonElement).click();
    view.fixture.detectChanges();
  };

  describe('upgrade anual na mesma assinatura (§7)', () => {
    const YEARLY = inPlace({
      currentPlanCode: 'STARTER_YEARLY_STRIPE',
      planCode: 'PRO_YEARLY_STRIPE',
      listAmountCents: 149900,
      nextChargeAt: '2027-03-01T10:00:00',
      nextAmountCents: 149900,
    });
    const onYearly = (): void =>
      subscriptionSignal.set(subscription({ planCode: 'STARTER_YEARLY_STRIPE', billingCycle: 'YEARLY' }));

    it('diz anuidade, nunca mensalidade', () => {
      onYearly();
      billing.planChangePreview.mockReturnValue(of(YEARLY));
      const { el } = choose(PRO_Y);
      expect(textOf(el, 'upgrade-copy')).toBe(
        'O Pro começa agora. Você não paga nada hoje. A partir de 01/03/2027 a anuidade passa a R$ 1.499,00.',
      );
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('confirma pelo upgrade, sem checkout', () => {
      onYearly();
      billing.planChangePreview.mockReturnValue(of(YEARLY));
      const view = choose(PRO_Y);
      confirmOffer(view);
      expect(billing.upgrade).toHaveBeenCalledExactlyOnceWith('PRO_YEARLY_STRIPE');
      expect(billing.schedulePlanChange).not.toHaveBeenCalled();
    });
  });

  describe('SCHEDULED: plano pago menor (§6)', () => {
    beforeEach(() => onPro());

    it('abre o diálogo com a data, o valor e nada cobrado hoje', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      const { el, c } = choose(STARTER);
      expect(c.sheet()).toBe('upgrade');
      expect(textOf(el, 'upgrade-copy')).toBe(
        'Você continua no Pro até 13/11/2026. A partir daí a mensalidade passa a R$ 79,90. Você não paga nada hoje.',
      );
      expect(textOf(el, 'upgrade-confirm')).toBe('Confirmar mudança');
      expect(textOf(el, 'upgrade-dismiss')).toBe('Agora não');
    });

    it('não mostra o aviso de perda, não abre aba nem checkout', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      const { c, el } = choose(STARTER);
      expect(c.periodSwitchTarget()).toBeNull();
      expect(billing.startCheckout).not.toHaveBeenCalled();
      expect(externalNav.openPendingTab).not.toHaveBeenCalled();
      expect(byTest(el, 'upgrade-sheet')?.outerHTML).not.toMatch(/\b(red|rose|amber)-\d/);
    });

    it('plano anual menor diz anuidade', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_YEARLY_STRIPE', planName: 'PRO', billingCycle: 'YEARLY' }));
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', { planCode: 'STARTER_YEARLY_STRIPE', listAmountCents: 79900, nextAmountCents: 79900 })));
      const { el } = choose(STARTER_Y);
      expect(textOf(el, 'upgrade-copy')).toContain('a anuidade passa a R$ 799,00');
    });

    it('fatura com desconto não vira mensalidade', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', { nextAmountCents: 5990, discountAfterChange: 'KEPT' })));
      const { el } = choose(STARTER);
      const text = textOf(el, 'upgrade-copy');
      expect(text).not.toMatch(/mensalidade passa a R\$ 59,90/);
      expect(text).toContain('R$ 59,90');
      expect(text).toContain('R$ 79,90');
    });

    it('avisa quando o desconto para de valer', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', { discountAfterChange: 'LOST' })));
      const { el } = choose(STARTER);
      expect(textOf(el, 'upgrade-discount')).toMatch(/desconto.*não continua/i);
    });

    it('desconto mantido ou inexistente não gera aviso', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', { discountAfterChange: 'KEPT' })));
      const { el } = choose(STARTER);
      expect(byTest(el, 'upgrade-discount')).toBeNull();
    });

    it.each([
      ['sem data', { nextChargeAt: null }],
      ['sem valor', { nextAmountCents: null }],
      ['cobrança hoje', { amountTodayCents: 7990 }],
    ])('recusa a promessa %s', (_label, over) => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', over)));
      const { c } = choose(STARTER);
      expect(c.sheet()).not.toBe('upgrade');
      expect(c.planCardError(STARTER)).toMatch(/nada foi cobrado/i);
    });

    it('dois cliques agendam uma vez só, e não vai ao upgrade', () => {
      const pending = new Subject<ScheduledPlanChange>();
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      billing.schedulePlanChange.mockReturnValue(pending);
      const view = choose(STARTER);
      const button = byTest(view.el, 'upgrade-confirm') as HTMLButtonElement;
      button.click();
      button.click();
      view.fixture.detectChanges();
      expect(billing.schedulePlanChange).toHaveBeenCalledExactlyOnceWith('STARTER_MONTHLY_STRIPE');
      expect(billing.upgrade).not.toHaveBeenCalled();
      expect(button.disabled).toBe(true);
    });

    it('sucesso fecha, usa a frase do servidor e relê a página', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      const view = choose(STARTER);
      const reads = billing.loadSummary.mock.calls.length;
      confirmOffer(view);
      expect(view.c.sheet()).toBeNull();
      expect(notifications.success).toHaveBeenCalledWith(scheduled.message);
      expect(billing.loadSummary.mock.calls.length).toBeGreaterThan(reads);
    });

    it('NO_OP sem mensagem ainda confirma, sem prometer cobrança', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      billing.schedulePlanChange.mockReturnValue(of({ ...scheduled, outcome: 'NO_OP', message: null }));
      const view = choose(STARTER);
      confirmOffer(view);
      expect(view.c.sheet()).toBeNull();
      expect(notifications.success.mock.calls[0][0]).toMatch(/agendada/i);
    });

    it('em sessão somente leitura não executa', () => {
      summarySignal.set(proSummary({ canManage: false }));
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      const view = choose(STARTER);
      const button = byTest(view.el, 'upgrade-confirm') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      expect(billing.schedulePlanChange).not.toHaveBeenCalled();
    });

    const REFUSALS: [number, string | undefined, RegExp, boolean][] = [
      [409, 'UPGRADE_USE_CHECKOUT', /checkout/i, false],
      [409, 'UPGRADE_DOWNGRADE_SCHEDULED', /mudança de plano agendada/i, false],
      [409, 'UPGRADE_CANCELLATION_SCHEDULED', /cancelamento agendado/i, false],
      [409, 'UPGRADE_NOT_AVAILABLE', /disponível/i, false],
      [409, 'UPGRADE_CHECKOUT_IN_PROGRESS', /pagamento em andamento/i, false],
      [409, 'UPGRADE_PROVIDER_MISMATCH', /stripe/i, false],
      [503, undefined, /stripe não respondeu.*nada mudou/i, true],
      [500, undefined, /Não conseguimos concluir a alteração do plano/, true],
      [403, undefined, /dono da conta/i, false],
      [504, undefined, /Não conseguimos confirmar a troca/, false],
    ];

    it.each(REFUSALS)('%i %s: traduz e nada de checkout', (status, code, copy, canRetry) => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      billing.schedulePlanChange.mockReturnValue(throwError(() => apiError(status, code)));
      const view = choose(STARTER);
      confirmOffer(view);
      expect(view.c.sheet()).toBe('upgrade');
      expect(textOf(view.el, 'upgrade-error')).toMatch(copy);
      expect((byTest(view.el, 'upgrade-confirm') as HTMLButtonElement).disabled).toBe(!canRetry);
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('a trava mostra a data do servidor', () => {
      const lock = 'A volta para um plano menor fica disponível depois que a fatura de 13/11/2027 for paga.';
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      billing.schedulePlanChange.mockReturnValue(throwError(() => apiError(409, 'DOWNGRADE_LOCKED_UNTIL_PAID', lock)));
      const view = choose(STARTER);
      confirmOffer(view);
      expect(textOf(view.el, 'upgrade-error')).toContain(lock);
    });

    it('UPGRADE_USE_IN_PLACE relê a prévia e abre o diálogo certo', () => {
      billing.planChangePreview.mockReturnValueOnce(of(schedule('LOWER_PLAN'))).mockReturnValue(of(inPlace()));
      billing.schedulePlanChange.mockReturnValue(throwError(() => apiError(409, 'UPGRADE_USE_IN_PLACE')));
      const view = choose(STARTER);
      confirmOffer(view);
      expect(billing.planChangePreview).toHaveBeenCalledTimes(2);
      expect(textOf(view.el, 'upgrade-confirm')).toBe('Confirmar upgrade');
      expect(byTest(view.el, 'upgrade-error')).toBeNull();
    });
  });

  describe('o upgrade e o checkout mandados para o agendamento', () => {
    it('POST /upgrade com PLAN_CHANGE_USE_SCHEDULE abre o agendamento', () => {
      billing.planChangePreview.mockReturnValueOnce(of(inPlace())).mockReturnValue(of(schedule('LOWER_PLAN')));
      billing.upgrade.mockReturnValue(throwError(() => apiError(409, 'PLAN_CHANGE_USE_SCHEDULE')));
      const view = startUpgrade();
      confirmOffer(view);
      expect(textOf(view.el, 'upgrade-confirm')).toBe('Confirmar mudança');
    });

    it('POST /checkout com PLAN_CHANGE_USE_SCHEDULE fecha a aba e abre o agendamento', () => {
      billing.planChangePreview.mockReturnValueOnce(of(checkout('NOT_ACTIVE'))).mockReturnValue(of(schedule('LOWER_PLAN')));
      billing.startCheckout.mockReturnValue(throwError(() => apiError(409, 'PLAN_CHANGE_USE_SCHEDULE')));
      const view = render();
      view.c.onPlanCta(PRO);
      view.c.confirmPeriodSwitch();
      view.fixture.detectChanges();
      expect(tab.close).toHaveBeenCalled();
      expect(view.c.sheet()).toBe('upgrade');
      expect(billing.startCheckout).toHaveBeenCalledTimes(1);
    });
  });

  describe('SCHEDULED: troca de ciclo (§7)', () => {
    const PRO_YEARLY_PREVIEW = schedule('INTERVAL_CHANGE', {
      planCode: 'PRO_YEARLY_STRIPE',
      planName: 'PRO',
      listAmountCents: 149900,
      nextAmountCents: 149900,
      targetVehicleLimit: 25,
    });

    it('mesmo plano: diz os dois ciclos, a data e o valor', () => {
      onPro();
      billing.planChangePreview.mockReturnValue(of(PRO_YEARLY_PREVIEW));
      const { el } = choose(PRO_Y);
      expect(textOf(el, 'upgrade-copy')).toBe(
        'Você continua no Pro mensal até 13/11/2026. Nessa data começa o Pro anual, com fatura de R$ 1.499,00. Você não paga nada hoje.',
      );
    });

    it('sobe de plano junto: os limites valem só na renovação', () => {
      billing.planChangePreview.mockReturnValue(of({ ...PRO_YEARLY_PREVIEW, currentPlanCode: 'STARTER_MONTHLY_STRIPE' }));
      const { el } = choose(PRO_Y);
      expect(textOf(el, 'upgrade-copy')).toContain('Os limites do Pro valem a partir dessa data.');
    });

    it('anual para mensal usa o mesmo caminho', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_YEARLY_STRIPE', planName: 'PRO', billingCycle: 'YEARLY' }));
      billing.planChangePreview.mockReturnValue(of(schedule('INTERVAL_CHANGE', { planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', listAmountCents: 14990, nextAmountCents: 14990 })));
      const view = choose(PRO);
      expect(textOf(view.el, 'upgrade-copy')).toContain('Pro anual até 13/11/2026');
      confirmOffer(view);
      expect(billing.schedulePlanChange).toHaveBeenCalledExactlyOnceWith('PRO_MONTHLY_STRIPE');
    });

    it('nenhuma frase promete cobrança hoje', () => {
      onPro();
      billing.planChangePreview.mockReturnValue(of(PRO_YEARLY_PREVIEW));
      const { el } = choose(PRO_Y);
      expect(textOf(el, 'upgrade-sheet')).not.toMatch(/cobrad[oa]s? (agora|hoje)|cobrança imediata/i);
    });
  });

  describe('frota acima do limite do plano menor', () => {
    beforeEach(() => onPro());

    it('avisa antes de confirmar, com os números, e deixa confirmar', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', { vehicleCount: 22, fleetOverLimit: true })));
      const { el } = choose(STARTER);
      const warning = textOf(el, 'upgrade-fleet');
      expect(warning).toContain('22 veículos');
      expect(warning).toContain('o Starter vai até 15');
      expect(warning).toMatch(/nenhum veículo é removido/i);
      expect(warning).toMatch(/adicionar novos/i);
      expect((byTest(el, 'upgrade-confirm') as HTMLButtonElement).disabled).toBe(false);
    });

    it('dentro do limite não avisa', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN')));
      const { el } = choose(STARTER);
      expect(byTest(el, 'upgrade-fleet')).toBeNull();
    });

    it('sem teto no destino não avisa', () => {
      billing.planChangePreview.mockReturnValue(of(schedule('LOWER_PLAN', { targetVehicleLimit: null, fleetOverLimit: false })));
      const { el } = choose(STARTER);
      expect(byTest(el, 'upgrade-fleet')).toBeNull();
    });
  });

  describe('mudança agendada na página', () => {
    const SCHEDULED_AT = '2026-11-13T10:00:00';
    const withChange = (over: Partial<SubscriptionResponse> = {}): void => {
      onPro({ scheduledChangePlanCode: 'STARTER_MONTHLY_STRIPE', scheduledChangeAt: SCHEDULED_AT, ...over });
      summarySignal.set(
        proSummary({
          scheduledChangePlanCode: 'STARTER_MONTHLY_STRIPE',
          scheduledChangeAt: SCHEDULED_AT,
          actions: ['UPDATE_CARD', 'CHANGE_PLAN', 'UNDO_PLAN_CHANGE'],
        }),
      );
    };

    it('o plano agendado fica marcado e não pode ser escolhido de novo', () => {
      withChange();
      const { c } = render();
      expect(c.planCtaDisabled(STARTER)).toBe(true);
      expect(c.planCtaLabel(STARTER)).toBe('Mudança agendada');
    });

    it('diz o que muda e quando', () => {
      withChange();
      const { el } = render();
      expect(textOf(el, 'scheduled-change')).toBe('Muda para Starter mensal em 13/11/2026');
    });

    it('o resumo diz a próxima data sem afirmar a cobrança do plano atual', () => {
      withChange();
      const { el } = render();
      expect(textOf(el, 'billing-failure')).toContain('Em 13/11 você passa para o Starter mensal');
    });

    it('sem mudança agendada nada disso aparece', () => {
      onPro();
      summarySignal.set(proSummary({ actions: ['UPDATE_CARD', 'CHANGE_PLAN', 'CANCEL'] }));
      const { el } = render();
      expect(byTest(el, 'scheduled-change')).toBeNull();
      expect(byTest(el, 'row-undo-plan-change')).toBeNull();
      expect(byTest(el, 'row-cancel')).not.toBeNull();
    });

    it('Desfazer entra no lugar de Cancelar', () => {
      withChange();
      const { el } = render();
      expect(byTest(el, 'row-undo-plan-change')).not.toBeNull();
      expect(byTest(el, 'row-cancel')).toBeNull();
    });

    it('sem a ação no resumo (somente leitura) não oferece desfazer', () => {
      withChange();
      summarySignal.set(proSummary({ canManage: false, actions: [], scheduledChangePlanCode: 'STARTER_MONTHLY_STRIPE', scheduledChangeAt: SCHEDULED_AT }));
      const { el } = render();
      expect(byTest(el, 'row-undo-plan-change')).toBeNull();
      expect(textOf(el, 'scheduled-change')).toContain('Starter');
    });

    it('PAST_DUE com mudança pendente: não desfaz, e cancelar continua aberto', () => {
      withChange({ status: 'PAST_DUE' });
      summarySignal.set(proSummary({ state: 'PAST_DUE', actions: ['PAY_NOW', 'UPDATE_CARD', 'CANCEL'], scheduledChangePlanCode: 'STARTER_MONTHLY_STRIPE', scheduledChangeAt: SCHEDULED_AT }));
      const { el } = render();
      expect(byTest(el, 'row-undo-plan-change')).toBeNull();
      expect(byTest(el, 'row-cancel')).not.toBeNull();
    });

    it('dois cliques desfazem uma vez e a página relê', () => {
      const pending = new Subject<ScheduledPlanChange>();
      billing.undoPlanChange.mockReturnValue(pending);
      withChange();
      const { el, fixture } = render();
      const row = byTest(el, 'row-undo-plan-change') as HTMLButtonElement;
      row.click();
      row.click();
      fixture.detectChanges();
      expect(billing.undoPlanChange).toHaveBeenCalledTimes(1);
      const reads = billing.loadSummary.mock.calls.length;
      pending.next(undone);
      pending.complete();
      expect(notifications.success).toHaveBeenCalledWith('Mudança desfeita.');
      expect(billing.loadSummary.mock.calls.length).toBeGreaterThan(reads);
    });

    it.each([
      [409, 'PLAN_CHANGE_TOO_LATE', /renovação já aconteceu/i],
      [503, undefined, /stripe não respondeu.*nada mudou/i],
      [403, undefined, /dono da conta/i],
      [500, undefined, /Não conseguimos concluir o desfazer. Tente de novo em instantes./],
      [504, undefined, /Não conseguimos confirmar/],
    ])('%i %s ao desfazer: traduz e relê', (status, code, copy) => {
      billing.undoPlanChange.mockReturnValue(throwError(() => apiError(status, code, 'servidor')));
      withChange();
      const { el, fixture } = render();
      const reads = billing.loadSummary.mock.calls.length;
      (byTest(el, 'row-undo-plan-change') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.textContent).toMatch(copy);
      expect(notifications.success).not.toHaveBeenCalled();
      expect(billing.loadSummary.mock.calls.length).toBeGreaterThan(reads);
    });

    it('500 ao desfazer deixa tentar de novo: repetir conclui', () => {
      billing.undoPlanChange.mockReturnValueOnce(throwError(() => apiError(500, undefined, 'servidor')));
      withChange();
      const { el, fixture } = render();
      (byTest(el, 'row-undo-plan-change') as HTMLButtonElement).click();
      fixture.detectChanges();
      const row = byTest(el, 'row-undo-plan-change') as HTMLButtonElement;
      expect(row.disabled).toBe(false);
      row.click();
      expect(billing.undoPlanChange).toHaveBeenCalledTimes(2);
      expect(notifications.success).toHaveBeenCalledWith('Mudança desfeita.');
    });

    it('sem resposta ao desfazer não afirma nada', () => {
      billing.undoPlanChange.mockReturnValue(throwError(() => new TimeoutError()));
      withChange();
      const { el, fixture } = render();
      (byTest(el, 'row-undo-plan-change') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.textContent).toMatch(/Não conseguimos confirmar/);
    });

    it('cancelar com mudança pendente mostra a saída, sem desfazer em silêncio', () => {
      billing.cancel.mockReturnValue(throwError(() => apiError(409, 'CANCEL_PLAN_CHANGE_SCHEDULED', 'servidor')));
      onPro();
      summarySignal.set(proSummary({ actions: ['UPDATE_CARD', 'CHANGE_PLAN', 'CANCEL'] }));
      const { c, el, fixture } = render();
      (c as unknown as { onCancelConfirmed(): void }).onCancelConfirmed();
      fixture.detectChanges();
      expect(el.textContent).toMatch(/desfaça.*antes de cancelar/i);
      expect(billing.undoPlanChange).not.toHaveBeenCalled();
    });
  });

  describe('próxima cobrança no cartão de status', () => {
    const amount = (c: Probe): string => {
      const value = c.heroAmount();
      return value ? `${value.reais},${value.cents}` : '';
    };

    it('com desconto mostra o valor real, marcado como a próxima cobrança', () => {
      summarySignal.set(summary({ nextChargeAmountCents: 5000 }));
      const { c, el } = render();
      expect(amount(c)).toBe('50,00');
      expect(c.heroPer()).toBe('próxima cobrança');
      expect(textOf(el, 'billing-hero')).toContain('próxima cobrança');
    });

    it('com mudança agendada mostra o valor do plano novo', () => {
      onPro({ scheduledChangePlanCode: 'STARTER_MONTHLY_STRIPE', scheduledChangeAt: '2026-11-13T10:00:00' });
      summarySignal.set(proSummary({ nextChargeAmountCents: 7990 }));
      const { c } = render();
      expect(amount(c)).toBe('79,90');
      expect(c.heroPer()).toBe('próxima cobrança');
    });

    it('igual ao preço do plano, fica como sempre foi', () => {
      summarySignal.set(summary({ nextChargeAmountCents: 7990 }));
      const { c } = render();
      expect(amount(c)).toBe('79,90');
      expect(c.heroPer()).toBe('/mês');
    });

    it('no plano anual igual ao preço, fica /ano', () => {
      subscriptionSignal.set(subscription({ planCode: 'STARTER_YEARLY_STRIPE', billingCycle: 'YEARLY' }));
      summarySignal.set(
        summary({
          plan: { code: 'STARTER_YEARLY_STRIPE', name: 'STARTER', period: 'YEARLY', price: 799, vehicleLimit: 15, contactOnly: false },
          nextChargeAmountCents: 79900,
        }),
      );
      const { c } = render();
      expect(c.heroPer()).toBe('/ano');
    });

    it('nulo: cai no preço do plano e não o chama de próxima cobrança', () => {
      summarySignal.set(summary({ nextChargeAmountCents: null }));
      const { c } = render();
      expect(amount(c)).toBe('79,90');
      expect(c.heroPer()).toBe('/mês');
    });

    it('ausente, de um backend antigo, faz o mesmo', () => {
      const { c } = render();
      expect(amount(c)).toBe('79,90');
      expect(c.heroPer()).toBe('/mês');
    });

    it('zero é um valor: mostra zero, sem cair no preço do plano', () => {
      summarySignal.set(summary({ nextChargeAmountCents: 0 }));
      const { c } = render();
      expect(amount(c)).toBe('0,00');
      expect(c.heroPer()).toBe('próxima cobrança');
    });

    it('quem deve continua vendo o valor em aberto', () => {
      subscriptionSignal.set(subscription({ status: 'PAST_DUE' }));
      summarySignal.set(summary({ state: 'PAST_DUE', amountDueCents: 7990, nextChargeAmountCents: 5000 }));
      const { c } = render();
      expect(amount(c)).toBe('79,90');
      expect(c.heroPer()).toBe('em aberto');
    });
  });

  describe('PROVIDER_MISMATCH na prévia', () => {
    const MESSAGE = 'A Stripe mostra outro preço nesta assinatura. Fale com o suporte.';

    it('mostra a mensagem do servidor, sem botão de confirmar', () => {
      billing.planChangePreview.mockReturnValue(of(blocked('PROVIDER_MISMATCH', MESSAGE)));
      const { c, el } = startUpgrade();
      expect(c.sheet()).toBe('notice');
      expect(textOf(el, 'plan-notice-message')).toBe(MESSAGE);
      expect(byTest(el, 'upgrade-confirm')).toBeNull();
      expect(billing.upgrade).not.toHaveBeenCalled();
      expect(billing.schedulePlanChange).not.toHaveBeenCalled();
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('tem título próprio', () => {
      billing.planChangePreview.mockReturnValue(of(blocked('PROVIDER_MISMATCH', MESSAGE)));
      const { el } = startUpgrade();
      expect(byTest(el, 'bottom-sheet')?.textContent).toContain('Precisamos revisar sua assinatura');
    });

    it('sem mensagem do servidor ainda explica e aponta o suporte', () => {
      billing.planChangePreview.mockReturnValue(of(inPlace({ mode: 'BLOCKED', reasonCode: 'PROVIDER_MISMATCH', message: null })));
      const { el } = startUpgrade();
      expect(textOf(el, 'plan-notice-message')).toMatch(/nada foi alterado.*suporte/i);
    });
  });

  describe('503 em cancelar, voltar ao gratuito e reativar', () => {
    const NOTHING_CHANGED = /stripe não respondeu.*nada mudou.*tente de novo/i;
    const unavailable = (): HttpErrorResponse => apiError(503, undefined, 'Não conseguimos falar com o Stripe agora.');

    it('cancelar: diz que nada mudou e não finge que deu certo', () => {
      billing.cancel.mockReturnValue(throwError(unavailable));
      onPro();
      summarySignal.set(proSummary({ actions: ['UPDATE_CARD', 'CHANGE_PLAN', 'CANCEL'] }));
      const { c, el, fixture } = render();
      const subscriptionReads = billing.loadSubscription.mock.calls.length;
      c.onCancelConfirmed();
      fixture.detectChanges();
      expect(c.accountActionError()).toMatch(NOTHING_CHANGED);
      expect(el.textContent).toMatch(NOTHING_CHANGED);
      expect(notifications.success).not.toHaveBeenCalled();
      expect(billing.loadSubscription.mock.calls.length).toBe(subscriptionReads);
      expect(billing.clearError).toHaveBeenCalled();
      expect(byTest(el, 'row-cancel')).not.toBeNull();
    });

    it('voltar ao gratuito: o aviso aparece, não num cartão de folha fechada', () => {
      onPro();
      billing.downgrade.mockReturnValue(throwError(unavailable));
      const { c, el, fixture } = render();
      c.onPlanCta(TRIAL);
      c.confirmDowngrade();
      fixture.detectChanges();
      expect(c.sheet()).toBe('notice');
      expect(textOf(el, 'plan-notice-message')).toMatch(NOTHING_CHANGED);
      expect(notifications.success).not.toHaveBeenCalled();
      expect(billing.clearError).toHaveBeenCalled();
    });

    it('reativar: não empurra quem ainda tem assinatura para os planos', () => {
      billing.reactivate.mockReturnValue(throwError(unavailable));
      onPro({ cancelAtPeriodEnd: true });
      const { c } = render();
      c.reactivate();
      expect(c.accountActionError()).toMatch(NOTHING_CHANGED);
      expect(c.sheet()).toBeNull();
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('reativar recusado de verdade ainda leva aos planos, como hoje', () => {
      billing.reactivate.mockReturnValue(throwError(() => apiError(400, undefined, 'Período encerrado.')));
      onPro({ cancelAtPeriodEnd: true });
      const { c } = render();
      c.reactivate();
      expect(c.accountActionError()).toBe('Período encerrado.');
      expect(c.sheet()).toBe('plans');
    });

    it('sem resposta não afirma que nada mudou', () => {
      billing.cancel.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 504 })));
      onPro();
      const { c } = render();
      c.onCancelConfirmed();
      expect(c.accountActionError()).not.toMatch(/nada mudou/i);
    });

    it('a recusa do cancelamento chega como texto, porque /cancel responde texto', () => {
      billing.cancel.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: JSON.stringify({ message: 'servidor', code: 'CANCEL_PLAN_CHANGE_SCHEDULED' }),
            }),
        ),
      );
      onPro();
      const { c } = render();
      c.onCancelConfirmed();
      expect(c.accountActionError()).toMatch(/desfaça.*antes de cancelar/i);
    });
  });

  describe('assinatura encerrada sem dívida', () => {
    it('a página não fala em fatura em aberto', () => {
      subscriptionSignal.set(subscription({ status: 'CANCELED', currentPeriodEnd: serverTime(-5 * 86_400_000) }));
      summarySignal.set(summary({ state: 'CANCELED', plan: null, actions: ['SUBSCRIBE'], paymentMethod: null }));
      const { el } = render();
      expect(el.textContent).not.toMatch(/em aberto|não foi paga/i);
    });
  });

  describe('plano mais barato e troca de período também têm prévia (FE4)', () => {

    it('trava aparece antes do aviso de perda', () => {
      onPro();
      billing.planChangePreview.mockReturnValue(of(blocked('DOWNGRADE_LOCKED_UNTIL_PAID', 'Fatura de 13/11/2026.')));
      const { c } = render();
      c.onPlanCta(STARTER);
      expect(billing.planChangePreview).toHaveBeenCalledExactlyOnceWith('STARTER_MONTHLY_STRIPE');
      expect(c.periodSwitchTarget()).toBeNull();
      expect(c.sheet()).toBe('notice');
    });

    it('CHECKOUT mantém o aviso de perda', () => {
      onPro();
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c } = render();
      c.onPlanCta(STARTER);
      expect(c.periodSwitchTarget()).toEqual(STARTER);
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('sem dias pagos, ainda confirma: a troca paga nunca vai direto', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', currentPeriodEnd: serverTime(-2 * 86_400_000) }));
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c } = render();
      c.onPlanCta(STARTER);
      expect(c.periodSwitchTarget()).toEqual(STARTER);
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('troca de período também passa pela prévia', () => {
      billing.planChangePreview.mockReturnValue(of(checkout('NOT_ACTIVE')));
      const { c } = render();
      c.onPlanCta(PRO_Y);
      expect(billing.planChangePreview).toHaveBeenCalledExactlyOnceWith('PRO_YEARLY_STRIPE');
      expect(c.periodSwitchTarget()).toEqual(PRO_Y);
    });
  });
});
