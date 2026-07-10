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

export interface AlertsDto {
    openFines: CountAmountDto;
    openMaintenances: CountDto;
    expiringCnh30d: CountDto;
    expiringLicensing30d: CountDto;
    reservedRentals: CountDto;
    /** Fines paid inside the requested period. */
    paidFinesInPeriod: CountAmountDto;
}

export interface FleetDto {
    vehiclesTotal: number;
    vehicleLimit: number | null;
    driversActive: number;
    driverLimit: number | null;
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
 * Cash-flow event on a specific day.
 * - `RENTAL_RECEIPT` (IN): revenue projected per rental billing frequency
 * - `MAINTENANCE_PAID` / `MAINTENANCE_SCHEDULED` (OUT): maintenance costs
 * - `FINE_PAID` (OUT) / `FINE_DUE` (OUT): fine cash effects
 */
export interface CashflowEventDto {
    /** ISO `yyyy-MM-dd`. */
    date: string;
    kind:
        | 'RENTAL_RECEIPT'
        | 'MAINTENANCE_PAID'
        | 'MAINTENANCE_SCHEDULED'
        | 'FINE_PAID'
        | 'FINE_DUE';
    direction: 'IN' | 'OUT';
    amountCents: number;
    rentalId?: string | null;
    vehicleId?: string | null;
    driverId?: string | null;
    label: string;
}

export interface FinanceDto {
    /**
     * Revenue derived from the rental contract itself (ACTIVE + COMPLETED
     * rentals intersecting the window, pro-rata). Independent of Asaas.
     */
    revenueCents: number;
    /**
     * Cash actually collected through the automatic-charge pipeline (Asaas)
     * in the window. May legitimately be 0 when the tenant uses manual
     * billing — revenue can still be > 0 in that case.
     */
    receivedCents: number;
    expensesCents: number;
    resultCents: number;
    /** Portion of expenses from maintenances (period). */
    maintenanceExpenseCents: number;
    /** Portion of expenses from PAID fines (period). */
    fineExpenseCents: number;
    /** SUM de rental_charges PENDING criadas na janela (proxy "a receber"). */
    pendingChargesCents: number;
    /** SUM de rental_charges FAILED + PENDING vencidas (inadimplência de aluguéis). */
    overdueChargesCents: number;
    /** Faturamento pro-rata na janela imediatamente anterior. */
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
