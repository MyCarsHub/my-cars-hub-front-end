import { DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { KpiCard, KpiDelta } from '../../components/kpi-card/kpi-card';
import { ExpenseBreakdown } from '../../components/expense-breakdown/expense-breakdown';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { SessionService } from '../../services/session.service';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { CardSkeleton } from './components/card-skeleton';
import { PageCard } from '../../components/core/page-card/page-card';
import { DashboardService } from '../../services/dashboard.service';
import {
    CashflowEventDto,
    DashboardSummaryDto,
    MonthlyResultDto,
    formatBRL,
    formatBRLWhole,
} from '../../types/dashboard.types';
import { DateRange, DateRangePicker, DateRangePresetKey } from '../../components/date-range-picker/date-range-picker';
import { AlertChip } from './components/alert-chip';
import { FailedChargeNotices } from './components/failed-charge-notices';
import { MonthlyResultChart, shortBrl } from './components/monthly-result-chart';
import { OffenderRow } from './components/top-offenders-table';
import { FinancialCalendar } from './components/financial-calendar';
import { CashflowDaySheet } from './components/cashflow-day-sheet';
import { CashAccumulationResponse } from '../../types/cash-accumulation.types';
import { cashAccumulationView, monthName } from '../../utils/cash-accumulation-view';
import { MONEY_AXIS_FLOOR_CENTS } from '../../utils/money-axis';
import { GrowthChart, GrowthSeries, GrowthXTick } from '../../components/charts/growth-chart/growth-chart';
import { RingLegendCard, RingSlice } from '../../components/charts/ring-legend-card/ring-legend-card';
import { RankingCard, RankingItem } from '../../components/charts/ranking-card/ranking-card';
import { PillTabs, PillTabOption } from '../../components/core/pill-tabs/pill-tabs';
import { DetailDialog } from '../../components/core/detail-dialog/detail-dialog';
import { QuickActionCard } from './components/quick-action-card';

/** Delta comparativo entre janela atual e imediatamente anterior. */
export interface DeltaInfo {
    /** "+12,3%" ou "-8,0%"; null quando não há base de comparação. */
    label: string | null;
    direction: 'up' | 'down' | 'flat';
}

interface StatusMeta {
    label: string;
    color: string;
}

const RENTAL_STATUS_META: Record<string, StatusMeta> = {
    RESERVED: { label: 'Reservados', color: '#3b82f6' },
    ACTIVE: { label: 'Ativos', color: '#0a9b62' },
    COMPLETED: { label: 'Concluídos', color: '#9aa3b2' },
    CANCELED: { label: 'Cancelados', color: '#fb7185' },
};

const VEHICLE_STATUS_META: Record<string, StatusMeta> = {
    AVAILABLE: { label: 'Disponíveis', color: '#34d399' },
    RENTED: { label: 'Alugados', color: '#F63B04' },
    MAINTENANCE: { label: 'Manutenção', color: '#3b82f6' },
    INACTIVE: { label: 'Inativos', color: '#9aa3b2' },
};

const COST_CATEGORY_META: Record<string, StatusMeta> = {
    MAINTENANCE: { label: 'Manutenção', color: '#3b82f6' },
    FINES: { label: 'Multas', color: '#9aa3b2' },
    IPVA: { label: 'IPVA', color: '#ec4899' },
    INSURANCE: { label: 'Seguro', color: '#f59e0b' },
    FINANCING: { label: 'Financiamento', color: '#8b5cf6' },
};

const MONTH_LONG = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** `2026-06` -> `junho de 2026`. */
function monthLong(key: string): string {
    const [y, m] = key.split('-');
    return `${MONTH_LONG[Number(m) - 1] ?? m} de ${y}`;
}

/**
 * Dashboard MVP — foco em ações financeiras diárias.
 *
 * <h4>Blocos</h4>
 * Alerts, Fleet KPIs, Filtro/DateRange, Faturamento (4 cards + gráfico 6 meses),
 * Calendário Financeiro, Distribuições (aluguéis/veículos por status),
 * Top 5 por receita (veículos/motoristas), Top ofensores,
 * "Quanto já entrou no mês" (curva acumulada de caixa), Ações rápidas.
 */
@Component({
    selector: 'app-dashboard-home',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DefaultPageLayout,
        PageCard,
        DateRangePicker,
        AlertChip,
        FailedChargeNotices,
        MonthlyResultChart,
        FinancialCalendar,
        CashflowDaySheet,
        GrowthChart,
        RingLegendCard,
        RankingCard,
        PillTabs,
        DetailDialog,
        QuickActionCard,
        AlertBanner,
        RouterLink,
        KpiCard,
        ExpenseBreakdown,
        CardSkeleton,
    ],
    templateUrl: './dashboard-home.html',
})
export class DashboardHome {
    private readonly service = inject(DashboardService);
    private readonly router = inject(Router);
    private readonly doc = inject(DOCUMENT);
    private readonly activation = inject(FleetActivationService);

