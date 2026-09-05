export type VehicleType = 'CAR' | 'MOTORCYCLE';
export type FinancingStatus = 'ACTIVE' | 'PAID_OFF';
export type IpvaStatus = 'PAID' | 'PENDING' | 'OVERDUE';
export type VehicleStatus = 'AVAILABLE' | 'RENTED' | 'MAINTENANCE' | 'INACTIVE';
/** V31: combustível do veículo. Nullable — legado pode não ter valor. */
export type VehicleFuel =
  | 'GASOLINA'
  | 'ETANOL'
  | 'DIESEL'
  | 'FLEX'
  | 'GNV'
  | 'ELETRICO'
  | 'HIBRIDO';

export const VEHICLE_FUEL_OPTIONS: ReadonlyArray<{ value: VehicleFuel; label: string }> = [
  { value: 'GASOLINA', label: 'Gasolina' },
  { value: 'ETANOL', label: 'Etanol' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'FLEX', label: 'Flex' },
  { value: 'GNV', label: 'GNV' },
  { value: 'ELETRICO', label: 'Elétrico' },
  { value: 'HIBRIDO', label: 'Híbrido' },
];

import { IPVA_STATUS_OPTIONS as _IPVA_STATUS_OPTIONS } from '../utils/status-maps';

/**
 * @deprecated Import `IPVA_STATUS_OPTIONS` from `utils/status-maps.ts` instead.
 */
export const IPVA_STATUS_OPTIONS = _IPVA_STATUS_OPTIONS;

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'CAR', label: 'Carro' },
  { value: 'MOTORCYCLE', label: 'Moto' },
] as const;

export const VEHICLE_SORT_OPTIONS = [
  { value: 'plate_asc', label: 'Placa (A→Z)' },
  { value: 'plate_desc', label: 'Placa (Z→A)' },
  { value: 'licensing_expiration_asc', label: 'Licenciamento (mais próximo)' },
  { value: 'licensing_expiration_desc', label: 'Licenciamento (mais distante)' },
  { value: 'created_desc', label: 'Cadastro (mais recente)' },
  { value: 'created_asc', label: 'Cadastro (mais antigo)' },
] as const;

export interface VehicleListItem {
  id: string;
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearModel: number;
  licensingExpiration: string | null;
  status: VehicleStatus;
  createdDate: string;
  /** FIX-0263/0264: o backend deriva na própria query da listagem — nunca null. */
  sold: boolean;
  ipvaStatus?: IpvaStatus | null;
  ipvaExpired?: boolean;
}

export interface Financing {
  id: string;
  vehicleId: string;
  contractDate: string;
  purchasePrice: number;
  downPayment: number | null;
  totalFinanced: number | null;
  installments: number | null;
  installmentAmount: number | null;
  status: FinancingStatus;
  paidOffDate: string | null;
  createdDate: string;
  modifyDate: string | null;
}

/**
 * Venda de um veículo (FEAT-0072, STORY-VEHICLE-SALE) — espelha o
 * `VehicleSaleDto` do backend.
 *
 * OS NOMES SÃO O CONTRATO: o backend não tem `PropertyNamingStrategy` nem
 * `@JsonAlias`, então `saleDate`/`saleValueCents` não podem virar
 * `soldAt`/`amount` "porque lê melhor" — a serialização é por nome exato e o
 * POST voltaria 400 (ou, pior no GET, campos `undefined` renderizados).
 */
export interface VehicleSale {
  id: string;
  buyerName: string;
  /** `yyyy-MM-dd` (LocalDate). */
  saleDate: string;
  /** CENTAVOS (Long `*_cents`), como `purchasePrice`/`ipvaAmount`. */
  saleValueCents: number;
  /** `LocalDateTime` do registro da venda — quando foi lançada, não quando ocorreu. */
  createdDate: string;
}

/** Corpo do `POST /v1/vehicles/{id}/sale` — espelha `SellVehicleRequestDto`. */
export interface CreateVehicleSaleRequest {
  /** `@NotBlank @Size(max=180)`. */
  buyerName: string;
  /** `@NotNull @PastOrPresent`, `yyyy-MM-dd`. */
  saleDate: string;
  /** `@NotNull @Min(0)`, CENTAVOS. Nunca reais. */
  saleValueCents: number;
}

