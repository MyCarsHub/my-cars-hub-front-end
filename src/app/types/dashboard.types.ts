/**
 * Types mirroring the backend `GET /v1/dashboard/summary` response
 * (see `.notebook/dashboard-brief.md` §1).
 *
 * Every field name here is the JSON wire key. Money is expressed in cents (integer).
 * Dates are ISO strings `yyyy-MM-dd`.
 */

export interface PeriodDto {
    from: string;
    to: string;
}

export interface CountDto {
    count: number;
}

export interface CountAmountDto {
    count: number;
    amountCents: number;
}

/**
 * `alerts.overdueCharges`: `count` conta COBRANÇAS; `rentals` conta os ALUGUÉIS distintos que
 * as têm (o que a lista aberta pelo card mostra). Opcional: um backend anterior não o envia.
 */
export interface OverdueChargesDto extends CountAmountDto {
    rentals?: number;
}

export interface AlertsDto {
    openFines: CountAmountDto;
    openMaintenances: CountDto;
    expiringCnh30d: CountDto;
    expiringLicensing30d: CountDto;
    reservedRentals: CountDto;
    /** Fines paid inside the requested period. */
    paidFinesInPeriod: CountAmountDto;
    /**
     * Apólices de seguro ativas vencendo nos próximos 30 dias.
     * Opcional: só existe em backends a partir da entrega de seguros — os
     * consumidores já leem com `?.` / `?? 0`, e declarar obrigatório escondia
     * essa divergência real de contrato do compilador.
     */
    expiringInsurance30d?: CountDto;
    /**
     * Documentos (CNH/CRLV/seguro/parcela) vencendo nos próximos 7 dias.
     * Opcional pelo mesmo motivo de `expiringInsurance30d`.
     */
    docsExpiring7d?: CountDto;
    /**
     * Cobranças de aluguel em atraso (quantidade e valor somado), por empresa.
     * Opcional pelo mesmo motivo de `expiringInsurance30d`: um backend anterior
     * à entrega do alerta não o envia.
     */
    overdueCharges?: OverdueChargesDto;
    /**
     * V118 — cobranças FAILED de aluguel em curso em que a locadora precisa agir (não
     * foram criadas no Asaas ou precisam de link novo). Opcional: backend anterior não envia.
     */
    failedCharges?: CountAmountDto;
    /**
     * STORY-VEHICLE-FINANCE — parcelas de IPVA a vencer. Opcional pelo mesmo motivo de
     * `expiringInsurance30d`: um backend anterior à entrega do IPVA não o envia.
     */
    ipva?: CountDto;
}

export interface FleetDto {
    vehiclesTotal: number;
    vehicleLimit: number | null;
    /** Recorte operacional: motoristas `AVAILABLE`/`WORKING`. */
    driversActive: number;
    /**
     * Total de motoristas da conta.
     *
     * NÃO existe mais um `driverLimit` para comparar (FEAT-0070): o teto virou
     * guarda-corpo interno, o backend o removeu do `FleetDto` e a tela deixou
     * de exibir capacidade de motorista. Este número é operação — quantos
     * existem —, não capacidade.
     */
    driversTotal: number;
    rentedNow: number;
    reservedNow: number;
    utilizationPct: number;
}

export interface DailyPointDto {
    date: string;
    cents: number;
}

/** Faturamento agregado por mês nos últimos 6 meses. */
export interface MonthlyPointDto {
    /** ISO `yyyy-MM`. */
    month: string;
    amountCents: number;
}

/** Revenue contribution of a single vehicle or driver in the window. */
export interface RevenueByEntityDto {
    id: string;
    label: string;
    revenueCents: number;
}

/**
 * Every kind the backend puts in `finance.cashflow`.
 * - `RENTAL_RECEIPT_*` / `DEPOSIT_RECEIPT_*` (IN): the real charges on their due date, rent and
 *   caução; `_PAID` received, `_OVERDUE` past due and unpaid, `_DUE` still to come (FIX-0875)
 * - `MAINTENANCE_PAID` / `MAINTENANCE_SCHEDULED` (OUT): maintenance costs
 * - `*_PAID` (OUT) money that left; `*_DUE` (OUT) money still to leave — fines, IPVA
 *   installments, insurance and financing installments (STORY-VEHICLE-FINANCE)
 */
