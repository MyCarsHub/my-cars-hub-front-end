export interface GatewayRevenue {
  provider: string;
  amountCents: number;
}

export interface MonthlyPoint {
  yearMonth: string; // "YYYY-MM"
  revenueCents: number;
  /** True quando o bucket cobre apenas parte do mês (primeiro/último mês do intervalo). */
  isPartial: boolean;
}

export interface FinancialSummary {
  grossRevenueCents: number;
  /** SUM of PENDING charges with due_date in the current window (money owed / expected). */
  accruedRevenueCents: number;
  revenueByGateway: GatewayRevenue[];
  operatingCostCents: number;
  netProfitCents: number;
  monthlyRevenue: MonthlyPoint[];
}

export interface VehicleRow {
  vehicleId: string;
  plate: string;
  revenueCents: number;
  costCents: number;
  netCents: number;
}

export interface VehicleRanking {
  topProfitable: VehicleRow[];
  topUnprofitable: VehicleRow[];
}

export interface DriverRevenueRow {
  driverId: string;
  name: string;
  revenueCents: number;
}

export interface DriverProblematicRow {
  driverId: string;
  name: string;
  unpaidFinesCents: number;
  unpaidChargesCents: number;
  totalProblematicCents: number;
}

export interface DriverRanking {
  topRevenue: DriverRevenueRow[];
  topProblematic: DriverProblematicRow[];
}

export interface OperationsSummary {
  activeRentalsCount: number;
  completedRentalsCount: number;
  canceledRentalsCount: number;
  fleetOccupancyRate: number; // 0..1
}

export interface ReportsOverviewResponse {
  from: string; // "YYYY-MM-DD"
  to: string;
  financial: FinancialSummary;
  vehicleRanking: VehicleRanking;
  driverRanking: DriverRanking;
  operations: OperationsSummary;
}

/**
 * ROI POR VEICULO — `GET /v1/reports/vehicle-roi` (backend FEAT-0102).
 *
 * NAO e uma janela: diferente de `ReportsOverviewResponse`, este recorte e
 * ACUMULADO desde a aquisicao e por isso o endpoint NAO recebe `from`/`to`.
 * Copiar o padrao do `/reports/overview` aqui seria errado.
 *
 * Todos os valores em CENTAVOS (long no backend). A lista vem ordenada por
 * placa e inclui o veiculo INACTIVE (vendido/arquivado) de proposito — e
 * justamente sobre ele que o dono quer julgar se vender foi a decisao certa.
 */
export interface VehicleRoiReturnBreakdown {
  /** Aluguel RECEBIDO (base caixa, sem caucao). */
  rentalCents: number;
  /** Valor da VENDA do veiculo; zero enquanto nao foi vendido. */
  saleCents: number;
}

export interface VehicleRoiCostBreakdown {
  acquisitionCents: number;
  maintenanceCents: number;
  insuranceCents: number;
  fineCents: number;
  incidentCents: number;
}

export interface VehicleRoiItem {
  vehicleId: string;
  plate: string;
  brand: string;
  model: string;
  /** Retorno total = `returnBreakdown.rentalCents + saleCents`. */
  returnedCents: number;
  returnBreakdown: VehicleRoiReturnBreakdown;
  costCents: number;
  costBreakdown: VehicleRoiCostBreakdown;
  /** `returnedCents - costCents`. Negativo = o carro ainda esta sangrando. */
  netCents: number;
  /**
   * `null` quando `costCents === 0` — ROI INDETERMINADO, nao zero e nao
   * infinito. Custo zero neste produto quase sempre significa "preco de
   * aquisicao nao informado", e mostrar 0% faria o dono concluir que o carro
   * nao deu retorno.
   */
  roiPercent: number | null;
  /** "YYYY-MM" do mes em que o retorno alcancou o custo; `null` se nao houve. */
  paybackMonth: string | null;
  paybackReached: boolean;
  /** `max(0, costCents - returnedCents)` — quanto FALTA para o carro se pagar. */
  remainingToPaybackCents: number;
}

export interface VehicleRoiResponse {
  vehicles: VehicleRoiItem[];
}