    private readonly session = inject(SessionService);

    /**
     * FEAT-0080 — lembrete persistente pós-pulo: quem pulou o gate cai aqui e
     * precisa continuar vendo o convite enquanto a frota estiver vazia. Convite,
     * não alarme (variant info); some sozinho após o primeiro cadastro porque o
     * cache do FleetActivationService vira `true` no POST de criação. Erro na
     * consulta só omite o banner — nunca quebra o dashboard.
     *
     * MESMAS exclusões do `firstVehicleGuard`: DRIVER/VIEWER não podem receber
     * um convite para rota que o roleGuard de /veiculos bloqueia, e
     * PLATFORM_ADMIN opera acima do modelo de tenant. Fora do papel certo,
     * nem a consulta é feita — sem GET extra a cada dashboard.
     */
    protected readonly showActivationReminder = signal(false);

    /**
     * FEAT-0123 — curva acumulada do dinheiro RECEBIDO no mês.
     *
     * Carregada em paralelo com o resumo: é outro endpoint e outra pergunta
     * ("já se paga?" é do ROI; esta é "estou na frente do mês passado?").
     * Falha aqui não derruba o dashboard — o cartão simplesmente não aparece,
     * porque um cartão de dinheiro sem dado não tem o que dizer.
     */
    protected readonly cashAccumulation = signal<CashAccumulationResponse | null>(null);

    /** View of the cash curve: total, comparison sentence and both curves. */
    protected readonly cashView = computed(() => {
        const response = this.cashAccumulation();
        return response ? cashAccumulationView(response) : null;
    });

    protected readonly cashMonthLabel = computed(() => {
        const response = this.cashAccumulation();
        return response ? monthName(response.current.month) : '';
    });

    /** Money axis floor (R$ 100,00 in cents): an empty month gets a real 0..R$ 100 axis, not R$ 0,05. */
    protected readonly cashAxisFloor = MONEY_AXIS_FLOOR_CENTS;

    /**
     * Both curves live on the FULL month axis (the longer of the two months): this month is drawn
     * solid up to today, last month dashed to its last day, so the owner sees where last month
     * ended and not only how it started.
     */
    protected readonly cashLabels = computed(() => {
        const days = this.cashView()?.axisDays ?? 0;
        return Array.from({ length: days }, (_, i) => String(i + 1));
    });

    /** x marks "dia 1, 5, 10, ..." (only the first carries the word) (only the days that exist in the month axis). */
    protected readonly cashXTicks = computed<GrowthXTick[]>(() => {
        const days = this.cashView()?.axisDays ?? 0;
        return [1, 5, 10, 15, 20, 25, 30]
            .filter((d) => d <= days)
            .map((d) => ({ index: d - 1, text: d === 1 ? 'dia 1' : String(d) }));
    });

    /** Chip of the cash card: ahead of / behind last month ON THE SAME DAY; null without a base. */
    protected readonly cashLead = computed(() => {
        const r = this.cashAccumulation();
        if (!r || !(r.previousSameDayCents > 0)) return null;
        const pct = Math.round((r.deltaCents / r.previousSameDayCents) * 100);
        return { up: pct >= 0, text: `${pct >= 0 ? '↗' : '↘'} ${Math.abs(pct)}% ${pct >= 0 ? 'à frente' : 'atrás'}` };
    });

