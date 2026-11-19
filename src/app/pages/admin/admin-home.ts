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
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { BarChart, type BarSeries } from '../../components/charts/bar-chart/bar-chart';
import {
  CHART_BLACK,
  CHART_GREEN,
  CHART_GREYS,
  CHART_ORANGE,
  chartSeriesColors,
} from '../../components/charts/chart-tooltip/chart-tooltip';
import { GrowthChart, type GrowthSeries } from '../../components/charts/growth-chart/growth-chart';
import { RingLegendCard, type RingSlice } from '../../components/charts/ring-legend-card/ring-legend-card';
import { StackedBarChart, type StackRow } from '../../components/charts/stacked-bar-chart/stacked-bar-chart';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { PageCard } from '../../components/core/page-card/page-card';
import {
  DateRangePicker,
  type DateRange,
  type DateRangePresetKey,
} from '../../components/date-range-picker/date-range-picker';
import { KpiCard, formatKpiNumber, type KpiCardVariant, type KpiDelta, type KpiNumberFormat } from '../../components/kpi-card/kpi-card';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { downloadCsv } from '../../components/lists/data-list/data-list-csv';
import { DataListMenuItem } from '../../components/lists/data-list/data-list-menu-item';
import { formatBrl } from '../../pipes/brl.pipe';
import { AdminCapabilitiesService } from '../../services/admin-capabilities.service';
import { AdminMetricsService } from '../../services/admin-metrics.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { AdminCompanyListItem } from '../../types/admin-company.types';
import type {
  AdminHome as AdminHomeData,
  AdminHomeRange,
  AdminHomeScope,
  AdminUsage,
  HomeKpi,
} from '../../types/admin-home.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { MONEY_AXIS_FLOOR_CENTS } from '../../utils/money-axis';
import { TRIAL_ENDING_CHIP_DAYS, trialEndingQueryParams } from './segments/segment-copy';
import { COSTS_ACTION_PARAM, COSTS_ROUTE, costsShortcutParams, type CostsShortcut } from './costs/costs-link';
import { AdminHomeService } from './home/admin-home.service';
import {
  bucketLabels,
  buildHomeCsv,
  clampRange,
  countDelta,
  dayLabel,
  monthLabels,
  monthLong,
  monthShort,
  movementsWindow,
  nullText,
  percentDelta,
  shortDay,
  valueDelta,
  vendorColors,
} from './home/admin-home.view';
import { COMPANY_CSV_COLUMNS, HomeCompanies } from './home/home-companies';
import { HomeMovements } from './home/home-movements';
import { HomeUpcoming } from './home/home-upcoming';
import { HomeActivityMap, HomeRoles, HomeTopUsers, HomeUfs } from './home/home-usage';
import { AdminRevenueSection } from './revenue/admin-revenue-section';

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

/**
 * As pílulas do período, as mesmas do dashboard do dono e na mesma ordem (regra do dono 18/11). O
 * admin lê "Mês atual" e "Este ano" até hoje (`periodEnd="today"` no template).
 */
export const ADMIN_PERIOD_PRESETS: readonly DateRangePresetKey[] = [
  'today',
  '7d',
  'monthCurrent',
  '30d',
  'monthPast',
  'year',
  'custom',
];

/**
 * Cores de dado: só as da marca (laranja, verde), preto e cinzas, todas como token (o preto e os
 * cinzas invertem no escuro). Laranja no dado principal (o MRR real, a série do cartão laranja),
 * verde no que é caixa ou lucro, preto no que sai ou no esperado, cinza na referência.
 */
const C = {
  mrrReal: CHART_ORANGE,
  mrrEstimated: CHART_GREYS[0],
  subs: CHART_GREEN,
  costs: CHART_BLACK,
  profit: CHART_GREEN,
  managedExpected: CHART_BLACK,
  managedReceived: CHART_GREEN,
} as const;

/** As etapas do funil: do cinza claro ao verde de quem paga (sem azul nem âmbar). */
const FUNNEL_FILL = {
  signups: 'bg-fg-faint',
  companies: 'bg-fg-muted',
  trial: 'bg-fg',
  paying: 'bg-success-500',
} as const;

