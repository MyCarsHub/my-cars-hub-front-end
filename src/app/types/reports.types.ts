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
