import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { BillingAccessService } from '../../services/billing-access.service';
import { DashboardService } from '../../services/dashboard.service';
import { showsAsUnlimited } from '../../utils/plan-limits';
import {
    CashflowEventDto,
    DashboardSummaryDto,
    MonthlyPointDto,
    formatBRL,
} from '../../types/dashboard.types';
import { DateRange, DateRangePicker } from './components/date-range-picker';
import { AlertChip } from './components/alert-chip';
import { MonthlyBillingChart } from './components/monthly-billing-chart';
import { OffenderRow, TopOffendersTable } from './components/top-offenders-table';
import { FinancialCalendar } from './components/financial-calendar';
import { CashflowDaySheet } from './components/cashflow-day-sheet';
import { StatusBarChart, StatusBucketRow } from './components/status-bar-chart';
import { BarChart, BarDatum } from './components/bar-chart';
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
    RESERVED: { label: 'Reservados', color: '#f59e0b' },
    ACTIVE: { label: 'Ativos', color: '#6366f1' },
    COMPLETED: { label: 'Concluídos', color: '#10b981' },
    CANCELED: { label: 'Cancelados', color: '#9ca3af' },
};

const VEHICLE_STATUS_META: Record<string, StatusMeta> = {
    AVAILABLE: { label: 'Disponíveis', color: '#10b981' },
    RENTED: { label: 'Alugados', color: '#6366f1' },
    MAINTENANCE: { label: 'Manutenção', color: '#f59e0b' },
    INACTIVE: { label: 'Inativos', color: '#9ca3af' },
};

/**
 * Dashboard MVP — foco em ações financeiras diárias.
 *
 * <h4>Blocos</h4>
 * Alerts, Fleet KPIs, Filtro/DateRange, Faturamento (4 cards + gráfico 6 meses),
 * Calendário Financeiro, Distribuições (aluguéis/veículos por status),
 * Top 5 por receita (veículos/motoristas), Top ofensores,
 * Evolução do Ticket Médio (linha, 6m), Ações rápidas.
 */
@Component({
    selector: 'app-dashboard-home',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DefaultPageLayout,
        PageCard,
        DateRangePicker,
        AlertChip,
        MonthlyBillingChart,
        TopOffendersTable,
        FinancialCalendar,
        CashflowDaySheet,
        StatusBarChart,
        BarChart,
        QuickActionCard,
    ],
    templateUrl: './dashboard-home.html',
})
export class DashboardHome {
    private readonly service = inject(DashboardService);
    private readonly router = inject(Router);
    private readonly access = inject(BillingAccessService);

    protected readonly summary = signal<DashboardSummaryDto | null>(null);
    protected readonly loading = signal(false);
    protected readonly error = signal<string | null>(null);

    /** Currently applied range — used on reload after failure. */
    private readonly currentRange = signal<DateRange | null>(null);

    /**
     * Set by the monthly-billing bar click. The date-range-picker watches this
     * via `input()` + `effect()` and switches to that month's full range.
     */
    protected readonly jumpToMonth = signal<string | null>(null);

    protected readonly offenderMode = signal<'vehicles' | 'drivers'>('vehicles');

    /** Currently selected day in the calendar — drives the detail sheet. */
    protected readonly selectedDay = signal<string | null>(null);

    // ---- Alerts ---------------------------------------------------------
    protected readonly showAlerts = computed(() => {
        const a = this.summary()?.alerts;
        if (!a) return false;
        return (
            a.openFines.count > 0 ||
            a.openMaintenances.count > 0 ||
            a.expiringCnh30d.count > 0 ||
            a.expiringLicensing30d.count > 0 ||
            a.reservedRentals.count > 0 ||
            // Campos aditivos: `?.` protege contra um backend mais antigo que
            // ainda não os envia — o dashboard inteiro não pode quebrar por isso.
            (a.docsExpiring7d?.count ?? 0) > 0 ||
            (a.expiringInsurance30d?.count ?? 0) > 0
        );
    });

    // ---- Fleet ----------------------------------------------------------

    /**
     * Nome do plano vigente (`TRIAL` / `PRO` / `ENTERPRISE`).
     *
     * O resumo do dashboard manda os limites mas não o plano, então vem do
     * access-status — já carregado pelo `billingAccessGuard`, que é
     * `canActivateChild` da árvore onde o dashboard mora, logo não há request
     * extra nem race. Nulo (admin de plataforma, falha de rede) só desliga a
     * maquiagem: os cards caem no número real, que é o comportamento seguro.
     */
    private readonly currentPlanName = computed<string | null>(
        () => this.access.status()?.plan?.name ?? null,
    );

