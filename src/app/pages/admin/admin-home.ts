import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { BarChart, type BarSeries } from '../../components/charts/bar-chart/bar-chart';
import { GrowthChart, type GrowthSeries } from '../../components/charts/growth-chart/growth-chart';
import { RingLegendCard, type RingSlice } from '../../components/charts/ring-legend-card/ring-legend-card';
import { StackedBarChart, type StackRow } from '../../components/charts/stacked-bar-chart/stacked-bar-chart';
import { PageCard } from '../../components/core/page-card/page-card';
import { PillTabs, type PillTabOption } from '../../components/core/pill-tabs/pill-tabs';
import { KpiCard, formatKpiNumber, type KpiCardVariant, type KpiDelta, type KpiNumberFormat } from '../../components/kpi-card/kpi-card';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { downloadCsv } from '../../components/lists/data-list/data-list-csv';
import { AdminCapabilitiesService } from '../../services/admin-capabilities.service';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { AdminCompanyListItem } from '../../types/admin-company.types';
import type { PlatformVendor, PlatformVendorCategory } from '../../types/admin-finance.types';
import type {
  AdminHome as AdminHomeData,
  AdminHomePeriod,
  AdminHomeScope,
  AdminUsage,
  HomeKpi,
} from '../../types/admin-home.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { MONEY_AXIS_FLOOR_CENTS } from '../../utils/money-axis';
import { CostSheet, type CostSheetIntent } from './finance/cost-sheet';
import { AdminHomeService } from './home/admin-home.service';
import {
  bucketLabels,
  buildHomeCsv,
  countDelta,
  dayLabel,
  monthLabels,
  monthLong,
  monthShort,
  nullText,
  percentDelta,
  shortDay,
  vendorColor,
} from './home/admin-home.view';
import { COMPANY_CSV_COLUMNS, HomeCompanies } from './home/home-companies';
import { HomeMovements } from './home/home-movements';
import { HomeUpcoming } from './home/home-upcoming';
import { HomeActivityMap, HomeRoles, HomeTopUsers, HomeUfs } from './home/home-usage';
import { AdminRevenueSection } from './revenue/admin-revenue-section';

/**
 * Barra de status em tom neutro único: cor de status mora só no chip, e o token
 * se ajusta sozinho ao tema claro e escuro.
 */
const STATUS_BAR_COLOR = 'var(--color-fg-subtle)';

interface StatusBar {
  key: string;
  label: string;
  count: number;
  color: string;
  percent: number;
}

const SUB_STATUS_ORDER: Array<{ key: string; label: string }> = [
  { key: 'ACTIVE', label: 'Ativa' },
  // Status EFETIVO do backend: "Trial" só conta teste com fim no futuro; o
  // teste vencido (ainda TRIALING no banco ou já EXPIRED) cai em "Teste vencido".
  { key: 'TRIALING', label: 'Trial' },
  { key: 'PAST_DUE', label: 'Atrasada' },
  { key: 'CANCELED', label: 'Cancelada' },
  { key: 'EXPIRED', label: 'Teste vencido' },
];

const RENTAL_STATUS_ORDER: Array<{ key: string; label: string }> = [
  { key: 'RESERVED', label: 'Reservado' },
  { key: 'ACTIVE', label: 'Em andamento' },
  { key: 'COMPLETED', label: 'Concluído' },
  { key: 'CANCELED', label: 'Cancelado' },
];

const FB_STATUS_ORDER: Array<{ key: string; label: string }> = [
  { key: 'BACKLOG', label: 'Backlog' },
  { key: 'PLANNED', label: 'Planejado' },
  { key: 'IN_PROGRESS', label: 'Em Desenvolvimento' },
  { key: 'DONE', label: 'Concluído' },
  { key: 'REJECTED', label: 'Rejeitado' },
];

const PERIODS: readonly PillTabOption<AdminHomePeriod>[] = [
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '12m', label: '12 meses' },
  { value: 'all', label: 'Desde o início', shortLabel: 'Início' },
];

const SCOPES: readonly PillTabOption<AdminHomeScope>[] = [
  { value: 'clients', label: 'Só clientes' },
  { value: 'all', label: 'Com contas internas', shortLabel: 'Com internas' },
];