    protected readonly cashSeries = computed<GrowthSeries[]>(() => {
        const view = this.cashView();
        if (!view) return [];
        return [
            {
                key: 'previous',
                label: 'Mês passado',
                color: '#a3a3a3',
                reference: true,
                values: view.previous.points.map((p) => p.cents),
            },
            {
                key: 'current',
                label: 'Este mês',
                color: '#F63B04',
                values: view.current.points.map((p) => p.cents),
            },
        ];
    });

    /**
     * OPERADOR da empresa: quem o `roleGuard` aceita nas rotas de frota
     * (`/alugueis`, `/veiculos`, `/manutencoes`, `/multas`, `/seguros`,
     * `/motoristas` — todas `roleGuard(['OWNER', 'MANAGER'])`).
     *
     * FEAT-0146 — vem do TOKEN, a MESMA fonte do guard. Antes vinha do espelho
     * `selectedRole` do `sessionStorage`, que é editável por DevTools e fica
     * com o papel da empresa ANTERIOR até a troca confirmar. Decidir poder por
     * uma fonte que o guard não consulta é como o menu oferecia o que o guard
     * recusava — e aqui o `roleGuard` REDIRECIONA para `/dashboard`, então o
     * motorista tocaria, a tela recarregaria nela mesma e nada explicaria.
     *
     * É o mesmo predicado para as três superfícies desta tela (ações rápidas,
     * chips de alerta e ROI): uma resposta só para "esta pessoa entra nas
     * rotas de frota?" em vez de três checagens que podem divergir.
     */
    protected readonly isOperator = computed(() => {
        const role = this.session.getCompanyRoleFromToken();
        return role === 'OWNER' || role === 'MANAGER';
    });

    constructor() {
        const eligible = !this.session.isPlatformAdmin() && this.isOperator();

        /**
         * FEAT-0103 — o ROI por veiculo e OPERADOR: o backend responde 403 para
         * DRIVER (`RoleGuard.assertOperatorRole`, rota fora da allow-list do
         * `DriverReadScopePolicy`). Reuso a MESMA leitura de papel que o lembrete
         * de ativacao acima ja faz, em vez de inventar checagem nova: fora do
         * papel certo nem o GET sai, entao o motorista nao gera um 403 por
         * dashboard aberto.
         */
        this.service
            .loadCashAccumulation()
            .pipe(takeUntilDestroyed())
            .subscribe({
                next: (res) => {
                    this.cashAccumulation.set(res);
                    this.cashPending.set(false);
                },
                error: () => {
                    this.cashAccumulation.set(null);
                    this.cashPending.set(false);
                },
            });

        if (eligible) {
            this.activation
                .hasVehicles()
                .pipe(takeUntilDestroyed())
                .subscribe({
                    next: (has) => this.showActivationReminder.set(!has),
                    error: () => this.showActivationReminder.set(false),
                });
        }
    }

    /** Period pills of the prototype (no "Próximos" projections here). */
    protected readonly periodPresets: readonly DateRangePresetKey[] = [
        'today', '7d', 'monthCurrent', '30d', 'monthPast', 'year', 'custom',
    ];

    protected readonly summary = signal<DashboardSummaryDto | null>(null);
    protected readonly loading = signal(false);
    protected readonly error = signal<string | null>(null);

    /** No summary yet and no failure: every board card shows a placeholder in its own slot. */
    protected readonly pending = computed(() => !this.summary() && !this.error());

    /** The cash curve is its own request: its slot is held until it answers (or fails). */
    protected readonly cashPending = signal(true);

    /** Currently applied range — used on reload after failure. */
    private readonly currentRange = signal<DateRange | null>(null);

    protected readonly offenderMode = signal<'vehicles' | 'drivers'>('vehicles');
    protected readonly offenderModeOptions: PillTabOption<'vehicles' | 'drivers'>[] = [
        { value: 'vehicles', label: 'Veículos' },
        { value: 'drivers', label: 'Motoristas' },
    ];

    /** Currently selected day in the calendar — drives the detail sheet. */
    protected readonly selectedDay = signal<string | null>(null);

