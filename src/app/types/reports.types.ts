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

/**
 * ROI AGREGADO DA FROTA — o que o card KPI do dashboard mostra (FIX-0420).
 *
 * `known` e `total` existem para a tela poder DIZER sobre quantos carros o
 * numero fala. Sao a diferenca entre um KPI honesto e um que mente calado.
 */
export interface FleetRoiSummary {
  /** Veiculos com custo conhecido — a base real do percentual. */
  known: number;
  /** Veiculos na resposta, incluindo os sem preco de compra. */
  total: number;
  /** `null` quando NENHUM veiculo tem custo conhecido: indeterminado, nao zero. */
  roiPercent: number | null;
  /** Liquido dos veiculos da BASE, nunca da frota toda — ver abaixo. */
  netCents: number;
}

/**
 * Agrega o ROI da frota IGNORANDO o veiculo sem preco de compra
 * (`costCents === 0`, que o backend acompanha de `roiPercent: null`).
 *
 * POR QUE NAO SOMAR TUDO: o carro sem preco entra com custo ZERO e retorno
 * CHEIO. Somando cegamente, o custo total sai subestimado e o percentual da
 * frota sai INFLADO — um unico carro sem preco contamina o numero da frota
 * inteira, e para o lado otimista, que e o pior lado num produto de dinheiro.
 * E o mesmo defeito que a review pegou no cartao por veiculo, agora em escala:
 * la o dono via um carro errado, aqui veria a empresa errada.
 *
 * POR QUE O `netCents` TAMBEM E SO DA BASE: se o percentual fala de 12 carros e
 * o dinheiro fala de 17, as duas linhas do mesmo card descrevem populacoes
 * diferentes e a legenda passa a contradizer o numero grande. Uma base so.
 *
 * Quem chama TEM de mostrar `known`/`total` quando eles diferem: excluir em
 * silencio seria trocar um numero inflado por um numero mudo.
 */
export function aggregateFleetRoi(
  vehicles: readonly VehicleRoiItem[],
): FleetRoiSummary {
  const base = vehicles.filter((v) => v.costCents > 0);

  const costCents = base.reduce((sum, v) => sum + v.costCents, 0);
  const returnedCents = base.reduce((sum, v) => sum + v.returnedCents, 0);

  return {
    known: base.length,
    total: vehicles.length,
    // Sem base nao ha razao a calcular — `null` e indeterminado, nao zero.
    roiPercent: costCents > 0 ? ((returnedCents - costCents) / costCents) * 100 : null,
    netCents: costCents > 0 ? returnedCents - costCents : 0,
  };
}

