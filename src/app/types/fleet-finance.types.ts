import { IpvaInstallmentStatus } from './vehicle-ipva.types';

/**
 * Visões da FROTA inteira para IPVA, financiamentos e seguros (STORY-VEHICLE-FINANCE).
 * Valores de IPVA em CENTAVOS (`*Cents`). Os resumos de financiamento e seguro seguem o
 * mesmo tipo dos campos vizinhos das listas (`purchasePrice`, `premiumAmount`): centavos.
 */

/** `GET /v1/ipva/summary?year=` */
export interface IpvaFleetSummary {
  year: number;
  vehiclesWithIpva: number;
  totalCents: number;
  paidCents: number;
  openCents: number;
  overdueCount: number;
  overdueCents: number;
  /** Menor vencimento em aberto da frota no ano; `null` sem parcela em aberto. */
  nextDueDate: string | null;
}

/** Linha de `GET /v1/ipva` — um veículo num exercício. */
export interface IpvaFleetRow {
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  year: number;
  totalCents: number;
  paidCents: number;
  openCents: number;
  installmentsCount: number;
  paidCount: number;
  overdueCount: number;
  nextDueDate: string | null;
  status: IpvaInstallmentStatus;
}

export interface IpvaFleetFilters {
  year: number;
  status?: IpvaInstallmentStatus;
  q?: string;
  page?: number;
  size?: number;
}

/** `GET /v1/financings/summary` */
export interface FinancingsSummary {
  activeCount: number;
  paidOffCount: number;
  overdueInstallments: number;
  totalFinancedActive: number;
  monthlyInstallmentsActive: number;
}

/** `GET /v1/insurances/summary?expiringInDays=` */
export interface InsurancesSummary {
  activeCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  cancelledCount: number;
  premiumTotalActive: number;
}

/**
 * Filtro do seletor de veículo das folhas "Adicionar …". Exatamente um dos três vai na
 * requisição: o backend devolve só os carros que ainda não têm aquilo.
 */
export type VehiclePickerFilter =
  | { readonly kind: 'withoutIpvaYear'; readonly year: number }
  | { readonly kind: 'withoutActiveFinancing' }
  | { readonly kind: 'withoutActiveInsurance' };

/**
 * `?abrir=financiamento|seguro` na edição do veículo: o carro já foi escolhido na folha
 * "Adicionar …" das listas da frota, então o bloco chega aberto.
 */
export const OPEN_BLOCK_PARAM = 'abrir';
export type OpenBlock = 'financiamento' | 'seguro';