    // ---- Alerts ---------------------------------------------------------
    protected readonly showAlerts = computed(() => {
        const a = this.summary()?.alerts;
        if (!a) return false;
        /**
         * FEAT-0146 — para quem não é operador, TODO chip desta faixa leva a uma
         * rota de `roleGuard`, então a faixa inteira sai. Deixá-la abrir
         * renderizaria uma seção VAZIA na tela — um buraco no lugar de um alerta.
         *
         * DÍVIDA TÉCNICA, NÃO REGRA DE PRODUTO (FEAT-0108, 2026-09-25).
         *
         * O dono decidiu o contrário do que este código faz: o motorista DEVE
         * ver os alertas de CNH e dos documentos DELE. O que impede é o backend,
         * não o produto — `DocumentAlertService.listDocumentAlerts` recorta só
         * por EMPRESA (`requireTenant()` → `findDocumentAlerts(companyId, …)`) e
         * não tem recorte por motorista. Abrir `/alertas` ao DRIVER hoje faria
         * cada motorista ver a CNH de todos os outros e o CRLV de toda a frota:
         * vazamento de tenant, não lacuna de escopo.
         *
         * Abrir a rota NÃO é recortar o dado. O FEAT-0178 é o nó que dá escopo
         * por motorista ao endpoint de alertas; ele remove esta trava, o
         * `isOperator()` do chip em `dashboard-home.html` e o `roleGuard` de
         * `/alertas`. Até ele existir, esconder é o comportamento correto.
         */
        if (!this.isOperator()) return false;
        return (
            a.openFines.count > 0 ||
            a.openMaintenances.count > 0 ||
            a.expiringCnh30d.count > 0 ||
            a.expiringLicensing30d.count > 0 ||
            a.reservedRentals.count > 0 ||
            // Campos aditivos: `?.` protege contra um backend mais antigo que
            // ainda não os envia — o dashboard inteiro não pode quebrar por isso.
            (a.overdueCharges?.count ?? 0) > 0 ||
            (a.failedCharges?.count ?? 0) > 0 ||
            (a.docsExpiring7d?.count ?? 0) > 0 ||
            (a.expiringInsurance30d?.count ?? 0) > 0 ||
            (a.ipva?.count ?? 0) > 0
        );
    });

    // ---- Fleet ----------------------------------------------------------

    /*
     * NÃO existe legenda de capacidade no card de motoristas (FEAT-0070).
     *
     * Havia um `driverPlanLabel` com "X de Y do plano" / "motoristas ilimitados
     * no plano". O teto virou guarda-corpo interno, o backend removeu
     * `driverLimit` do `FleetDto` e a legenda saiu junto — o card mostra o
     * total e quantos estão ativos, que é operação, não capacidade. O card de
     * VEÍCULOS mantém a sua (`vehiclePlanLabel`): esse eixo continua comercial.
     */

    // ---- Faturamento — deltas vs período anterior + monthly ------------
    protected readonly billingLabel = computed(() =>
        formatBRL(this.summary()?.finance?.revenueCents ?? 0),
    );

    protected readonly receivedLabel = computed(() =>
        formatBRL(this.summary()?.finance?.receivedCents ?? 0),
    );

    protected readonly pendingChargesLabel = computed(() =>
        formatBRL(this.summary()?.finance?.pendingChargesCents ?? 0),
    );

    protected readonly overdueChargesLabel = computed(() =>
        formatBRL(this.summary()?.finance?.overdueChargesCents ?? 0),
    );

    protected readonly billingDelta = computed<DeltaInfo>(() => {
        const f = this.summary()?.finance;
        return this.formatDelta(f?.revenueCents ?? 0, f?.previousRevenueCents ?? 0);
    });

    protected readonly receivedDelta = computed<DeltaInfo>(() => {
        const f = this.summary()?.finance;
        return this.formatDelta(f?.receivedCents ?? 0, f?.previousReceivedCents ?? 0);
    });

    /** Delta as the KPI card wants it: a tinted chip (`↗ 8%`) plus a caption; `null` with no base to compare. */
    private kpiDelta(d: DeltaInfo, caption: string): KpiDelta | null {
        if (!d.label) return null;
        const arrow = d.direction === 'up' ? '↗ ' : d.direction === 'down' ? '↘ ' : '';
        const tone = d.direction === 'up' ? 'good' : d.direction === 'down' ? 'bad' : 'neutral';
        return { chip: `${arrow}${d.label.replace(/^[+-]/, '')}`, text: caption, tone };
    }