export type CashflowKind =
    | 'RENTAL_RECEIPT_PAID'
    | 'RENTAL_RECEIPT_OVERDUE'
    | 'RENTAL_RECEIPT_DUE'
    | 'DEPOSIT_RECEIPT_PAID'
    | 'DEPOSIT_RECEIPT_OVERDUE'
    | 'DEPOSIT_RECEIPT_DUE'
    | 'MAINTENANCE_PAID'
    | 'MAINTENANCE_SCHEDULED'
    | 'FINE_PAID'
    | 'FINE_DUE'
    | 'IPVA_DUE'
    | 'IPVA_PAID'
    | 'INSURANCE_DUE'
    | 'INSURANCE_PAID'
    | 'FINANCING_DUE'
    | 'FINANCING_PAID'
    | 'EXPENSE_PAID';

/** Cash-flow event on a specific day (kinds: see {@link CashflowKind}). */
export interface CashflowEventDto {
    /** ISO `yyyy-MM-dd`. */
    date: string;
    kind: CashflowKind;
    direction: 'IN' | 'OUT';
    amountCents: number;
    rentalId?: string | null;
    vehicleId?: string | null;
    driverId?: string | null;
    label: string;
}

/**
 * Despesas da janela por categoria (STORY-VEHICLE-FINANCE), na mesma unidade do total ao
 * lado dela (`expensesCents` no dashboard, `operatingCostCents` nos relatórios): centavos.
 * A soma das cinco é o total.
 */
export interface ExpenseBreakdownDto {
    maintenance: number;
    fines: number;
    ipva: number;
    insurance: number;
    financing: number;
    /**
     * Gastos da locadora (FEAT-0424, `company_expenses`). Opcional: um back-end anterior não o
     * envia, e aí a linha some em vez de virar um R$ 0,00 que afirmaria um fato falso.
     */
    expenses?: number;
}

export interface FinanceDto {
    /**
     * FATURADO: cobranças de aluguel com vencimento na janela (sem caução, sem canceladas).
     * O nome do campo é o mesmo de antes; o significado mudou.
     */
    revenueCents: number;
    /**
     * RECEBIDO: caixa do dia (São Paulo) do pagamento, pelo valor efetivamente pago, sem caução;
     * estornos subtraem. Pode passar do Faturado (caixa sobre competência): nunca exibir como
     * percentual do faturado.
     */
    receivedCents: number;
    expensesCents: number;
    /**
     * Receita BRUTA de VENDA de veículos na janela (FEAT-0074), em centavos.
     *
     * Categoria PRÓPRIA: fica FORA de `revenueCents` e de `receivedCents`, e
     * entra no resultado (`revenue + saleRevenue - expenses`). É entrada
     * PONTUAL — misturar com faturamento de aluguel faria a tela anunciar uma
     * recorrência que não existe.
     *
     * NÃO existe `previousSaleRevenueCents`: o comparativo "vs período
     * anterior" segue valendo só para aluguel, e inventar um delta aqui seria
     * inventar dado.
     */
    saleRevenueCents: number;
    resultCents: number;
    /** Portion of expenses from maintenances (period). */
    maintenanceExpenseCents: number;
    /** Portion of expenses from PAID fines (period). */
    fineExpenseCents: number;
    /**
     * `expensesCents` por categoria. Opcional: um backend anterior não o envia, e aí a tela
     * só tem manutenção e multas (os dois campos acima) para mostrar.
     */
    expenseBreakdown?: ExpenseBreakdownDto;
    /**
     * FEAT-0424 — parte dos Gastos do período SEM veículo ("Locadora toda"). Já está DENTRO de
     * `expensesCents`; nunca é rateada por carro. Opcional: back-end anterior não envia.
     */
    companyWideExpensesCents?: number;
    /**
     * A receber: parte do Faturado do período ainda PENDENTE com vencimento de hoje em diante.
     * (Antes: PENDING criadas na janela.)
     */
    pendingChargesCents: number;
    /** Em atraso (R$): SUM de rental_charges FAILED + PENDING vencidas. */
    overdueChargesCents: number;
    /**
     * Em atraso DO período: parte do Faturado do período que já venceu sem pagar. Opcional: um
     * backend anterior não o envia, e aí a tela não mostra o percentual.
     */
    overdueInPeriodCents?: number | null;
    /**
     * Em atraso do período sobre o Faturado, em pontos-base (10000 = 100%). `null` quando o
     * Faturado é zero; ausente num backend anterior. Nos dois casos a tela esconde o percentual.
     */
    overdueRateBp?: number | null;
    /** Faturado do período imediatamente anterior. */
    previousRevenueCents: number;
    /** Recebido na janela imediatamente anterior. */
    previousReceivedCents: number;
    revenueDaily: DailyPointDto[];
    /** Top vehicles by pro-rata revenue in the window. */
    byVehicle: RevenueByEntityDto[];
    /** Top drivers by pro-rata revenue in the window. */
    byDriver: RevenueByEntityDto[];
    /** Faturamento mensal últimos 6 meses (ordem cronológica crescente, 6 buckets). */
    monthlyBilling: MonthlyPointDto[];
    /**
     * Cashflow events in the window, expanded per billing frequency.
     * Consumed by the financial calendar.
     */
    cashflow: CashflowEventDto[];
}