interface KpiView {
  readonly key: string;
  readonly label: string;
  readonly variant: KpiCardVariant;
  readonly value: number | null;
  readonly format: KpiNumberFormat;
  readonly detail: string | null;
  readonly delta: KpiDelta | null;
  /** Card que vira atalho: leva à página de Custos, na folha do que falta. */
  readonly action: CostsShortcut | null;
  readonly wide?: boolean;
}

interface Chip {
  readonly key: string;
  readonly n: number;
  readonly label: string;
  readonly route: string;
  readonly queryParams?: Record<string, string>;
}

interface FunnelStep {
  readonly key: string;
  readonly label: string;
  readonly n: number;
  readonly pct: number;
  readonly fill: string;
}

interface Query {
  readonly range: AdminHomeRange;
  readonly scope: AdminHomeScope;
}

/** A chave de um pedido: a resposta só aparece sob as datas e o escopo que a pediram. */
function queryKey(range: AdminHomeRange, scope: AdminHomeScope): string {
  return `${range.from}|${range.to}|${scope}`;
}

/**
 * Visão geral do admin v2 (`/admin`), no desenho aprovado `Admin.dc.html`: receita real e
 * estimada, custos, lucro, crescimento, saúde do negócio, uso e movimentações. UM controle de
 * período para a tela inteira (as pílulas do dashboard do dono, com as datas sempre escritas
 * embaixo) e a caixinha "Incluir contas internas". Todo número vem do servidor (contrato
 * `2026-11-17_CONTRACT_admin-home.md`, `from`/`to` desde 18/11); `null` vira "sem dado" com o
 * motivo, nunca zero. O que não segue o período (saúde, chips, por plano, "Mais números") diz isso.
 *
 * Os cartões da Visão geral antiga que não estão no desenho continuam na página, refeitos no
 * padrão novo (decisão do dono, 17/11), em "Mais números da plataforma".
 */
