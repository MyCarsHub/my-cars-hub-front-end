import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminBilling } from './admin-billing';
import { AdminBillingService } from '../admin-billing.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type {
  AdminBillingIssue,
  AdminMrrBreakdown,
  AdminSubscriptionListItem,
  BillingIssueWindow,
} from '../../../types/admin-billing.types';

const SUBSCRIPTION: AdminSubscriptionListItem = {
  id: 'sub-1',
  companyId: 'cmp-1',
  companyName: 'Locadora Alfa',
  companyStatus: 'ACTIVE',
  planCode: 'PRO_MONTHLY',
  planName: 'Pro Mensal',
  planPeriod: 'MONTHLY',
  status: 'PAST_DUE',
  billingCycle: 'MONTHLY',
  // MAIÚSCULO aqui, minúsculo em byPlan — a divergência que a tela normaliza.
  gateway: 'STRIPE',
  externalIdMasked: 'sub_****9F2',
  trialEndsAt: null,
  currentPeriodStart: '2026-07-01',
  currentPeriodEnd: '2026-07-31',
  nextBillingAt: '2026-08-01',
  cancelAtPeriodEnd: false,
  pastDueSince: '2026-07-02',
  monthlyPriceCents: 19900,
  createdAt: '2026-01-10T09:00:00',
};

const MRR: AdminMrrBreakdown = {
  totalMrrCents: 59700,
  activeOnlyMrrCents: 39800,
  totalSubscriptions: 3,
  byPlan: [
    {
      planId: 'plan-1',
      planCode: 'PRO_MONTHLY',
      planName: 'Pro Mensal',
      planPeriod: 'MONTHLY',
      gateway: 'stripe',
      planPriceCents: 19900,
      subscriptionsTotal: 3,
      activeTotal: 2,
      trialingTotal: 1,
      pastDueTotal: 1,
      canceledTotal: 0,
      mrrCents: 59700,
      activeOnlyMrrCents: 39800,
    },
  ],
};

/** Provedor não informou o valor: `amountCents` nulo. */
const ISSUE_NO_AMOUNT: AdminBillingIssue = {
  kind: 'RECONCILIATION_PENDING',
  reason: 'PLAN_MISMATCH',
  subscriptionId: '11111111-2222-3333-4444-555566667777',
  companyId: 'cmp-2',
  companyName: 'Locadora Beta',
  planCode: 'PRO_MONTHLY',
  planName: 'Pro Mensal',
  gateway: 'stripe',
  externalIdMasked: 'sub_****1A0',
  amountCents: null,
  occurredAt: '2026-06-15T10:30:00',
};

const ISSUE_PAST_DUE: AdminBillingIssue = {
  kind: 'SUBSCRIPTION_PAST_DUE',
  reason: null,
  subscriptionId: 'sub-1',
  companyId: 'cmp-1',
  companyName: 'Locadora Alfa',
  planCode: 'PRO_MONTHLY',
  planName: 'Pro Mensal',
  gateway: 'STRIPE',
  externalIdMasked: 'sub_****9F2',
  amountCents: 19900,
  occurredAt: '2026-07-02T08:00:00',
};

interface BillingHarness {
  setStatusFilter: (v: string) => void;
  setIssueWindow: (d: BillingIssueWindow) => void;
  nextSubscriptions: () => void;
}