export interface StatusBucketDto {
    status: string;
    count: number;
    totalCents: number;
}

export interface ChargesDto {
    byStatus: StatusBucketDto[];
    ticketMedioCents: number;
    /** Count of rentals COMPLETED (end_date) inside the period. */
    completedRentalsCount: number;
    /**
     * Ticket médio mensal dos últimos 6 meses (mês corrente + 5). Cada ponto é
     * SUM(total_amount) / COUNT(*) das rentals COMPLETED cujo end_date cai no mês.
     * Sempre 6 buckets em ordem cronológica crescente (zero-fill garantido).
     */
    ticketMedioLast6Months: MonthlyPointDto[];
}

export interface StatusCountDto {
    status: string;
    count: number;
}

export interface DistributionsDto {
    rentalsByStatus: StatusCountDto[];
    vehiclesByStatus: StatusCountDto[];
}

export interface VehicleOffenderDto {
    vehicleId: string;
    plate: string;
    brand: string;
    model: string;
    count: number;
    totalAmountCents: number;
}

export interface DriverOffenderDto {
    driverId: string;
    name: string;
    count: number;
    totalAmountCents: number;
}

export interface TopOffendersDto {
    vehicles: VehicleOffenderDto[];
    drivers: DriverOffenderDto[];
}

export interface DashboardSummaryDto {
    period: PeriodDto;
    alerts: AlertsDto;
    fleet: FleetDto;
    /** Always populated for every plan (no gating). */
    finance: FinanceDto;
    charges: ChargesDto;
    distributions: DistributionsDto;
    topOffenders: TopOffendersDto;
    /** FEAT-0467 (v2 blocks). Optional: an older backend does not send it. */
    overview?: OverviewDto;
}

/** FEAT-0467 — four readings added to the summary, all per company. */
export interface OverviewDto {
    /** 6 months (current + 5), cash basis, ascending. */
    monthlyResult: MonthlyResultDto[];
    overdueAging: OverdueAgingDto;
    /** Always the five categories, zero-filled. */
    costByCategory: CostCategoryDto[];
    receivedByDay: { currentMonth: DailyPointDto[]; previousMonth: DailyPointDto[] };
}

export interface MonthlyResultDto {
    /** ISO `yyyy-MM`. */
    month: string;
    /** RECEBIDO do mês (caixa). O nome do campo é herdado; o significado mudou. */
    revenueCents: number;
    /**
     * Venda de veículos do mês (entra no lucro, fica fora do Recebido). Opcional: ausente num
     * backend anterior, e aí vale zero.
     */
    saleRevenueCents?: number | null;
    costCents: number;
    profitCents: number;
    costBreakdown: ExpenseBreakdownDto;
}

export interface AgingBucketDto {
    count: number;
    amountCents: number;
}

export interface OverdueAgingDto {
    days1To7: AgingBucketDto;
    days8To30: AgingBucketDto;
    daysOver30: AgingBucketDto;
}

export interface CostCategoryDto {
    category: 'MAINTENANCE' | 'FINES' | 'IPVA' | 'INSURANCE' | 'FINANCING' | 'EXPENSES' | string;
    amountCents: number;
    /** Basis points (10000 = 100%). */
    shareBp: number;
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
});

/** Format an integer number of cents as Brazilian Real (e.g. 12345 → "R$ 123,45"). */
export function formatBRL(cents: number | null | undefined): string {
    const value = (cents ?? 0) / 100;
    return BRL_FORMATTER.format(value);
}

const BRL_WHOLE_FORMATTER = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

/** Cents as whole reais ("R$ 7.356"), for dashboard summaries where cents are noise. */
export function formatBRLWhole(cents: number | null | undefined): string {
    return BRL_WHOLE_FORMATTER.format(Math.round((cents ?? 0) / 100));
}

/** Format an ISO `yyyy-MM-dd` as a short pt-BR date (e.g. "07 jul"). */
export function formatShortDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** Format an ISO `yyyy-MM-dd` as `dd/MM/yyyy`. */
export function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
}