@Component({
  selector: 'app-admin-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultPageLayout,
    ActionsMenu,
    DataListMenuItem,
    PageCard,
    RouterLink,
    DateRangePicker,
    AlertBanner,
    KpiCard,
    GrowthChart,
    BarChart,
    StackedBarChart,
    RingLegendCard,
    AdminRevenueSection,
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
  private readonly router = inject(Router);

  /** Só o Dono lança custo (`custo.gerir`); o servidor confere de novo. */
  protected readonly canManageCosts = computed(() => this.caps.can('custo.gerir'));

  protected readonly periodPresets = ADMIN_PERIOD_PRESETS;
  protected readonly axisFloor = MONEY_AXIS_FLOOR_CENTS;

  /** O período da tela, já dentro do que o servidor aceita. `null` até o seletor emitir o inicial. */
  protected readonly range = signal<AdminHomeRange | null>(null);
  protected readonly scope = signal<AdminHomeScope>('clients');
  protected readonly includeInternal = computed(() => this.scope() === 'all');
  private readonly key = computed(() => {
    const r = this.range();
    return r ? queryKey(r, this.scope()) : null;
  });

  // ---------------------------------------------------------------- dados v2

  private readonly homeRaw = signal<{ key: string; res: AdminHomeData } | null>(null);
  protected readonly homeLoading = signal(true);
  protected readonly homeError = signal<string | null>(null);
  private readonly usageRaw = signal<{ key: string; res: AdminUsage } | null>(null);
  protected readonly usageLoading = signal(true);
  protected readonly usageError = signal<string | null>(null);

  /** Só a resposta do período e escopo na tela: um número de um intervalo nunca aparece sob outro. */
  protected readonly home = computed(() => {
    const h = this.homeRaw();
    return h && h.key === this.key() ? h.res : null;
  });
  protected readonly usage = computed(() => {
    const u = this.usageRaw();
    return u && u.key === this.key() ? u.res : null;
  });
  protected readonly pending = computed(() => this.homeLoading() && !this.home());

  /**
   * As datas que o SERVIDOR usou, escritas embaixo das pílulas. `null` enquanto a resposta do
   * período novo não chega: o seletor mostra as datas que ele mesmo calculou.
   */
  protected readonly resolvedRange = computed(() => {
    const m = this.home()?.meta;
    return m ? { from: m.from, to: m.to } : null;
  });

  private readonly requests = new Subject<Query>();

  /** Linhas do "Cruzamento por empresa", para o Exportar. */
  private readonly companyRows = signal<readonly AdminCompanyListItem[]>([]);

  // ---------------------------------------------------------------- Custos

  /** "Lançar custo" no ⋮ do topo abre a página já na folha do avulso. O cartão de fornecedores vazio só avisa. */
  protected readonly launchCostParams = { [COSTS_ACTION_PARAM]: 'avulso' };

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
          const key = queryKey(q.range, q.scope);
          return this.homeService.home(q.range, q.scope).pipe(
            map((res) => ({ key, res, failure: null as unknown })),
            catchError((failure: unknown) => of({ key, res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ key, res, failure }) => {
        this.homeLoading.set(false);
        if (res) {
          this.homeRaw.set({ key, res });
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
          const key = queryKey(q.range, q.scope);
          return this.homeService.usage(q.range, q.scope).pipe(
            map((res) => ({ key, res, failure: null as unknown })),
            catchError((failure: unknown) => of({ key, res: null, failure })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ key, res, failure }) => {
        this.usageLoading.set(false);
        if (res) {
          this.usageRaw.set({ key, res });
          return;
        }
        this.apiErrors.claim(failure);
        this.usageError.set('Não foi possível carregar o uso da plataforma.');
      });

    effect(() => {
      const range = this.range();
      const scope = this.scope();
      if (range) this.requests.next({ range, scope });
    });
  }

  ngOnInit(): void {
    this.loadOverview();
    this.caps.ensureLoaded().subscribe();
  }

  /**
   * O seletor já conta em São Paulo e recusa data futura (`allowFuture=false`); `clampRange` fica
   * como guarda do contrato do servidor (fim até hoje, janela até `ADMIN_RANGE_MAX_DAYS`).
   */
  protected onRangeChange(range: DateRange): void {
    const next = clampRange(range, todayInBusinessTz());
    const current = this.range();
    if (current && current.from === next.from && current.to === next.to) return;
    this.range.set(next);
  }

  protected toggleInternal(event: Event): void {
    this.scope.set((event.target as HTMLInputElement).checked ? 'all' : 'clients');
  }

  protected reloadHome(): void {
    const range = this.range();
    if (range) this.requests.next({ range, scope: this.scope() });
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

  /** Atalho de um cartão sem custo: a página de Custos, na folha do que falta. */
  protected openCosts(shortcut: CostsShortcut): void {
    if (!this.canManageCosts()) return;
    void this.router.navigate([COSTS_ROUTE], { queryParams: costsShortcutParams(shortcut) });
  }

  /** ⋮ do topo › Lançar custo: a página de Custos, já na folha do avulso. */
  protected launchCost(): void {
    if (!this.canManageCosts()) return;
    void this.router.navigate([COSTS_ROUTE], { queryParams: this.launchCostParams });
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
    const c = this.home()?.chips ?? this.homeRaw()?.res.chips;
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
        label: plural(
          c.trialsEndingIn7Days,
          `trial vence em ${TRIAL_ENDING_CHIP_DAYS} dias`,
          `trials vencem em ${TRIAL_ENDING_CHIP_DAYS} dias`,
        ),
        // Empresas filtrada por "vence em 7 dias", quem vence primeiro no topo: o servidor conta o
        // chip e filtra a lista com a MESMA regra, então a lista mostra exatamente estas empresas.
        route: '/admin/companies',
        queryParams: trialEndingQueryParams(TRIAL_ENDING_CHIP_DAYS),
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

  /**
   * O mês dos cartões "do mês": o de `to` (`meta.referenceMonth`). Período que termina hoje = mês
   * corrente; período que terminou antes = o mês em que ele terminou, e o rótulo diz qual.
   */
  private readonly month = computed(() => {
    const m = this.home()?.meta;
    return m ? (m.referenceMonth ?? m.currentMonth) : null;
  });
  /** O período termina hoje (`meta.live`; servidor de antes de 18/11 não manda = ao vivo). */
  protected readonly live = computed(() => this.home()?.meta.live !== false);
  /**
   * O período é o mês corrente até hoje ("Mês atual"): do dia 1 até `to`, no mesmo mês. Só aí
   * "do mês" lê certo. Em "7 dias", "30 dias", "Este ano" ou um personalizado, o lucro e os custos
   * continuam sendo os do MÊS de `to` (o servidor não soma o período), então o rótulo nomeia o mês
   * para não parecer o total do período escolhido.
   */
  private readonly monthToDate = computed(() => {
    const m = this.home()?.meta;
    if (!m || !this.live()) return false;
    return m.from.slice(8, 10) === '01' && m.from.slice(0, 7) === m.to.slice(0, 7);
  });
  /** "do mês" (Mês atual), "de outubro" (Mês passado) ou "de novembro" (outro período). */
  private readonly monthWord = computed(() => {
    const m = this.month();
    return this.monthToDate() || !m ? 'do mês' : `de ${monthLong(m)}`;
  });

  private kpiDetail(kpi: HomeKpi | undefined, fallback: string | null): string | null {
    if (!kpi) return null;
    return kpi.value === null ? nullText(kpi, this.month()) : fallback;
  }

  /** Card nulo por falta de custo vira atalho para lançar (quem pode). */
  private costAction(kpi: HomeKpi | undefined, intent: CostsShortcut = 'cost'): CostsShortcut | null {
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
        format: 'brl-cents',
        delta: percentDelta(k?.mrrReal, startCaption(k?.mrrReal)),
        detail: mrrRealDetail(),
        action: null,
        wide: true,
      },
      {
        key: 'profit',
        label: `Lucro ${this.monthWord()}`,
        variant: 'emerald-dark',
        value: k?.profitMonth.value ?? null,
        format: 'brl-cents',
        delta: percentDelta(k?.profitMonth, 'vs mês anterior'),
        detail: this.kpiDetail(k?.profitMonth, 'MRR real menos custos'),
        action: this.costAction(k?.profitMonth),
      },
      {
        key: 'mrrEstimated',
        label: 'MRR estimado',
        variant: 'white',
        value: k?.mrrEstimated.value ?? null,
        format: 'brl-cents',
        delta: percentDelta(k?.mrrEstimated, startCaption(k?.mrrEstimated)),
        detail: this.kpiDetail(k?.mrrEstimated, 'preço de tabela'),
        action: null,
      },
      {
        key: 'arr',
        label: 'ARR',
        variant: 'white',
        value: k?.arr.value ?? null,
        format: 'brl-cents',
        delta: percentDelta(k?.arr, startCaption(k?.arr)),
        detail: this.kpiDetail(k?.arr, 'MRR real × 12'),
        action: null,
      },
      {
        key: 'costs',
        label: `Custos ${this.monthWord()}`,
        variant: 'white',
        value: k?.costsMonth.value ?? null,
        format: 'brl-cents',
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
        // Período que já terminou: o servidor conta quem está ativo HOJE entre os cadastrados até o
        // fim dele (não há histórico de desativação). O cartão diz, para o número não parecer foto.
        detail: this.kpiDetail(k?.users, this.live() ? null : 'ativos hoje, cadastrados até o fim do período'),
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

  /**
   * Valor gerenciado do mês: o cartão verde pintado (`app-kpi-card` emerald) com o RECEBIDO em
   * caixa e, embaixo, o esperado pelo vencimento e quanto dele já entrou. Os dois com centavos, sem
   * abreviar (antes o cartão mostrava "R$ 120,4k" e escondia o valor cheio no `title`).
   */
  protected readonly managed = computed(() => {
    const k = this.home()?.kpis;
    if (!k) return null;
    const e = k.managedExpected;
    const r = k.managedReceived;
    const share = e.value && r.value !== null ? Math.max(0, Math.min(1, r.value / e.value)) : null;
    const month = this.month();
    const expected =
      e.value === null
        ? `esperado: ${nullText(e, month)}`
        : `de ${formatBrl(e.value)} esperados pelo vencimento` +
          (share === null ? '' : ` (${formatKpiNumber('ratio', share)} já entrou)`);
    return {
      label: this.monthToDate() || !month ? 'Gerenciado no mês' : `Gerenciado em ${monthShort(month)}`,
      value: r.value,
      detail: r.value === null ? nullText(r, month) : `recebido em caixa, ${expected}`,
      delta: valueDelta(r.value, r.previous, 'vs mês anterior'),
      share,
    };
  });

  // ---------------------------------------------------------------- gráficos

  private readonly granularity = computed(() => this.home()?.meta.bucket ?? this.home()?.meta.granularity ?? 'MONTH');

  private readonly mrrPoints = computed(() => this.home()?.mrrSeries.points ?? []);
  protected readonly mrrLabels = computed(() =>
    bucketLabels(
      this.mrrPoints().map((p) => p.start),
      this.granularity(),
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
    const parts = [
      this.live() ? 'Ponto de hoje: agora; os outros: fim de cada intervalo.' : 'Cada ponto: o fim do intervalo.',
    ];
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

  /** Cor de cada fornecedor, a mesma no anel e nas colunas (`vendorColors`). */
  private readonly vendorColorMap = computed(() => vendorColors(this.home()));
  private vendorColor(id: string): string {
    return this.vendorColorMap().get(id) ?? CHART_GREYS[0];
  }
  private vendorName(id: string): string {
    return this.home()?.costs.vendors.find((v) => v.vendorId === id)?.name ?? 'Fornecedor';
  }

  /** O anel é do mês dos cartões (o de `to`). */
  protected readonly vendorSlices = computed<RingSlice[]>(() => {
    const h = this.home();
    if (!h) return [];
    const ref = this.month();
    const month = h.costs.months.find((m) => m.month === ref);
    return (month?.byVendor ?? []).map((row) => ({
      label: this.vendorName(row.vendorId),
      value: row.amountCents,
      color: this.vendorColor(row.vendorId),
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
        color: this.vendorColor(row.vendorId),
      })),
    }));
  });
  protected readonly vendorNames = computed(() => (this.home()?.costs.vendors ?? []).map((v) => v.name).join(', '));

  private readonly managedPoints = computed(() => this.home()?.managedSeries.points ?? []);
  protected readonly managedLabels = computed(() =>
    bucketLabels(
      this.managedPoints().map((p) => p.start),
      this.granularity(),
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
      this.granularity(),
    ),
  );
  /** Três séries: laranja, verde e preto, na ordem (`chartSeriesColors`). */
  protected readonly growthChart = computed<GrowthSeries[]>(() => {
    const points = this.growthPoints();
    const series = [
      { key: 'users', label: 'Usuários', values: points.map((p) => p.newUsers) },
      { key: 'companies', label: 'Empresas', values: points.map((p) => p.newCompanies) },
      { key: 'vehicles', label: 'Veículos', values: points.map((p) => p.newVehicles) },
    ];
    const colors = chartSeriesColors(series.map((x) => x.values.reduce((t, v) => t + v, 0)));
    return series.map((x, i) => ({ ...x, color: colors[i] }));
  });

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
    /** "R$ 1.108,00 ÷ 9 pagantes": numerador e denominador que o backend manda em `parts`. */
    const ratioText = (kpi: HomeKpi | undefined, num: string, den: string, one: string, many: string) => {
      const n = parts(kpi, num);
      const d = parts(kpi, den);
      return n === null || d === null ? null : `${formatBrl(n)} ÷ ${d} ${d === 1 ? one : many}`;
    };
    const marginText = () => {
      const mrr = parts(h?.margin, 'mrrRealCents');
      const costs = parts(h?.margin, 'costsCents');
      return mrr === null || costs === null ? null : `custos de ${formatBrl(costs)} sobre ${formatBrl(mrr)}`;
    };
    /** Sem pagantes, a frase diz qual base faltou (início do mês, 90 dias atrás). */
    const noPaying = (kpi: HomeKpi | undefined, text: string) => (kpi?.nullReason === 'NO_PAYING' ? text : null);
    const neutral = (text: string | null): KpiDelta | null => (text ? { text, tone: 'neutral' } : null);
    // Saúde é sempre de hoje (contrato `changed:` 18/11): o mês é o corrente, não o do período.
    const currentMonth = this.home()?.meta.currentMonth ?? null;
    const tile = (
      key: string,
      label: string,
      kpi: HomeKpi | undefined,
      format: KpiNumberFormat,
      extra: string | null = null,
      action: CostsShortcut | null = null,
      nullOverride: string | null = null,
    ): KpiView => ({
      key,
      label,
      variant: 'white',
      value: kpi?.value ?? null,
      format,
      delta: kpi?.value === null ? null : neutral(extra),
      detail: kpi ? (kpi.value === null ? (nullOverride ?? nullText(kpi, currentMonth)) : kpi.definition) : null,
      action,
    });
    return [
      tile('churn', 'Churn mensal', h?.churnMonthly, 'ratio', churnText(), null,
        noPaying(h?.churnMonthly, 'ninguém pagava no início do mês')),
      tile('ltv', 'LTV', h?.ltv, 'brl-cents'),
      tile('cac', 'CAC', h?.cac, 'brl-cents',
        ratioText(h?.cac, 'acquisitionCents', 'newPaying', 'cliente novo', 'clientes novos'),
        this.costAction(h?.cac, 'acquisition')),
      tile('retention', 'Retenção em 90 dias', h?.retention90d, 'ratio', retentionText(), null,
        noPaying(h?.retention90d, 'ninguém pagava 90 dias atrás')),
      tile('arpa', 'Receita por cliente', h?.arpa, 'brl-cents',
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
        step('signups', 'Cadastros', f.signups, FUNNEL_FILL.signups),
        step('companies', 'Criaram empresa', f.companiesCreated, FUNNEL_FILL.companies),
        step('trial', 'Em teste grátis', f.inTrial, FUNNEL_FILL.trial),
        step('paying', 'Assinam um plano', f.paying, FUNNEL_FILL.paying),
      ],
      rate: f.trialToPaidRate === null ? null : formatKpiNumber('ratio', f.trialToPaidRate),
      conversions: f.conversionsInPeriod,
      conversionsSince: dayLabel(f.conversionsSince),
      cohort: `${dayLabel(f.cohortFrom)} a ${dayLabel(f.cohortTo)}`,
    };
  });

  /** A janela do feed de movimentações: o período da tela, até os 366 dias que o servidor aceita. */
  protected readonly movementsRange = computed(() => {
    const r = this.range();
    return r ? movementsWindow(r) : null;
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

  protected readonly subscriptionSlices = computed<RingSlice[]>(() =>
    statusSlices(this.overview()?.subscriptions.byStatus ?? {}, SUB_STATUS_ORDER),
  );
  protected readonly feedbackSlices = computed<RingSlice[]>(() =>
    statusSlices(this.overview()?.feedback.byStatus ?? {}, FB_STATUS_ORDER),
  );
  /** `byStatus` é esparso: status sem registro some do mapa e vale zero. */
  protected readonly rentalSlices = computed<RingSlice[]>(() =>
    statusSlices(this.overview()?.rentals?.byStatus ?? {}, RENTAL_STATUS_ORDER),
  );
}

/**
 * Pure: uma fatia por status, na ordem fixa; status ausente do mapa esparso vale zero. Cores da
 * marca por `chartSeriesColors` (até 4: laranja, verde, preto, cinza; mais de 4: o maior laranja,
 * o segundo verde, o resto cinza).
 */
export function statusSlices(
  counts: Record<string, number>,
  order: ReadonlyArray<{ key: string; label: string }>,
): RingSlice[] {
  const values = order.map((s) => counts[s.key] ?? 0);
  const colors = chartSeriesColors(values);
  return order.map((s, i) => ({ label: s.label, value: values[i], color: colors[i] }));
}