/** Cores de dado (o laranja só no MRR real, que é a série do cartão laranja). */
const C = {
  mrrReal: '#F63B04',
  mrrEstimated: '#a3a3a3',
  subs: '#10b981',
  costs: '#fb7185',
  profit: '#0a9b62',
  managedExpected: '#60a5fa',
  managedReceived: '#10b981',
  users: '#8b5cf6',
  companies: '#3b82f6',
  vehicles: '#f59e0b',
} as const;

/** A janela máxima do feed de movimentações (o servidor recusa mais de 366 dias). */
const MOVEMENTS_MAX_DAYS = 365;

interface KpiView {
  readonly key: string;
  readonly label: string;
  readonly variant: KpiCardVariant;
  readonly value: number | null;
  readonly format: KpiNumberFormat;
  readonly detail: string | null;
  readonly delta: KpiDelta | null;
  /** Card que vira botão: abre o "Lançar custo" no que falta. */
  readonly action: CostSheetIntent | null;
  readonly wide?: boolean;
}

interface Chip {
  readonly key: string;
  readonly n: number;
  readonly label: string;
  readonly route: string;
}

interface FunnelStep {
  readonly key: string;
  readonly label: string;
  readonly n: number;
  readonly pct: number;
  readonly fill: string;
}

/** `YYYY-MM-DD` menos `days` dias (aritmética de calendário em UTC, sem fuso). */
function minusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/**
 * Visão geral do admin v2 (`/admin`), no desenho aprovado `Admin.dc.html`: receita real e
 * estimada, custos, lucro, crescimento, saúde do negócio, uso e movimentações, com período e
 * escopo que valem para a tela inteira. Todo número vem do servidor (contrato
 * `2026-11-17_CONTRACT_admin-home.md`); `null` vira "sem dado" com o motivo, nunca zero.
 *
 * Os cartões da Visão geral antiga que não estão no desenho continuam na página, refeitos no
 * padrão novo (decisão do dono, 17/11), em "Mais números da plataforma".
 */
