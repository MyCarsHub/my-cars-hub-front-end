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
      billing.planChangePreview.mockReturnValue(of(checkout('YEARLY_PLAN')));
      const { c } = startUpgrade();
      expect(c.periodSwitchTarget()).toEqual(PRO);
      expect(c.periodSwitchVariant()).toBe('danger');
      expect(billing.startCheckout).not.toHaveBeenCalled();
      c.confirmPeriodSwitch();
      expect(billing.startCheckout).toHaveBeenCalledWith('PRO_MONTHLY_STRIPE');
    });

    it('a folha de planos fecha para o aviso ficar à vista', () => {
      billing.planChangePreview.mockReturnValue(of(checkout('INTERVAL_CHANGE')));
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
      billing.planChangePreview.mockReturnValue(of(checkout('LOWER_PLAN')));
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
      billing.planChangePreview.mockReturnValue(of(checkout('INTERVAL_CHANGE')));
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
      billing.planChangePreview.mockReturnValueOnce(of(checkout('YEARLY_PLAN')));
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
      billing.planChangePreview.mockReturnValue(of(checkout('YEARLY_PLAN')));
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

    it('releitura BLOCKED mostra o motivo', () => {
      refused();
      billing.planChangePreview.mockReturnValue(of(blocked('DOWNGRADE_SCHEDULED', 'Há uma mudança agendada.')));
      const { c, el } = reachCheckout();
      expect(c.sheet()).toBe('notice');
      expect(byTest(el, 'plan-notice-message')?.textContent).toContain('Há uma mudança agendada.');
    });
  });

  describe('plano mais barato e troca de período também têm prévia (FE4)', () => {
    const onPro = (): void => subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' }));

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
      billing.planChangePreview.mockReturnValue(of(checkout('LOWER_PLAN')));
      const { c } = render();
      c.onPlanCta(STARTER);
      expect(c.periodSwitchTarget()).toEqual(STARTER);
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('sem dias pagos, ainda confirma: a troca paga nunca vai direto', () => {
      subscriptionSignal.set(subscription({ planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO', currentPeriodEnd: serverTime(-2 * 86_400_000) }));
      billing.planChangePreview.mockReturnValue(of(checkout('LOWER_PLAN')));
      const { c } = render();
      c.onPlanCta(STARTER);
      expect(c.periodSwitchTarget()).toEqual(STARTER);
      expect(billing.startCheckout).not.toHaveBeenCalled();
    });

    it('troca de período também passa pela prévia', () => {
      billing.planChangePreview.mockReturnValue(of(checkout('INTERVAL_CHANGE')));
      const { c } = render();
      c.onPlanCta(PRO_Y);
      expect(billing.planChangePreview).toHaveBeenCalledExactlyOnceWith('PRO_YEARLY_STRIPE');
      expect(c.periodSwitchTarget()).toEqual(PRO_Y);
    });
  });
});