    /**
     * Caption of a delta. The backend compares with the period of the same length right before; when
     * the range is a whole calendar month that period is the previous month, so say so.
     */
    protected readonly comparisonCaption = computed(() => {
        const r = this.currentRange();
        if (r && /^\d{4}-\d{2}-01$/.test(r.from)) {
            const [y, m] = r.from.split('-').map(Number);
            const last = new Date(y, m, 0).getDate();
            if (r.to === `${r.from.slice(0, 8)}${String(last).padStart(2, '0')}`) return 'vs mês passado';
        }
        return 'vs período anterior';
    });

    protected readonly billingKpiDelta = computed(() =>
        this.kpiDelta(this.billingDelta(), this.comparisonCaption()),
    );

    /** Share of the billed amount already received (`90% do faturado`), the caption of the received card. */
    protected readonly receivedShareLabel = computed(() => {
        const f = this.summary()?.finance;
        if (!f || !(f.revenueCents > 0)) return null;
        return `${Math.round((f.receivedCents / f.revenueCents) * 100)}% do faturado`;
    });

    protected readonly receivedKpiDelta = computed(() =>
        this.kpiDelta(this.receivedDelta(), this.receivedShareLabel() ?? this.comparisonCaption()),
    );

    /** `margem 40%` of the result over the billed amount; the plain caption when nothing was billed. */
    protected readonly marginDetail = computed(() => {
        const f = this.summary()?.finance;
        if (!f) return null;
        if (!(f.revenueCents > 0)) return 'receita menos despesas';
        return `margem ${Math.round((f.resultCents / f.revenueCents) * 100)}%`;
    });

    /** Overdue card caption: how many charges are behind it (`3 cobranças`), else the plain caption. */
    protected readonly overdueDetailLabel = computed(() => {
        const f = this.summary()?.finance;
        if (!f) return null;
        const n = this.summary()?.alerts?.overdueCharges?.count ?? 0;
        return n > 0 ? `${n} ${n === 1 ? 'cobrança' : 'cobranças'}` : 'cobranças vencidas ou falhas';
    });

    /** "Olá, Lorran": first name from the session; plain "Olá" when the session has none. */
    protected readonly greeting = computed(() => {
        const first = this.session.getItem('name')?.trim().split(/\s+/)[0];
        return first ? `Olá, ${first}` : 'Olá';
    });

    // ---- Venda de veículos (FEAT-0074) -----------------------------------

    /**
     * Receita BRUTA de venda no período — categoria PONTUAL, própria.
     *
     * Decisão do usuário (FIX-0257): o card mostra a ENTRADA DE CAIXA do mês,
     * pelo valor bruto. Fica ao lado do faturamento, nunca somada nele.
     */
    protected readonly saleRevenueCents = computed(
        () => this.summary()?.finance?.saleRevenueCents ?? 0,
    );

    /**
     * LIMITAÇÃO DE CONTRATO CONHECIDA: `saleRevenueCents` é uma SOMA e o
     * `FinanceDto` não traz nem `null` nem contagem de vendas. Logo uma venda
     * registrada por R$ 0 na janela é indistinguível de "não houve venda" e
     * fica invisível neste card. Não é defeito desta tela — o dado não existe;
     * a correção depende de o backend expor contagem (ou nulidade). Já
     * registrado como proposta de nó do backend.
     */
    protected readonly hasSaleRevenue = computed(() => this.saleRevenueCents() > 0);

    protected readonly saleRevenueLabel = computed(() => formatBRL(this.saleRevenueCents()));

    // ---- Cashflow (calendar) ---------------------------------------------
    // Kept separate from the filtered `summary` so the calendar always shows
    // every entry/exit for the visible month, regardless of the chart filters.
    protected readonly calendarCashflow = signal<CashflowEventDto[]>([]);

    /** Month currently displayed by the calendar (`YYYY-MM`). */
    private readonly calendarMonth = signal<string | null>(null);

    protected readonly selectedDayEvents = computed<CashflowEventDto[]>(() => {
        const iso = this.selectedDay();
        if (!iso) return [];
        return this.calendarCashflow().filter((e) => e.date === iso);
    });