@Component({
  selector: 'app-admin-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultPageLayout,
    PageCard,
    RouterLink,
    PillTabs,
    KpiCard,
    GrowthChart,
    BarChart,
    StackedBarChart,
    RingLegendCard,
    AdminRevenueSection,
    CostSheet,
    HomeCompanies,
    HomeMovements,
    HomeUpcoming,
    HomeRoles,
    HomeActivityMap,
    HomeTopUsers,
    HomeUfs,
  ],
  templateUrl: './admin-home.html',
})
export class AdminHome implements OnInit {
  private readonly metricsService = inject(AdminMetricsService);
  private readonly homeService = inject(AdminHomeService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly caps = inject(AdminCapabilitiesService);

  /** Só o Dono lança custo (`custo.gerir`); o servidor confere de novo. */
  protected readonly canManageCosts = computed(() => this.caps.can('custo.gerir'));

  protected readonly periods = PERIODS;
  protected readonly scopes = SCOPES;
  protected readonly axisFloor = MONEY_AXIS_FLOOR_CENTS;
  protected readonly colors = C;

  protected readonly period = signal<AdminHomePeriod>('12m');
  protected readonly scope = signal<AdminHomeScope>('clients');

  // ---------------------------------------------------------------- dados v2

  private readonly homeRaw = signal<AdminHomeData | null>(null);
  protected readonly homeLoading = signal(true);
  protected readonly homeError = signal<string | null>(null);
  private readonly usageRaw = signal<AdminUsage | null>(null);
  protected readonly usageLoading = signal(true);
  protected readonly usageError = signal<string | null>(null);

  /** Só a resposta da pílula marcada: um número de "30 dias" nunca aparece sob "12 meses". */
  protected readonly home = computed(() => {
    const h = this.homeRaw();
    return h && h.meta.period === this.period() && h.meta.scope === this.scope() ? h : null;
  });
  protected readonly usage = computed(() => {
    const u = this.usageRaw();
    return u && u.meta.period === this.period() && u.meta.scope === this.scope() ? u : null;
  });
  protected readonly pending = computed(() => this.homeLoading() && !this.home());

  private readonly requests = new Subject<{ period: AdminHomePeriod; scope: AdminHomeScope }>();

  /** Linhas do "Cruzamento por empresa", para o Exportar. */
  private readonly companyRows = signal<readonly AdminCompanyListItem[]>([]);

  // ---------------------------------------------------------------- Lançar custo

  protected readonly sheetIntent = signal<CostSheetIntent | null>(null);
  protected readonly sheetVendorId = signal<string | null>(null);
  protected readonly upcomingReloadKey = signal(0);

  protected readonly vendors = computed<PlatformVendor[]>(() =>
    (this.home()?.costs.vendors ?? this.homeRaw()?.costs.vendors ?? []).map((v) => ({
      id: v.vendorId,
      name: v.name,
      category: v.category as PlatformVendorCategory,
      categoryLabel: v.categoryLabel,
      billingDay: v.billingDay,
      active: v.active,
    })),
  );

  // ---------------------------------------------------------------- Visão geral antiga (cartões mantidos)

  protected readonly overview = this.metricsService.overview;
  protected readonly loading = this.metricsService.loading;
  protected readonly error = this.metricsService.error;

  constructor() {
    this.requests
      .pipe(
        switchMap((q) => {
          this.homeLoading.set(true);
          this.homeError.set(null);
          return this.homeService.home(q.period, q.scope).pipe(
            map((res) => ({ res, failure: null as unknown })),
            catchError((failure: unknown) => of({ res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ res, failure }) => {
        this.homeLoading.set(false);
        if (res) {
          this.homeRaw.set(res);
          return;
        }
        this.apiErrors.claim(failure);
        this.homeError.set('Não foi possível carregar os números da plataforma.');
      });

    this.requests
      .pipe(
        switchMap((q) => {
          this.usageLoading.set(true);
          this.usageError.set(null);
          return this.homeService.usage(q.period, q.scope).pipe(
            map((res) => ({ res, failure: null as unknown })),
            catchError((failure: unknown) => of({ res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ res, failure }) => {
        this.usageLoading.set(false);
        if (res) {
          this.usageRaw.set(res);
          return;
        }
        this.apiErrors.claim(failure);
        this.usageError.set('Não foi possível carregar o uso da plataforma.');
      });

    effect(() => this.requests.next({ period: this.period(), scope: this.scope() }));
  }

  ngOnInit(): void {
    this.loadOverview();
    this.caps.ensureLoaded().subscribe();
  }

  protected pickPeriod(p: AdminHomePeriod): void {
    this.period.set(p);
  }

  protected pickScope(s: AdminHomeScope): void {
    this.scope.set(s);
  }

  protected reloadHome(): void {
    this.requests.next({ period: this.period(), scope: this.scope() });
  }

  protected reload(): void {
    this.loadOverview();
  }

  /**
   * The service already puts the message in the page banner; claiming the error
   * stops the interceptor safety net from repeating it as a toast.
   */
  private loadOverview(): void {
    this.metricsService.loadOverview().subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  // ---------------------------------------------------------------- cabeçalho

  protected openCostSheet(intent: CostSheetIntent = 'cost', vendorId: string | null = null): void {
    if (!this.canManageCosts()) return;
    this.sheetVendorId.set(vendorId);
    this.sheetIntent.set(intent);
  }

  /** O primeiro fornecedor ativo sem dia de cobrança. */
  protected askBillingDay(): void {
    const vendor = this.vendors().find((v) => v.active && v.billingDay === null);
    this.openCostSheet('billing-day', vendor?.id ?? null);
  }

  protected onCostSaved(): void {
    this.reloadHome();
    this.upcomingReloadKey.update((n) => n + 1);
  }

  protected closeSheet(): void {
    this.sheetIntent.set(null);
    this.sheetVendorId.set(null);
  }

  protected onCompanyRows(rows: readonly AdminCompanyListItem[]): void {
    this.companyRows.set(rows);
  }

  /** CSV do que está na tela: indicadores, saúde, séries e o cruzamento por empresa. */
  protected exportCsv(): void {
    const h = this.home();
    if (!h) return;
    const csv = buildHomeCsv(h, { columns: COMPANY_CSV_COLUMNS, rows: this.companyRows() });
    downloadCsv(`visao-geral-${h.meta.from}-a-${h.meta.to}`, csv);
  }

  protected readonly chips = computed<Chip[]>(() => {
    const c = this.home()?.chips ?? this.homeRaw()?.chips;
    if (!c) return [];
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
    return [
      {
        key: 'pastDue',
        n: c.pastDueSubscriptions,
        label: plural(c.pastDueSubscriptions, 'assinatura atrasada', 'assinaturas atrasadas'),
        route: '/admin/billing',
      },
      {
        key: 'trials',
        n: c.trialsEndingIn7Days,
        label: plural(c.trialsEndingIn7Days, 'trial vence em 7 dias', 'trials vencem em 7 dias'),
        route: '/admin/companies/converter-testes',
      },
      {
        key: 'feedback',
        n: c.feedbackPending,
        label: plural(c.feedbackPending, 'feedback pendente', 'feedbacks pendentes'),
        route: '/admin/feedback',
      },
      {
        key: 'reconciliation',
        n: c.reconciliationPending,
        label: plural(c.reconciliationPending, 'falha de conciliação', 'falhas de conciliação'),
        route: '/admin/billing',
      },
    ].filter((chip) => chip.n > 0);
  });

  // ---------------------------------------------------------------- 10 cartões

  private readonly month = computed(() => this.home()?.meta.currentMonth ?? null);

  private kpiDetail(kpi: HomeKpi | undefined, fallback: string | null): string | null {
    if (!kpi) return null;
    return kpi.value === null ? nullText(kpi, this.month()) : fallback;
  }

  /** Card nulo por falta de custo vira atalho para lançar (quem pode). */
  private costAction(kpi: HomeKpi | undefined, intent: CostSheetIntent = 'cost'): CostSheetIntent | null {
    if (!kpi || kpi.value !== null || !this.canManageCosts()) return null;
    if (kpi.nullReason === 'NO_COSTS' && intent === 'cost') return 'cost';
    if (kpi.nullReason === 'NO_ACQUISITION_COST' && intent === 'acquisition') return 'acquisition';
    return null;
  }

  protected readonly kpis = computed<KpiView[]>(() => {
    const h = this.home();
    const k = h?.kpis;
    const startCaption = (kpi: HomeKpi | undefined) =>
      kpi?.previousAsOf ? `vs ${shortDay(kpi.previousAsOf)}` : 'vs início do período';
    const mrrRealDetail = () => {
      const without = k?.mrrReal.parts['withoutChargedAmount'] ?? 0;
      if (!k || k.mrrReal.value === null) return this.kpiDetail(k?.mrrReal, null);
      return without ? `cobrado de fato; ${without} pelo preço de tabela` : 'cobrado de fato, com cupons';
    };
    const vendorsWithCost = k?.costsMonth.parts['vendorsWithCost'];
    const internal = k?.companies.parts['internal'];
    return [
      {
        key: 'mrrReal',
        label: 'MRR real',
        variant: 'primary',
        value: k?.mrrReal.value ?? null,
        format: 'brl-cents-whole',
        delta: percentDelta(k?.mrrReal, startCaption(k?.mrrReal)),
        detail: mrrRealDetail(),
        action: null,
        wide: true,
      },
      {
        key: 'profit',
        label: 'Lucro do mês',
        variant: 'emerald-dark',
        value: k?.profitMonth.value ?? null,
        format: 'brl-cents-whole',
        delta: percentDelta(k?.profitMonth, 'vs mês anterior'),
        detail: this.kpiDetail(k?.profitMonth, 'MRR real menos custos'),
        action: this.costAction(k?.profitMonth),
      },
      {
        key: 'mrrEstimated',
        label: 'MRR estimado',
        variant: 'white',
        value: k?.mrrEstimated.value ?? null,
        format: 'brl-cents-whole',
        delta: percentDelta(k?.mrrEstimated, startCaption(k?.mrrEstimated)),
        detail: this.kpiDetail(k?.mrrEstimated, 'preço de tabela'),
        action: null,
      },
      {
        key: 'arr',
        label: 'ARR',
        variant: 'white',
        value: k?.arr.value ?? null,
        format: 'brl-cents-whole',
        delta: percentDelta(k?.arr, startCaption(k?.arr)),
        detail: this.kpiDetail(k?.arr, 'MRR real × 12'),
        action: null,
      },
      {
        key: 'costs',
        label: 'Custos do mês',
        variant: 'white',
        value: k?.costsMonth.value ?? null,
        format: 'brl-cents-whole',
        delta: percentDelta(k?.costsMonth, 'vs mês anterior', true),
        detail: this.kpiDetail(
          k?.costsMonth,
          vendorsWithCost === null || vendorsWithCost === undefined
            ? 'lançados à mão'
            : `${vendorsWithCost} ${vendorsWithCost === 1 ? 'fornecedor' : 'fornecedores'} lançados`,
        ),
        action: this.costAction(k?.costsMonth),
      },
      {
        key: 'subs',
        label: 'Assinaturas ativas',
        variant: 'white',
        value: k?.activeSubscriptions.value ?? null,
        format: 'integer',
        delta: countDelta(k?.activeSubscriptions.parts['conversionsInPeriod'], 'conversões no período'),
        detail: this.kpiDetail(k?.activeSubscriptions, null),
        action: null,
      },
      {
        key: 'companies',
        label: 'Empresas',
        variant: 'white',
        value: k?.companies.value ?? null,
        format: 'integer',
        delta: countDelta(k?.companies.parts['newInPeriod'], 'novas no período'),
        detail: internal === null || internal === undefined ? null : `${internal} de teste`,
        action: null,
      },
      {
        key: 'users',
        label: 'Usuários',
        variant: 'white',
        value: k?.users.value ?? null,
        format: 'integer',
        delta: countDelta(k?.users.parts['newInPeriod'], 'novos no período'),
        detail: this.kpiDetail(k?.users, null),
        action: null,
      },
      {
        key: 'vehicles',
        label: 'Veículos',
        variant: 'white',
        value: k?.vehicles.value ?? null,
        format: 'integer',
        delta: countDelta(k?.vehicles.parts['newInPeriod'], 'cadastrados no período'),
        detail: this.kpiDetail(k?.vehicles, null),
        action: null,
      },
    ];
  });

  /** Valor gerenciado: esperado (por vencimento) e recebido (caixa), lado a lado. */
  protected readonly managed = computed(() => {
    const k = this.home()?.kpis;
    if (!k) return null;
    const e = k.managedExpected;
    const r = k.managedReceived;
    const share = e.value && r.value !== null ? Math.max(0, Math.min(1, r.value / e.value)) : null;
    return {
      // Compacto ("R$ 129,6k"): os dois valores dividem um cartão estreito e o número inteiro
      // quebrava no meio. O valor exato fica no title e no CSV.
      expected: e.value === null ? '—' : formatKpiNumber('brl-cents-compact', e.value),
      expectedFull: e.value === null ? null : formatKpiNumber('brl-cents-whole', e.value),
      expectedNote: e.value === null ? nullText(e, this.month()) : 'esperado, pelo vencimento',
      received: r.value === null ? '—' : formatKpiNumber('brl-cents-compact', r.value),
      receivedFull: r.value === null ? null : formatKpiNumber('brl-cents-whole', r.value),
      receivedNote: r.value === null ? nullText(r, this.month()) : 'recebido em caixa',
      delta: percentDelta(e, 'esperado vs mês anterior'),
      share,
      shareText: share === null ? null : formatKpiNumber('ratio', share),
      month: this.month() ? monthShort(this.month() as string) : '',
    };
  });

  // ---------------------------------------------------------------- gráficos

  private readonly mrrPoints = computed(() => this.home()?.mrrSeries.points ?? []);
  protected readonly mrrLabels = computed(() =>
    bucketLabels(
      this.mrrPoints().map((p) => p.start),
      this.home()?.meta.granularity ?? 'MONTH',
    ),
  );
  protected readonly mrrChart = computed<GrowthSeries[]>(() => [
    { key: 'real', label: 'MRR real', color: C.mrrReal, values: this.mrrPoints().map((p) => p.realCents) },
    {
      key: 'estimated',
      label: 'MRR estimado',
      color: C.mrrEstimated,
      values: this.mrrPoints().map((p) => p.estimatedCents),
      reference: true,
    },
  ]);
  protected readonly mrrNote = computed(() => {
    const s = this.home()?.mrrSeries;
    if (!s) return null;
    const parts = ['Ponto de hoje: agora; os outros: fim de cada intervalo.'];
    const real = dayLabel(s.realSince);
    const est = dayLabel(s.estimatedSince);
    if (real) parts.push(`Real desde ${real}.`);
    if (est) parts.push(`Estimado desde ${est}.`);
    return parts.join(' ');
  });

  protected readonly subsChart = computed<GrowthSeries[]>(() => [
    {
      key: 'subs',
      label: 'Assinantes ativos',
      color: C.subs,
      values: this.mrrPoints().map((p) => p.activeSubscriptions),
    },
  ]);
  protected readonly byPlan = computed(() => this.home()?.byPlan ?? []);

  private readonly profitMonths = computed(() => this.home()?.profitByMonth ?? []);
  protected readonly profitLabels = computed(() => monthLabels(this.profitMonths().map((m) => m.month)));
  protected readonly profitSeries = computed<BarSeries[]>(() => [
    { key: 'mrr', label: 'MRR', color: C.mrrReal, values: this.profitMonths().map((m) => m.mrrRealCents) },
    { key: 'costs', label: 'Custos', color: C.costs, values: this.profitMonths().map((m) => m.costsCents) },
    { key: 'profit', label: 'Lucro', color: C.profit, values: this.profitMonths().map((m) => m.profitCents) },
  ]);
  protected readonly anyCost = computed(() => this.profitMonths().some((m) => m.costsCents !== null));

  /** Cor de cada fornecedor pela posição na lista (estável entre os blocos). */
  private readonly vendorIndex = computed(
    () => new Map((this.home()?.costs.vendors ?? []).map((v, i) => [v.vendorId, i])),
  );
  private vendorName(id: string): string {
    return this.home()?.costs.vendors.find((v) => v.vendorId === id)?.name ?? 'Fornecedor';
  }

  protected readonly vendorSlices = computed<RingSlice[]>(() => {
    const h = this.home();
    if (!h) return [];
    const month = h.costs.months.find((m) => m.month === h.meta.currentMonth);
    return (month?.byVendor ?? []).map((row) => ({
      label: this.vendorName(row.vendorId),
      value: row.amountCents,
      color: vendorColor(this.vendorIndex().get(row.vendorId) ?? 0),
    }));
  });
  protected readonly currentMonthName = computed(() => (this.month() ? monthLong(this.month() as string) : 'no mês'));

  protected readonly costRows = computed<StackRow[]>(() => {
    const months = this.home()?.costs.months ?? [];
    const labels = monthLabels(months.map((m) => m.month));
    return months.map((m, i) => ({
      label: labels[i],
      segments: m.byVendor.map((row) => ({
        key: row.vendorId,
        label: this.vendorName(row.vendorId),
        value: row.amountCents,
        color: vendorColor(this.vendorIndex().get(row.vendorId) ?? 0),
      })),
    }));
  });
  protected readonly vendorNames = computed(() => (this.home()?.costs.vendors ?? []).map((v) => v.name).join(', '));

  private readonly managedPoints = computed(() => this.home()?.managedSeries.points ?? []);
  protected readonly managedLabels = computed(() =>
    bucketLabels(
      this.managedPoints().map((p) => p.start),
      this.home()?.meta.granularity ?? 'MONTH',
    ),
  );
  protected readonly managedChart = computed<GrowthSeries[]>(() => [
    { key: 'expected', label: 'Esperado', color: C.managedExpected, values: this.managedPoints().map((p) => p.expectedCents) },
    { key: 'received', label: 'Recebido', color: C.managedReceived, values: this.managedPoints().map((p) => p.receivedCents) },
  ]);
  protected readonly managedSince = computed(() => dayLabel(this.home()?.managedSeries.since ?? null));

  private readonly growthPoints = computed(() => this.home()?.growthSeries.points ?? []);
  protected readonly growthLabels = computed(() =>
    bucketLabels(
      this.growthPoints().map((p) => p.start),
      this.home()?.meta.granularity ?? 'MONTH',
    ),
  );
  protected readonly growthChart = computed<GrowthSeries[]>(() => [
    { key: 'users', label: 'Usuários', color: C.users, values: this.growthPoints().map((p) => p.newUsers) },
    { key: 'companies', label: 'Empresas', color: C.companies, values: this.growthPoints().map((p) => p.newCompanies) },
    { key: 'vehicles', label: 'Veículos', color: C.vehicles, values: this.growthPoints().map((p) => p.newVehicles) },
  ]);

  // ---------------------------------------------------------------- saúde e funil

  protected readonly health = computed<KpiView[]>(() => {
    const h = this.home()?.health;
    const parts = (kpi: HomeKpi | undefined, key: string) => kpi?.parts[key] ?? null;
    const churnText = () => {
      const c = parts(h?.churnMonthly, 'cancellations');
      const base = parts(h?.churnMonthly, 'payingAtStart');
      if (c === null) return null;
      return `${c} ${c === 1 ? 'cancelamento' : 'cancelamentos'}${base === null ? '' : ` de ${base} pagantes`} no mês`;
    };
    const retentionText = () => {
      const then = parts(h?.retention90d, 'payingThen');
      const still = parts(h?.retention90d, 'stillPaying');
      return then === null || still === null ? null : `${still} de ${then} seguem pagando`;
    };
    const brl = (cents: number) => formatKpiNumber('brl-cents-whole', cents);
    /** "R$ 1.108 ÷ 9 pagantes": numerador e denominador que o backend manda em `parts`. */
    const ratioText = (kpi: HomeKpi | undefined, num: string, den: string, one: string, many: string) => {
      const n = parts(kpi, num);
      const d = parts(kpi, den);
      return n === null || d === null ? null : `${brl(n)} ÷ ${d} ${d === 1 ? one : many}`;
    };
    const marginText = () => {
      const mrr = parts(h?.margin, 'mrrRealCents');
      const costs = parts(h?.margin, 'costsCents');
      return mrr === null || costs === null ? null : `custos de ${brl(costs)} sobre ${brl(mrr)}`;
    };
    /** Sem pagantes, a frase diz qual base faltou (início do mês, 90 dias atrás). */
    const noPaying = (kpi: HomeKpi | undefined, text: string) => (kpi?.nullReason === 'NO_PAYING' ? text : null);
    const neutral = (text: string | null): KpiDelta | null => (text ? { text, tone: 'neutral' } : null);
    const tile = (
      key: string,
      label: string,
      kpi: HomeKpi | undefined,
      format: KpiNumberFormat,
      extra: string | null = null,
      action: CostSheetIntent | null = null,
      nullOverride: string | null = null,
    ): KpiView => ({
      key,
      label,
      variant: 'white',
      value: kpi?.value ?? null,
      format,
      delta: kpi?.value === null ? null : neutral(extra),
      detail: kpi ? (kpi.value === null ? (nullOverride ?? nullText(kpi, this.month())) : kpi.definition) : null,
      action,
    });
    return [
      tile('churn', 'Churn mensal', h?.churnMonthly, 'ratio', churnText(), null,
        noPaying(h?.churnMonthly, 'ninguém pagava no início do mês')),
      tile('ltv', 'LTV', h?.ltv, 'brl-cents-whole'),
      tile('cac', 'CAC', h?.cac, 'brl-cents-whole',
        ratioText(h?.cac, 'acquisitionCents', 'newPaying', 'cliente novo', 'clientes novos'),
        this.costAction(h?.cac, 'acquisition')),
      tile('retention', 'Retenção em 90 dias', h?.retention90d, 'ratio', retentionText(), null,
        noPaying(h?.retention90d, 'ninguém pagava 90 dias atrás')),
      tile('arpa', 'Receita por cliente', h?.arpa, 'brl-cents-whole',
        ratioText(h?.arpa, 'mrrRealCents', 'payingCompanies', 'pagante', 'pagantes')),
      tile('margin', 'Margem', h?.margin, 'ratio', marginText(), this.costAction(h?.margin)),
    ];
  });

  protected readonly funnel = computed(() => {
    const f = this.home()?.funnel;
    if (!f) return null;
    const max = Math.max(1, f.signups, f.companiesCreated, f.inTrial, f.paying);
    const step = (key: string, label: string, n: number, fill: string): FunnelStep => ({
      key,
      label,
      n,
      pct: (n / max) * 100,
      fill,
    });
    return {
      steps: [
        step('signups', 'Cadastros', f.signups, 'bg-neutral-400'),
        step('companies', 'Criaram empresa', f.companiesCreated, 'bg-blue-400'),
        step('trial', 'Em teste grátis', f.inTrial, 'bg-amber-500'),
        step('paying', 'Assinam um plano', f.paying, 'bg-emerald-500'),
      ],
      rate: f.trialToPaidRate === null ? null : formatKpiNumber('ratio', f.trialToPaidRate),
      conversions: f.conversionsInPeriod,
      conversionsSince: dayLabel(f.conversionsSince),
      cohort: `${dayLabel(f.cohortFrom)} a ${dayLabel(f.cohortTo)}`,
    };
  });

  /** Início do feed de movimentações: o do período, até o teto de 365 dias do servidor. */
  // Sai do período escolhido, não do `meta.from` da resposta: esperar a resposta fazia o feed
  // pedir duas vezes (sem `from` enquanto carregava, depois com). Mesmas datas do servidor
  // (contrato §Conventions); "Desde o início" fica no teto.
  protected readonly movementsFrom = computed(() => {
    const today = todayInBusinessTz();
    const floor = minusDays(today, MOVEMENTS_MAX_DAYS);
    let from: string;
    switch (this.period()) {
      case '30d':
        from = minusDays(today, 29);
        break;
      case '90d':
        from = minusDays(today, 89);
        break;
      case '12m': {
        const [y, m] = today.split('-').map(Number);
        const first = new Date(Date.UTC(y, m - 1 - 11, 1));
        from = first.toISOString().slice(0, 10);
        break;
      }
      default:
        from = floor;
    }
    return from < floor ? floor : from;
  });

  protected readonly companiesInScope = computed(() => this.home()?.kpis.companies.value ?? null);

  // ---------------------------------------------------------------- cartões mantidos

  protected readonly onlineNow = computed(() => this.overview()?.users?.onlineNow ?? 0);

  protected readonly closedRentals = computed(() => {
    const r = this.overview()?.rentals;
    return { count: r?.closedTotal ?? 0, cents: r?.closedAmountCents ?? 0 };
  });

  protected readonly completedRentals = computed(() => {
    const r = this.overview()?.rentals;
    return { count: r?.completedTotal ?? 0, cents: r?.completedAmountCents ?? 0 };
  });

  protected readonly contractsTotal = computed(() => this.overview()?.contracts?.total ?? 0);
  /** SUBCONJUNTO de `contractsTotal` — nunca exibir como total de contratos. */
  protected readonly contractsSigned = computed(() => this.overview()?.contracts?.signedTotal ?? 0);

  protected readonly subscriptionBars = computed<StatusBar[]>(() =>
    bars(this.overview()?.subscriptions.byStatus ?? {}, SUB_STATUS_ORDER),
  );
  protected readonly feedbackBars = computed<StatusBar[]>(() =>
    bars(this.overview()?.feedback.byStatus ?? {}, FB_STATUS_ORDER),
  );
  /** `byStatus` é esparso: status sem registro some do mapa e vale zero. */
  protected readonly rentalBars = computed<StatusBar[]>(() =>
    bars(this.overview()?.rentals?.byStatus ?? {}, RENTAL_STATUS_ORDER),
  );
}

function bars(
  map: Record<string, number>,
  order: Array<{ key: string; label: string }>,
): StatusBar[] {
  const total = Object.values(map).reduce((sum, n) => sum + n, 0);
  return order.map((s) => {
    const count = map[s.key] ?? 0;
    return { key: s.key, label: s.label, count, color: STATUS_BAR_COLOR, percent: total > 0 ? (count / total) * 100 : 0 };
  });
}