export interface Vehicle {
  id: string;
  companyId: string;
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearManufacture: number;
  yearModel: number;
  chassis: string | null;
  hodometer: number;
  licensingExpiration: string | null;
  renavam: string | null;
  color: string | null;
  purchaseDate: string | null;
  /**
   * Valor total pago pelo veículo, em CENTAVOS (V71, STORY-VEHICLE-ACQUISITION-COST).
   * É o custo de aquisição do VEÍCULO — não confundir com `Financing.purchasePrice`,
   * que é o preço do contrato de financiamento. A Gerência prefere este campo e
   * cai no financiamento quando ele é nulo (regra do backend; o FE só exibe).
   */
  purchasePrice: number | null;
  ipvaAmount: number | null;
  ipvaDueDate: string | null;
  ipvaStatus: IpvaStatus | null;
  ipvaExpired: boolean;
  status: VehicleStatus;
  fuel: VehicleFuel | null;
  activeFinancing: Financing | null;
  /**
   * Venda anexada (FEAT-0072). `null` enquanto o veículo é da frota; preenchida
   * quando foi vendido — e é ELA, não o `status`, que decide se a tela entra em
   * somente-leitura: o veículo vendido sai da operação por inteiro.
   */
  sale: VehicleSale | null;
  createdDate: string;
  modifyDate: string | null;
}

export interface CreateVehicleRequest {
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearManufacture: number;
  yearModel: number;
  chassis?: string | null;
  hodometer: number;
  licensingExpiration?: string | null;
  renavam?: string | null;
  color?: string | null;
  purchaseDate?: string | null;
  /** Centavos. Ver `Vehicle.purchasePrice`. */
  purchasePrice?: number | null;
  ipvaAmount?: number | null;
  ipvaDueDate?: string | null;
  ipvaStatus?: IpvaStatus | null;
  fuel?: VehicleFuel | null;
}

export interface UpdateVehicleRequest {
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  yearManufacture: number;
  yearModel: number;
  hodometer: number;
  licensingExpiration?: string | null;
  color?: string | null;
  purchaseDate?: string | null;
  /**
   * Centavos. O PUT é full-replace: omitir (ou mandar null) APAGA o valor no
   * backend — por isso o formulário de edição SEMPRE carrega e reenvia este
   * campo, no mesmo idioma de `ipvaAmount`.
   */
  purchasePrice?: number | null;
  ipvaAmount?: number | null;
  ipvaDueDate?: string | null;
  ipvaStatus?: IpvaStatus | null;
  fuel?: VehicleFuel | null;
}

export interface CreateFinancingRequest {
  contractDate: string;
  purchasePrice: number;
  downPayment?: number | null;
  totalFinanced?: number | null;
  installments?: number | null;
  installmentAmount?: number | null;
}

export interface MarkPaidOffRequest {
  paidOffDate?: string;
}

export interface VehicleFilters {
  q?: string;
  /**
   * Recorte de vendidos (FEAT-0072). AUSENTE = listagem operacional, que
   * esconde os vendidos; `true` = só os vendidos. O default é ausência de
   * propósito: a tela do dia a dia não deve carregar carro que saiu da frota.
   */
  sold?: boolean;
  type?: VehicleType | '';
  status?: VehicleStatus | '';
  sort?: string;
  page?: number;
  size?: number;
  /**
   * Filtro do picker de "novo aluguel": quando `true`, o backend exclui
   * veículos já vinculados a rentals RESERVED/ACTIVE do tenant.
   */
  availableForRental?: boolean;
  /**
   * Modo edição do rental: inclui o veículo do rental sendo editado mesmo
   * que ele esteja em uso (escape hatch para não sumir da lista).
   */
  includeCurrentRentalId?: string;
  /**
   * Período pretendido (`yyyy-MM-dd`) do aluguel sendo montado. Só tem efeito
   * junto de `availableForRental` — com ele, o backend esconde apenas os
   * veículos que COLIDEM com esse intervalo, liberando um carro alugado hoje
   * para uma reserva futura.
   *
   * Contrato do backend: mande os DOIS ou NENHUM — só uma das pontas é 400.
   * `periodEnd` é INCLUSIVO e não pode ser anterior a `periodStart`.
   */
  periodStart?: string;
  /** Fim do período pretendido, INCLUSIVO. Ver `periodStart`. */
  periodEnd?: string;
}