    // ---- Distributions --------------------------------------------------
    protected readonly rentalsByStatusSlices = computed<RingSlice[]>(() =>
        this.mapStatusSlices(this.summary()?.distributions?.rentalsByStatus ?? [], RENTAL_STATUS_META),
    );

    protected readonly vehiclesByStatusSlices = computed<RingSlice[]>(() =>
        this.mapStatusSlices(this.summary()?.distributions?.vehiclesByStatus ?? [], VEHICLE_STATUS_META),
    );

    // ---- Overview (FEAT-0467 / FEAT-0468) -------------------------------
    // Everything below is hidden when the backend does not send `overview`:
    // no zero is ever drawn in place of a number the screen does not have.
    protected readonly overview = computed(() => this.summary()?.overview ?? null);

    protected readonly monthlyResultMonths = computed<MonthlyResultDto[]>(
        () => this.overview()?.monthlyResult ?? [],
    );

    protected readonly hasResult = computed(() => this.monthlyResultMonths().length > 0);

    /** Month tapped on the bars; the sheet with its numbers opens on tap. */
    protected readonly resultMonth = signal<string | null>(null);
    protected readonly resultDetailOpen = signal(false);

    protected readonly resultDetail = computed(() => {
        const key = this.resultMonth();
        const m = this.monthlyResultMonths().find((r) => r.month === key);
        return m ? { ...m, title: monthLong(m.month) } : null;
    });

    protected onResultMonth(key: string): void {
        this.resultMonth.set(key);
        this.resultDetailOpen.set(true);
    }

    protected onResultDetailClosed(): void {
        this.resultDetailOpen.set(false);
    }

    /** Where each real received goes: what is left (profit) first, then each cost category. */
    protected readonly costSlices = computed<RingSlice[]>(() => {
        const costs = (this.overview()?.costByCategory ?? []).map((c) => {
            const meta = COST_CATEGORY_META[c.category] ?? { label: c.category, color: '#9ca3af' };
            return { label: meta.label, value: c.amountCents, color: meta.color };
        });
        const profit = Math.max(0, this.summary()?.finance?.resultCents ?? 0);
        // Biggest first, like the canvas.
        return [{ label: 'Lucro', value: profit, color: '#0a9b62' }, ...costs].sort((a, b) => b.value - a.value);
    });

    // ---- Top 5 by revenue -----------------------------------------------
    protected readonly topVehiclesByRevenue = computed<RankingItem[]>(() =>
        (this.summary()?.finance?.byVehicle ?? []).map((v) => ({
            id: v.id,
            name: v.label,
            value: formatBRLWhole(v.revenueCents),
            short: shortBrl(v.revenueCents),
            amount: v.revenueCents,
        })),
    );

    protected readonly topDriversByRevenue = computed<RankingItem[]>(() =>
        (this.summary()?.finance?.byDriver ?? []).map((d) => ({
            id: d.id,
            name: d.label,
            value: formatBRLWhole(d.revenueCents),
            short: shortBrl(d.revenueCents),
            amount: d.revenueCents,
        })),
    );

    // ---- Top offenders --------------------------------------------------
    protected readonly offenderRows = computed<OffenderRow[]>(() => {
        const top = this.summary()?.topOffenders;
        if (!top) return [];
        if (this.offenderMode() === 'vehicles') {
            // The canvas names the car (`Onix 3`); two cars of one model would be indistinguishable,
            // so the plate is added only for the models that repeat.
            const modelCount = new Map<string, number>();
            for (const v of top.vehicles) modelCount.set(v.model, (modelCount.get(v.model) ?? 0) + 1);
            return top.vehicles.map((v) => ({
                id: v.vehicleId,
                title: v.model && (modelCount.get(v.model) ?? 0) === 1 ? v.model : `${v.model ?? ''} ${v.plate}`.trim(),
                subtitle: `${v.brand} ${v.model}`,
                count: v.count,
                totalAmountCents: v.totalAmountCents,
            }));
        }
        return top.drivers.map((d) => ({
            id: d.driverId,
            title: d.name,
            subtitle: `${d.count} multa(s)`,
            count: d.count,
            totalAmountCents: d.totalAmountCents,
        }));
    });