describe('AdminBilling', () => {
  let loadSubscriptions: ReturnType<typeof vi.fn>;
  let loadStatuses: ReturnType<typeof vi.fn>;
  let loadMrr: ReturnType<typeof vi.fn>;
  let loadIssues: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  const subscriptions = signal<AdminSubscriptionListItem[]>([]);
  const subscriptionsTotal = signal(0);
  const statuses = signal<string[]>([]);
  const mrr = signal<AdminMrrBreakdown | null>(null);
  const issues = signal<AdminBillingIssue[]>([]);
  const issuesTotal = signal(0);

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminBilling],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: AdminBillingService,
          useValue: {
            subscriptions,
            subscriptionsTotal,
            subscriptionsLoading: signal(false),
            statuses,
            mrr,
            mrrLoading: signal(false),
            issues,
            issuesTotal,
            issuesLoading: signal(false),
            loadSubscriptions,
            loadStatuses,
            loadMrr,
            loadIssues,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  function harness(fixture: { componentInstance: unknown }): BillingHarness {
    return fixture.componentInstance as BillingHarness;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    subscriptions.set([]);
    subscriptionsTotal.set(0);
    statuses.set([]);
    // O serviço real popula o sinal no `tap`; o dublê precisa fazer o mesmo.
    mrr.set(MRR);
    issues.set([]);
    issuesTotal.set(0);
    loadSubscriptions = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    loadStatuses = vi.fn().mockReturnValue(of([]));
    loadMrr = vi.fn().mockReturnValue(of(MRR));
    loadIssues = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    notifyError = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lista assinaturas paginadas com empresa, plano, status e valor em BRL', () => {
    subscriptions.set([SUBSCRIPTION]);
    subscriptionsTotal.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Locadora Alfa');
    expect(text).toContain('Pro Mensal');
    // Centavos viram BRL; o enum cru não vaza na UI.
    expect(text).toContain('R$');
    expect(text).toContain('199,00');
    expect(text).toContain('Atrasada');
    expect(text).not.toContain('PAST_DUE');
    expect(loadSubscriptions).toHaveBeenCalled();
    expect(loadIssues).toHaveBeenCalled();
    expect(loadMrr).toHaveBeenCalled();
  });

  it('mostra o drilldown de MRR por plano com totais e valores em BRL', () => {
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('597,00');
    expect(text).toContain('398,00');
    expect(text).toContain('Composição por plano');
    expect(text).toContain('Pro Mensal');
  });

  it('normaliza o casing divergente de gateway entre assinaturas e byPlan', () => {
    subscriptions.set([SUBSCRIPTION]);
    subscriptionsTotal.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    // A mesma marca não pode aparecer de dois jeitos na mesma tela.
    expect(text).toContain('Stripe');
    expect(text).not.toContain('STRIPE');
    expect(text).not.toContain('stripe');
  });

  it('popula o filtro de status a partir do endpoint, sem hardcode', () => {
    statuses.set(['ACTIVE', 'PAST_DUE']);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    expect(loadStatuses).toHaveBeenCalled();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('ACTIVE');
    expect(values).toContain('PAST_DUE');
    const labels = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(labels).toContain('Atrasada');
  });

  it('refaz a busca com o status cru e volta para a primeira página', () => {
    subscriptions.set([SUBSCRIPTION]);
    subscriptionsTotal.set(60);
    statuses.set(['PAST_DUE']);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();
    harness(fixture).nextSubscriptions();
    fixture.detectChanges();
    loadSubscriptions.mockClear();

    harness(fixture).setStatusFilter('PAST_DUE');
    fixture.detectChanges();

    const args = loadSubscriptions.mock.calls[loadSubscriptions.mock.calls.length - 1][0];
    // O filtro manda o nome do enum cru — traduzir aqui daria 400 no backend.
    expect(args).toMatchObject({ status: 'PAST_DUE', page: 0, size: 20 });
  });

  it('troca a janela de problemas e refaz a busca com os dias escolhidos', () => {
    issues.set([ISSUE_PAST_DUE]);
    issuesTotal.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();
    expect(loadIssues.mock.calls[0][0]).toMatchObject({ days: 30, page: 0 });
    loadIssues.mockClear();

    harness(fixture).setIssueWindow(90);
    fixture.detectChanges();
    expect(loadIssues.mock.calls[loadIssues.mock.calls.length - 1][0]).toMatchObject({ days: 90 });

    loadIssues.mockClear();
    harness(fixture).setIssueWindow(365);
    fixture.detectChanges();
    expect(loadIssues.mock.calls[loadIssues.mock.calls.length - 1][0]).toMatchObject({ days: 365 });

    // As três janelas precisam estar disponíveis: só 30 esconde problema antigo.
    const buttons: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).map((b) => (b as HTMLButtonElement).textContent?.trim() ?? '');
    expect(buttons).toContain('30 dias');
    expect(buttons).toContain('90 dias');
    expect(buttons).toContain('365 dias');
  });

  it('avisa que a janela filtra pelo início do problema, não pela atividade', () => {
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('COMEÇOU');
    expect(text).toContain('amplie a janela');
  });

  it('não renderiza R$ 0,00 quando o provedor não informou o valor', () => {
    issues.set([ISSUE_NO_AMOUNT]);
    issuesTotal.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Valor não informado');
    expect(text).not.toContain('R$ 0,00');
    // Razão e orientação chegam traduzidas, não como enum cru.
    expect(text).toContain('Plano da assinatura diverge do plano cobrado');
    expect(text).not.toContain('PLAN_MISMATCH');
    expect(text).toContain('Reconciliação pendente');
  });

  it('mostra R$ 0,00 quando o valor é zero de verdade', () => {
    // `ZERO_AMOUNT_PAID_PLAN` é exatamente o caso em que zero é o dado real —
    // e a segunda razão que a V35 (`billing_reconciliations`) produz hoje.
    issues.set([{ ...ISSUE_NO_AMOUNT, reason: 'ZERO_AMOUNT_PAID_PLAN', amountCents: 0 }]);
    issuesTotal.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('0,00');
    expect(text).not.toContain('Valor não informado');
    expect(text).toContain('Pagamento registrado com valor zero em um plano pago');
    expect(text).not.toContain('ZERO_AMOUNT_PAID_PLAN');
  });

  it('mostra o estado vazio de problemas sem sugerir que está tudo em dia', () => {
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Nenhum problema de cobrança iniciado nos últimos 30 dias.');
    expect(text).toContain('Isso não descarta problemas mais antigos ainda em aberto');
  });

  it('mostra o estado vazio de assinaturas e muda o texto quando há filtro', () => {
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhuma assinatura cadastrada ainda.');

    harness(fixture).setStatusFilter('ACTIVE');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhuma assinatura com esse status.');
  });

  it('mantém a tela viva quando o status inválido devolve 400', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: 'Status de assinatura desconhecido: FOO.' },
    });
    loadSubscriptions.mockReturnValue(throwError(() => error));
    issues.set([ISSUE_PAST_DUE]);
    issuesTotal.set(1);
    configure();

    const fixture = TestBed.createComponent(AdminBilling);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('app-alert-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Status de assinatura desconhecido: FOO.');
    expect(banner?.querySelector('[role="alert"]')).not.toBeNull();

    // MRR e problemas seguem renderizados — o 400 é local ao bloco de assinaturas.
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Composição por plano');
    expect(text).toContain('Assinatura vencida');
    // O filtro continua utilizável para desfazer a escolha inválida.
    expect(fixture.nativeElement.querySelector('select')).not.toBeNull();

    // Erro reivindicado pela tela: nada de toast por cima do banner.
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });
});
