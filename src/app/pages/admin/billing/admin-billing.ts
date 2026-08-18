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
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminBillingService } from '../admin-billing.service';
import { AdminBillingIssue, BillingIssueWindow } from '../../../types/admin-billing.types';

const PAGE_SIZE = 20;

/** 30 sozinho esconde problema antigo ainda aberto — ver `windowNotice`. */
const ISSUE_WINDOWS: readonly BillingIssueWindow[] = [30, 90, 365];

interface ChipStyle {
  label: string;
  chip: string;
}

/** Fallback só. O filtro é populado por `GET /v1/admin/billing/statuses`. */
const SUB_STATUS_CHIPS: Record<string, ChipStyle> = {
  TRIALING: { label: 'Trial', chip: 'bg-blue-100 text-blue-700' },
  ACTIVE: { label: 'Ativa', chip: 'bg-emerald-100 text-emerald-700' },
  PAST_DUE: { label: 'Atrasada', chip: 'bg-amber-100 text-amber-800' },
  UNPAID: { label: 'Não paga', chip: 'bg-amber-100 text-amber-800' },
  INCOMPLETE: { label: 'Incompleta', chip: 'bg-amber-100 text-amber-800' },
  CANCELED: { label: 'Cancelada', chip: 'bg-gray-200 text-gray-700' },
  CANCELLED: { label: 'Cancelada', chip: 'bg-gray-200 text-gray-700' },
  EXPIRED: { label: 'Expirada', chip: 'bg-red-100 text-red-700' },
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

const GATEWAY_LABELS: Record<string, string> = {
  STRIPE: 'Stripe',
  MERCADOPAGO: 'Mercado Pago',
  MERCADO_PAGO: 'Mercado Pago',
  PAGARME: 'Pagar.me',
  PAGAR_ME: 'Pagar.me',
  ASAAS: 'Asaas',
  IUGU: 'Iugu',
  MANUAL: 'Manual',
  NONE: 'Sem gateway',
};

/**
 * Rótulo + o que o admin deve FAZER com o problema. `kind` é vocabulário aberto:
 * um valor novo cai no fallback humanizado em vez de sumir da lista.
 */
interface IssueKindStyle {
  label: string;
  chip: string;
  guidance: string;
}

const ISSUE_KINDS: Record<string, IssueKindStyle> = {
  SUBSCRIPTION_PAST_DUE: {
    label: 'Assinatura vencida',
    chip: 'bg-red-100 text-red-700',
    guidance:
      'A cobrança do ciclo não foi confirmada. Verifique o pagamento no gateway e, ' +
      'se não houver regularização, suspenda a empresa.',
  },
  RECONCILIATION_PENDING: {
    label: 'Reconciliação pendente',
    chip: 'bg-amber-100 text-amber-800',
    guidance:
      'O que está no gateway não bate com o que está na base. Confira a assinatura ' +
      'no gateway antes de mudar plano ou status por aqui.',
  },
};

/**
 * Razões de `RECONCILIATION_PENDING`. Vocabulário real lido da migration V35
 * (`billing_reconciliations`) — são só estas duas hoje. Não adicione chave por
 * plausibilidade: valor novo cai no `humanize()` de `issueReason()` e continua
 * legível na tela.
 */
const ISSUE_REASON_LABELS: Record<string, string> = {
  PLAN_MISMATCH: 'Plano da assinatura diverge do plano cobrado',
  ZERO_AMOUNT_PAID_PLAN: 'Pagamento registrado com valor zero em um plano pago',
};

const DEFAULT_CHIP = 'bg-gray-100 text-gray-700';

/** `PLAN_MISMATCH` → `Plan mismatch`. Só para valores sem rótulo mapeado. */
function humanize(raw: string): string {
  const spaced = raw.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `subscriptions[].gateway` chega MAIÚSCULO (`"STRIPE"`) e `mrr.byPlan[].gateway`
 * minúsculo (`"stripe"`). É divergência de schema declarada pelo backend, sem
 * correção prevista. Normalizar aqui é o que impede a mesma marca de aparecer de
 * dois jeitos na mesma tela.
 */
export function gatewayKey(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export function gatewayLabel(raw: string | null | undefined): string {
  const key = gatewayKey(raw);
  if (!key) return '—';
  return GATEWAY_LABELS[key] ?? humanize(key);
}

interface StatusOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-admin-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackLink, RouterLink, DefaultPageLayout, PageCard, AlertBanner],
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

  protected readonly issueWindows = ISSUE_WINDOWS;
  protected readonly issueWindow = signal<BillingIssueWindow>(30);
  protected readonly issuesPage = signal(0);

  protected readonly statusOptions = computed<StatusOption[]>(() =>
    this.billing
      .statuses()
      .map((value) => ({ value, label: this.statusChip(value).label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  );

  protected readonly subscriptionsPages = computed(() =>
    Math.max(1, Math.ceil(Math.max(0, this.subscriptionsTotal()) / PAGE_SIZE)),
  );
  protected readonly canPrevSubscriptions = computed(() => this.subscriptionsPage() > 0);
  protected readonly canNextSubscriptions = computed(
    () => this.subscriptionsPage() + 1 < this.subscriptionsPages(),
  );

  protected readonly issuesPages = computed(() =>
    Math.max(1, Math.ceil(Math.max(0, this.issuesTotal()) / PAGE_SIZE)),
  );
  protected readonly canPrevIssues = computed(() => this.issuesPage() > 0);
  protected readonly canNextIssues = computed(() => this.issuesPage() + 1 < this.issuesPages());

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

  protected isIssueWindow(days: BillingIssueWindow): boolean {
    return this.issueWindow() === days;
  }

  protected prevSubscriptions(): void {
    if (this.canPrevSubscriptions()) this.subscriptionsPage.update((p) => p - 1);
  }

  protected nextSubscriptions(): void {
    if (this.canNextSubscriptions()) this.subscriptionsPage.update((p) => p + 1);
  }

  protected prevIssues(): void {
    if (this.canPrevIssues()) this.issuesPage.update((p) => p - 1);
  }

  protected nextIssues(): void {
    if (this.canNextIssues()) this.issuesPage.update((p) => p + 1);
  }

  protected statusChip(status: string | null): ChipStyle {
    if (!status) return { label: '—', chip: DEFAULT_CHIP };
    return SUB_STATUS_CHIPS[status] ?? { label: humanize(status), chip: DEFAULT_CHIP };
  }

  protected companyStatusLabel(status: string | null): string {
    if (!status) return '—';
    return COMPANY_STATUS_LABELS[status] ?? humanize(status);
  }

  protected periodLabel(period: string | null): string {
    if (!period) return '—';
    return PERIOD_LABELS[period] ?? humanize(period);
  }

  protected gateway(raw: string | null): string {
    return gatewayLabel(raw);
  }

  protected issueKind(kind: string): IssueKindStyle {
    return (
      ISSUE_KINDS[kind] ?? {
        label: humanize(kind),
        chip: DEFAULT_CHIP,
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

  protected formatCents(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  /**
   * `amountCents` vem `null` quando o provedor não informa o valor. Zero é um
   * valor de verdade; ausência é outra coisa e NÃO pode virar "R$ 0,00".
   */
  protected issueAmount(issue: AdminBillingIssue): string {
    if (issue.amountCents === null || issue.amountCents === undefined) {
      return 'Valor não informado';
    }
    return this.formatCents(issue.amountCents);
  }

  protected issueAmountClass(issue: AdminBillingIssue): string {
    return issue.amountCents === null || issue.amountCents === undefined
      ? 'text-gray-500 italic'
      : 'text-gray-900 tabular-nums';
  }

  protected formatDate(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  protected formatDateTime(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