    /** Footer of the offenders card: `9 multas · R$ 2.018 no período`; null with no fines. */
    protected readonly offenderSummary = computed(() => {
        const rows = this.offenderRows();
        const n = rows.reduce((t, r) => t + r.count, 0);
        if (n === 0) return null;
        const cents = rows.reduce((t, r) => t + r.totalAmountCents, 0);
        return `${n} ${n === 1 ? 'multa' : 'multas'} · ${formatBRLWhole(cents)} no período`;
    });

    // The picker fires (rangeChange) on init with the 30d default,
    // which calls onRangeChange → reload(). No manual ngOnInit needed.

    protected onRangeChange(range: DateRange): void {
        this.currentRange.set(range);
        this.load(range);
    }

    protected reload(): void {
        const r = this.currentRange();
        if (r) this.load(r);
    }

    /** V118 — o chip das cobranças não criadas leva ao painel com a frase e o "Gerar de novo". */
    protected scrollToFailedNotices(): void {
        this.doc.getElementById('cobrancas-paradas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    protected onAlertClick(target: string): void {
        this.router.navigateByUrl(target);
    }

    protected onDaySelect(iso: string): void {
        this.selectedDay.set(iso);
    }

    protected onDaySheetClose(): void {
        this.selectedDay.set(null);
    }

    protected onCalendarMonthChange(monthKey: string): void {
        if (this.calendarMonth() === monthKey) return;
        this.calendarMonth.set(monthKey);
        this.loadCalendarMonth(monthKey);
    }

    private loadCalendarMonth(monthKey: string): void {
        const [year, month] = monthKey.split('-').map(Number);
        const from = `${monthKey}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const to = `${monthKey}-${lastDay < 10 ? '0' : ''}${lastDay}`;
        this.service.loadOverview(from, to).subscribe({
            next: (res) => this.calendarCashflow.set(res.finance?.cashflow ?? []),
            error: () => this.calendarCashflow.set([]),
        });
    }

    /**
     * Compara valor atual com valor da janela anterior. Retorna delta em % com
     * 1 casa decimal, mais direção (up/down/flat) para colorir a seta.
     */
    protected formatDelta(current: number, previous: number): DeltaInfo {
        if (previous === 0 && current === 0) {
            return { label: null, direction: 'flat' };
        }
        if (previous === 0) {
            return { label: 'novo', direction: 'up' };
        }
        const pct = ((current - previous) / Math.abs(previous)) * 100;
        const rounded = Math.round(pct * 10) / 10;
        if (rounded === 0) return { label: '0%', direction: 'flat' };
        const sign = rounded > 0 ? '+' : '';
        const label = `${sign}${rounded.toString().replace('.', ',')}%`;
        return { label, direction: rounded > 0 ? 'up' : 'down' };
    }

    protected onOffenderClick(row: OffenderRow): void {
        const base = this.offenderMode() === 'vehicles' ? '/veiculos' : '/motoristas';
        this.router.navigateByUrl(`${base}/${row.id}`);
    }

    protected overdueLabel(count: number): string {
        return count === 1 ? 'cobrança vencida' : 'cobranças vencidas';
    }

    protected format(cents: number | null | undefined): string {
        return formatBRL(cents);
    }

    protected setOffenderMode(mode: 'vehicles' | 'drivers'): void {
        this.offenderMode.set(mode);
    }

    // ---- Internals ------------------------------------------------------

    private mapStatusSlices(
        raw: { status: string; count: number }[],
        meta: Record<string, StatusMeta>,
    ): RingSlice[] {
        return raw.map((r) => {
            const m = meta[r.status] ?? { label: r.status, color: '#9ca3af' };
            return { label: m.label, value: r.count, color: m.color };
        });
    }

    private load(range: DateRange): void {
        this.loading.set(true);
        this.error.set(null);
        this.service.loadOverview(range.from, range.to).subscribe({
            next: (res) => {
                this.summary.set(res);
                this.loading.set(false);
            },
            error: (err: HttpErrorResponse) => {
                const message =
                    err?.error?.message ??
                    'Não foi possível carregar o dashboard. Tente novamente.';
                this.error.set(message);
                this.loading.set(false);
            },
        });
    }
}