/**
 * Item from the fleet-wide financings listing endpoint (`GET /v1/financings`).
 * Backend denormalizes plate/brand/model for direct rendering.
 */
export interface FinancingListItem {
  id: string;
  createdDate: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  contractDate: string;
  purchasePrice: number;
  totalFinanced: number | null;
  installments: number | null;
  installmentAmount: number | null;
  status: FinancingStatus;
  paidOffDate: string | null;
  /**
   * Nº de parcelas em aberto vencidas — derivado no backend a partir de
   * `financing_installments`. `null` quando o financing ainda não tem
   * cronograma cadastrado (antigo, sem backfill).
   */
  overdueInstallments: number | null;
}

/**
 * Detailed financing view returned by `GET /v1/financings/{id}`.
 * Includes denormalized vehicle basics so the detail page renders in a single request.
 */
export interface FinancingDetail {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYearModel: number | null;
  contractDate: string;
  purchasePrice: number;
  downPayment: number | null;
  totalFinanced: number | null;
  installments: number | null;
  installmentAmount: number | null;
  status: FinancingStatus;
  paidOffDate: string | null;
  /**
   * Cronograma real vindo de `financing_installments` (V24). Vazio quando o
   * financing é antigo e não foi backfilleado — o UI deve tratar como "sem
   * cronograma disponível".
   */
  schedule: FinancingInstallment[];
}

export type FinancingInstallmentStatus = 'PAID' | 'OVERDUE' | 'PENDING';

/** Uma parcela real vinda de `financing_installments`. */
export interface FinancingInstallment {
  id: string;
  number: number;
  dueDate: string;
  amountCents: number;
  paidDate: string | null;
  paidAmountCents: number | null;
  status: FinancingInstallmentStatus;
}

export interface FinancingFilters {
  vehicleId?: string;
  status?: FinancingStatus | '';
  sort?: string;
  page?: number;
  size?: number;
}


// --------------------------------------------------------- anexos do veículo

/**
 * Espelha `VehicleDocumentKindEnum` (FEAT-0035, migration V68).
 *
 * São só DOIS tipos. A tabela aceita N linhas do mesmo kind: o CRLV é
 * reemitido a cada licenciamento, então o do ano passado e o deste ano
 * convivem. Não existe unicidade por tipo, e enviar um CRLV novo NÃO
 * substitui o anterior.
 */
export type VehicleDocumentKind = 'CRLV' | 'OTHER';

/** Espelha `VehicleDocumentDto`. Sem `storagePath`: o bucket é privado. */
export interface VehicleDocument {
  id: string;
  vehicleId: string;
  kind: VehicleDocumentKind;
  kindLabel: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdDate: string;
}

/** Espelha `VehicleDocumentUrlDto` — URL assinada de TTL curto. */
export interface VehicleDocumentUrl {
  url: string;
  expiresInSeconds: number;
}

/** Rótulos do backend (`VehicleDocumentKindEnum.label`), em pt-BR. */
export const VEHICLE_DOCUMENT_KIND_META: Record<VehicleDocumentKind, string> = {
  CRLV: 'CRLV',
  OTHER: 'Outro',
};

export const VEHICLE_DOCUMENT_KIND_OPTIONS: ReadonlyArray<{
  value: VehicleDocumentKind;
  label: string;
}> = (Object.keys(VEHICLE_DOCUMENT_KIND_META) as VehicleDocumentKind[]).map((value) => ({
  value,
  label: VEHICLE_DOCUMENT_KIND_META[value],
}));
