import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { KpiCard } from '../../../components/kpi-card/kpi-card';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { type FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { formatDateRangePtBr } from '../../../components/date-range-picker/date-range-picker';
import {
  DataList,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { BrlPipe, formatBrl } from '../../../pipes/brl.pipe';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminBillingService } from '../admin-billing.service';
import {
  AdminBillingIssue,
  AdminMrrPlanBreakdown,
  AdminSubscriptionListItem,
  BillingIssueWindow,
} from '../../../types/admin-billing.types';
import { brtIsoDate, shiftIsoDate } from '../notifications/admin-notifications';
import { whenExact } from '../audit/admin-when';
import { formatFullDate, parseServerTime } from '../../../utils/server-time';
import { planDisplayName } from '../../../utils/plan-grid-copy';
import { gatewayLabel } from './gateway-label';

const PAGE_SIZE = 20;

/** 30 sozinho esconde problema antigo ainda aberto — ver `windowNotice`. */
const ISSUE_WINDOWS: readonly BillingIssueWindow[] = [30, 90, 365];

/** Situação = `app-status-chip` (texto sobre fundo tingido, sem bolinha). */
interface ChipStyle {
  label: string;
  tone: StatusChipTone;
}

/** Fallback só. O filtro é populado por `GET /v1/admin/billing/statuses`. */
const SUB_STATUS_CHIPS: Record<string, ChipStyle> = {
  TRIALING: { label: 'Trial', tone: 'blue' },
  ACTIVE: { label: 'Ativa', tone: 'green' },
  PAST_DUE: { label: 'Atrasada', tone: 'amber' },
  UNPAID: { label: 'Não paga', tone: 'amber' },
  INCOMPLETE: { label: 'Incompleta', tone: 'amber' },
  CANCELED: { label: 'Cancelada', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  EXPIRED: { label: 'Expirada', tone: 'red' },
};

const COMPANY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CANCELLED: 'Cancelada',
  CANCELED: 'Cancelada',
};

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
  ANNUAL: 'Anual',
  ANNUALLY: 'Anual',
  QUARTERLY: 'Trimestral',
  WEEKLY: 'Semanal',
  DAILY: 'Diária',
};

/**
 * Rótulo + o que o admin deve FAZER com o problema. `kind` é vocabulário aberto:
 * um valor novo cai no fallback humanizado em vez de sumir da lista.
 */
interface IssueKindStyle {
  label: string;
  tone: StatusChipTone;
  guidance: string;
}

const ISSUE_KINDS: Record<string, IssueKindStyle> = {
  SUBSCRIPTION_PAST_DUE: {
    label: 'Assinatura vencida',
    tone: 'red',
    guidance:
      'A cobrança do ciclo não foi confirmada. Verifique o pagamento no gateway e, ' +
      'se não houver regularização, suspenda a empresa.',
  },
  RECONCILIATION_PENDING: {
    label: 'Reconciliação pendente',
    tone: 'amber',
    guidance:
      'O que está no gateway não bate com o que está na base. Confira a assinatura ' +
      'no gateway antes de mudar plano ou status por aqui.',
  },
};

/**
 * Razões dos problemas. `PAST_DUE` é a de `SUBSCRIPTION_PAST_DUE`, fixa na consulta do backend
 * (`AdminBillingRepositoryImpl`); as outras duas são de `RECONCILIATION_PENDING`, vocabulário
 * real lido da migration V35 (`billing_reconciliations`). Não adicione chave por plausibilidade:
 * valor novo cai no `humanize()` de `issueReason()` e continua legível na tela.
 */
const ISSUE_REASON_LABELS: Record<string, string> = {
  PAST_DUE: 'Pagamento do ciclo em atraso',
  PLAN_MISMATCH: 'Plano da assinatura diverge do plano cobrado',
  ZERO_AMOUNT_PAID_PLAN: 'Pagamento registrado com valor zero em um plano pago',
};