    /**
     * Consumo de veículos contra o limite do plano.
     *
     * Dois motivos para a frase virar "ilimitado", ambos decididos em
     * `utils/plan-limits.ts`: limite nulo (sentinela da coluna, que segue
     * válido mesmo sem nenhum plano usá-lo depois da V44) e plano maquiado
     * (ENTERPRISE, com teto real de 500 que a UI não exibe). Nos dois casos
     * não existe numerador/denominador honesto, então a frase muda inteira —
     * mesmo tratamento de `driverPlanLabel`, para os dois cards da grade de
     * KPIs lerem como um conjunto.
     */
    protected readonly vehiclePlanLabel = computed(() => {
        const fleet = this.summary()?.fleet;
        if (!fleet) return '';
        const limit = fleet.vehicleLimit;
        if (showsAsUnlimited(this.currentPlanName(), limit)) {
            return 'veículos ilimitados no plano';
        }
        return `${fleet.vehiclesTotal} de ${limit} do plano`;
    });

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

    protected readonly hasOverdue = computed(
        () => (this.summary()?.finance?.overdueChargesCents ?? 0) > 0,
    );

    protected readonly billingDelta = computed<DeltaInfo>(() => {
        const f = this.summary()?.finance;
        return this.formatDelta(f?.revenueCents ?? 0, f?.previousRevenueCents ?? 0);
    });

    protected readonly receivedDelta = computed<DeltaInfo>(() => {
        const f = this.summary()?.finance;
        return this.formatDelta(f?.receivedCents ?? 0, f?.previousReceivedCents ?? 0);
    });

    protected readonly monthlyBilling = computed(
        () => this.summary()?.finance?.monthlyBilling ?? [],
    );

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

    /**
     * Legenda de honestidade da série mensal — SÓ quando houve venda.
     *
     * A série (`monthlyBilling`) é de ALUGUEL: o backend não manda a venda
     * quebrada por mês (`saleRevenueCents` é escalar da janela). Distribuir
     * esse total pelos meses seria inventar dado; então o gráfico continua
     * plotando o recorrente e DIZ o que ficou de fora, com o valor, para
     * ninguém comparar gráfico com card e achar que falta dinheiro.
     *
     * Sem venda a nota NÃO existe: não há nada fora da série para declarar, e
     * citar "o card Venda" seria apontar para um card que está oculto nesse
     * estado. Sem venda, a tela é idêntica à de antes deste nó — invariante.
     */
    protected readonly monthlyChartNote = computed(() =>
        this.hasSaleRevenue()
            ? `Só aluguel (recorrente). A venda de veículos do período (${this.saleRevenueLabel()}) não entra nesta série.`
            : null,
    );

    /** Line-chart series (ticket médio mensal últimos 6 meses). */
    protected readonly ticketMedioSeries = computed<MonthlyPointDto[]>(
        () => this.summary()?.charges?.ticketMedioLast6Months ?? [],
    );

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
    protected readonly rentalsByStatusRows = computed<StatusBucketRow[]>(() =>
        this.mapStatusRows(this.summary()?.distributions?.rentalsByStatus ?? [], RENTAL_STATUS_META),
    );

    protected readonly vehiclesByStatusRows = computed<StatusBucketRow[]>(() =>
        this.mapStatusRows(this.summary()?.distributions?.vehiclesByStatus ?? [], VEHICLE_STATUS_META),
    );

    // ---- Top 5 by revenue -----------------------------------------------
    protected readonly topVehiclesByRevenue = computed<BarDatum[]>(() =>
        (this.summary()?.finance?.byVehicle ?? []).map((v) => ({
            label: v.label,
            value: v.revenueCents,
        })),
    );

    protected readonly topDriversByRevenue = computed<BarDatum[]>(() =>
        (this.summary()?.finance?.byDriver ?? []).map((d) => ({
            label: d.label,
            value: d.revenueCents,
        })),
    );

    // ---- Top offenders --------------------------------------------------
    protected readonly offenderRows = computed<OffenderRow[]>(() => {
        const top = this.summary()?.topOffenders;
        if (!top) return [];
        if (this.offenderMode() === 'vehicles') {
            return top.vehicles.map((v) => ({
                id: v.vehicleId,
                title: `${v.plate}`,
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

    protected onAlertClick(target: string): void {
        this.router.navigateByUrl(target);
    }

    protected onMonthlyBarClick(monthKey: string): void {
        this.jumpToMonth.set(monthKey);
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

    protected format(cents: number | null | undefined): string {
        return formatBRL(cents);
    }

    protected setOffenderMode(mode: 'vehicles' | 'drivers'): void {
        this.offenderMode.set(mode);
    }

    // ---- Internals ------------------------------------------------------

    private mapStatusRows(
        raw: { status: string; count: number }[],
        meta: Record<string, StatusMeta>,
    ): StatusBucketRow[] {
        return raw.map((r) => {
            const m = meta[r.status] ?? { label: r.status, color: '#9ca3af' };
            return {
                status: r.status,
                count: r.count,
                label: m.label,
                color: m.color,
            };
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