/** `PLAN_MISMATCH` → `Plan mismatch`. Só para valores sem rótulo mapeado. */
function humanize(raw: string): string {
  const spaced = raw.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `YYYY-MM-DD` (data pura) vira `dd/mm/aaaa` SEM passar por `Date`: `new Date('2026-08-01')` é
 * meia-noite UTC, que em Brasília ainda é 31/07. Instantes (`...T10:30:00`) são `LocalDateTime`
 * em UTC sem sufixo: passam por `parseServerTime` e saem no dia de Brasília (02:00 UTC de 13/12
 * ainda é 12/12 aqui).
 */
export function formatBillingDate(value: string | null | undefined): string {
  if (!value) return '—';
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  return formatFullDate(parseServerTime(value));
}

/** Instante do servidor em Brasília, "12/11/2026 às 14:08", como no resto do admin; "—" sem data. */
export function formatBillingDateTime(value: string | null | undefined): string {
  return whenExact(value) ?? '—';
}

/**
 * O intervalo que a janela de problemas cobre, como o servidor decide (`occurred_at >= now() -
 * N dias`): de hoje menos N até hoje, em Brasília. A resposta não traz `from/to`; este é o mesmo
 * cálculo, para a data ficar visível (regra de data, auditoria 18/11 §4).
 */
export function issueWindowRange(days: number, todayIso: string): { from: string; to: string } {
  return { from: shiftIsoDate(todayIso, -days), to: todayIso };
}

/**
 * Assinaturas (admin): composição do MRR, problemas de cobrança e a lista de assinaturas.
 * Padrão de lista do admin (18/11/2026): `app-kpi-card`, `app-list-toolbar` + `app-data-list`
 * (sem linhas, cabeçalho em caixa normal, cartões no celular), dinheiro pelo pipe `brl`.
 */
@Component({
  selector: 'app-admin-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    KpiCard,
    StatusChip,
    ListToolbar,
    DataList,
    DataListCell,
    BrlPipe,
  ],
  templateUrl: './admin-billing.html',
})
export class AdminBilling implements OnInit {
  private readonly billing = inject(AdminBillingService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly subscriptions = this.billing.subscriptions;
  protected readonly subscriptionsTotal = this.billing.subscriptionsTotal;
  protected readonly subscriptionsLoading = this.billing.subscriptionsLoading;
  protected readonly mrr = this.billing.mrr;
  protected readonly mrrLoading = this.billing.mrrLoading;
  protected readonly issues = this.billing.issues;
  protected readonly issuesTotal = this.billing.issuesTotal;
  protected readonly issuesLoading = this.billing.issuesLoading;

  /** Um banner por bloco: o 400 do filtro de status não pode derrubar MRR/problemas. */
  protected readonly subscriptionsError = signal<string | null>(null);
  protected readonly mrrError = signal<string | null>(null);
  protected readonly issuesError = signal<string | null>(null);

  protected readonly statusFilter = signal<string>('');
  protected readonly subscriptionsPage = signal(0);

  protected readonly issueWindow = signal<BillingIssueWindow>(30);
  protected readonly issuesPage = signal(0);

  /** Pílulas de situação: "Todas" + o vocabulário do servidor (o valor cru vai na busca). */
  protected readonly statusOptions = computed<FilterChipOption<string>[]>(() => [
    { value: '', label: 'Todas' },
    ...this.billing
      .statuses()
      .map((value) => ({ value, label: this.statusChip(value).label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  ]);

  protected readonly windowOptions: readonly FilterChipOption<BillingIssueWindow>[] =
    ISSUE_WINDOWS.map((days) => ({ value: days, label: `${days} dias` }));

  /**
   * "19/10/2026 a 18/11/2026": a janela escrita em datas. Um método, não um `computed`: `Date` não
   * é sinal, e o valor guardado ficaria com a data de ontem numa tela aberta de um dia para o outro
   * (mesma escolha do `maxDate()` do seletor de período).
   */
  protected windowRangeText(): string | null {
    return formatDateRangePtBr(issueWindowRange(this.issueWindow(), brtIsoDate(new Date())));
  }

  protected readonly planColumns: readonly DataListColumn<AdminMrrPlanBreakdown>[] = [
    { key: 'plan', header: 'Plano', primary: true, value: (p) => this.planName(p.planName, p.planCode) },
    { key: 'gateway', header: 'Gateway', optional: true, value: (p) => gatewayLabel(p.gateway) },
    { key: 'price', header: 'Preço do plano', kind: 'money-cents', end: true, value: (p) => p.planPriceCents },
    { key: 'subs', header: 'Assinaturas', optional: true, kind: 'integer', end: true, value: (p) => p.subscriptionsTotal },
    {
      key: 'activeTrial',
      header: 'Ativas / trial',
      optional: true,
      end: true,
      value: (p) => `${p.activeTotal} / ${p.trialingTotal}`,
    },
    {
      key: 'pastDueCanceled',
      header: 'Atrasadas / canceladas',
      optional: true,
      end: true,
      value: (p) => `${p.pastDueTotal} / ${p.canceledTotal}`,
    },
    { key: 'mrr', header: 'MRR', kind: 'money-cents', end: true, value: (p) => p.mrrCents },
    {
      key: 'mrrActive',
      header: 'MRR só de ativas',
      kind: 'money-cents',
      end: true,
      value: (p) => p.activeOnlyMrrCents,
    },
  ];

  protected readonly issueColumns: readonly DataListColumn<AdminBillingIssue>[] = [
    { key: 'company', header: 'Empresa', primary: true, value: (i) => i.companyName },
    {
      key: 'kind',
      header: 'Tipo',
      kind: 'status',
      value: (i) => this.issueKind(i.kind).label,
      tone: (i) => this.issueKind(i.kind).tone,
    },
    { key: 'occurredAt', header: 'Início', value: (i) => this.formatDateTime(i.occurredAt) },
    { key: 'plan', header: 'Plano / gateway', optional: true, value: (i) => this.planName(i.planName, i.planCode) },
    { key: 'amount', header: 'Valor', end: true, value: (i) => this.issueAmount(i) },
    { key: 'todo', header: 'O que fazer', optional: true, value: (i) => this.issueKind(i.kind).guidance },
  ];

  protected readonly subscriptionColumns: readonly DataListColumn<AdminSubscriptionListItem>[] = [
    { key: 'company', header: 'Empresa', primary: true, value: (s) => s.companyName },
    { key: 'plan', header: 'Plano', optional: true, value: (s) => this.planName(s.planName, s.planCode) },
    { key: 'gateway', header: 'Gateway', optional: true, value: (s) => gatewayLabel(s.gateway) },
    { key: 'status', header: 'Situação', value: (s) => this.statusChip(s.status).label },
    {
      key: 'price',
      header: 'Mensalidade',
      kind: 'money-cents',
      end: true,
      value: (s) => s.monthlyPriceCents,
    },
    { key: 'next', header: 'Próxima cobrança', value: (s) => this.formatDate(s.nextBillingAt) },
  ];

  protected readonly planRowId = (p: AdminMrrPlanBreakdown): string => p.planId;
  protected readonly subscriptionRowId = (s: AdminSubscriptionListItem): string => s.id;

  protected readonly subscriptionsPages = computed(() =>
    Math.max(1, Math.ceil(Math.max(0, this.subscriptionsTotal()) / PAGE_SIZE)),
  );
  protected readonly canNextSubscriptions = computed(
    () => this.subscriptionsPage() + 1 < this.subscriptionsPages(),
  );

  protected readonly issuesPages = computed(() =>
    Math.max(1, Math.ceil(Math.max(0, this.issuesTotal()) / PAGE_SIZE)),
  );

  /**
   * Texto que evita a leitura errada mais cara desta tela: "não apareceu nada,
   * logo não há problema". A janela recorta pelo INÍCIO do problema.
   */
  protected readonly windowNotice = computed(
    () =>
      `A janela filtra pela data em que o problema COMEÇOU, não pela última ` +
      `movimentação. Um problema aberto há mais de ${this.issueWindow()} dias não ` +
      `aparece nesta lista — amplie a janela antes de concluir que está tudo em dia.`,
  );

  /** Só faz sentido sugerir "amplie a janela" enquanto ela não for a maior. */
  protected readonly canWidenWindow = computed(() => this.issueWindow() !== 365);

  protected readonly totalMrr = computed(() => this.mrr()?.totalMrrCents ?? null);
  protected readonly activeOnlyMrr = computed(() => this.mrr()?.activeOnlyMrrCents ?? null);
  protected readonly totalSubscriptions = computed(() => this.mrr()?.totalSubscriptions ?? 0);
  protected readonly byPlan = computed(() => this.mrr()?.byPlan ?? []);

  constructor() {
    effect(() => {
      const status = this.statusFilter();
      const page = this.subscriptionsPage();
      this.subscriptionsError.set(null);
      this.billing.loadSubscriptions({ status, page, size: PAGE_SIZE }).subscribe({
        error: (err: HttpErrorResponse) =>
          this.subscriptionsError.set(
            this.apiErrors.messageFor(
              err,
              'Não foi possível carregar as assinaturas. Tente novamente.',
            ),
          ),
      });
    });

    effect(() => {
      const days = this.issueWindow();
      const page = this.issuesPage();
      this.issuesError.set(null);
      this.billing.loadIssues({ days, page, size: PAGE_SIZE }).subscribe({
        error: (err: HttpErrorResponse) =>
          this.issuesError.set(
            this.apiErrors.messageFor(
              err,
              'Não foi possível carregar os problemas de cobrança. Tente novamente.',
            ),
          ),
      });
    });
  }

  ngOnInit(): void {
    // Falha no vocabulário do filtro é silenciosa: a listagem segue utilizável.
    this.billing.loadStatuses().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
    this.loadMrr();
  }

  protected reloadMrr(): void {
    this.loadMrr();
  }

  protected setStatusFilter(value: string): void {
    this.subscriptionsPage.set(0);
    this.statusFilter.set(value);
  }

  protected clearStatusFilter(): void {
    this.setStatusFilter('');
  }

  protected setIssueWindow(days: BillingIssueWindow): void {
    this.issuesPage.set(0);
    this.issueWindow.set(days);
  }

  /** "Ampliar a janela" do vazio: passa para a próxima janela maior. */
  protected widenWindow(): void {
    const next = ISSUE_WINDOWS.find((d) => d > this.issueWindow());
    if (next) this.setIssueWindow(next);
  }

  protected goToSubscriptionsPage(page: number): void {
    if (page >= 0 && page < this.subscriptionsPages()) this.subscriptionsPage.set(page);
  }

  protected nextSubscriptions(): void {
    if (this.canNextSubscriptions()) this.subscriptionsPage.update((p) => p + 1);
  }

  protected goToIssuesPage(page: number): void {
    if (page >= 0 && page < this.issuesPages()) this.issuesPage.set(page);
  }

  protected statusChip(status: string | null): ChipStyle {
    if (!status) return { label: '—', tone: 'neutral' };
    return SUB_STATUS_CHIPS[status] ?? { label: humanize(status), tone: 'neutral' };
  }

  protected companyStatusLabel(status: string | null): string {
    if (!status) return '—';
    return COMPANY_STATUS_LABELS[status] ?? humanize(status);
  }

  protected periodLabel(period: string | null): string {
    if (!period) return '—';
    return PERIOD_LABELS[period] ?? humanize(period);
  }

  /** "Pro", nunca "PRO" nem `PRO_MONTHLY_STRIPE`; o período vai na linha de baixo. */
  protected planName(name: string | null, code: string | null): string {
    return planDisplayName(name, code);
  }

  protected gateway(raw: string | null): string {
    return gatewayLabel(raw);
  }

  protected issueKind(kind: string): IssueKindStyle {
    return (
      ISSUE_KINDS[kind] ?? {
        label: humanize(kind),
        tone: 'neutral',
        guidance: 'Problema não catalogado nesta tela — confira a assinatura no gateway.',
      }
    );
  }

  protected issueReason(reason: string | null): string {
    if (!reason) return '';
    return ISSUE_REASON_LABELS[reason] ?? humanize(reason);
  }

  /** `subscriptionId` costuma ser UUID: os 8 últimos bastam para conferir. */
  protected shortId(id: string | null): string {
    if (!id) return '—';
    return id.length <= 8 ? id : `…${id.slice(-8)}`;
  }

  /**
   * `amountCents` vem `null` quando o provedor não informa o valor. Zero é um
   * valor de verdade; ausência é outra coisa e NÃO pode virar "R$ 0,00".
   */
  protected issueAmount(issue: AdminBillingIssue): string {
    if (issue.amountCents === null || issue.amountCents === undefined) {
      return 'Valor não informado';
    }
    return formatBrl(issue.amountCents);
  }

  protected issueAmountClass(issue: AdminBillingIssue): string {
    return issue.amountCents === null || issue.amountCents === undefined
      ? 'text-fg-subtle italic whitespace-normal'
      : 'text-fg tabular-nums whitespace-nowrap';
  }

  protected formatDate(value: string | null): string {
    return formatBillingDate(value);
  }

  protected formatDateTime(value: string | null): string {
    return formatBillingDateTime(value);
  }

  private loadMrr(): void {
    this.mrrError.set(null);
    this.billing.loadMrr().subscribe({
      error: (err: HttpErrorResponse) =>
        this.mrrError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar a composição do MRR.'),
        ),
    });
  }
}
