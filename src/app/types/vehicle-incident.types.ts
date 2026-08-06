/**
 * Sinistro (colisão, roubo, dano, pane) — espelho do módulo `incidents` do
 * backend. NÃO é multa: multa tem órgão emissor e pontuação na CNH; sinistro
 * tem seguradora, franquia, laudo e um veículo potencialmente parado.
 *
 * Os valores crus dos enums são os do backend
 * (`domain.enumerated.Incident*Enum`) — traduza só o `label`, nunca o valor.
 */

export type IncidentType =
  | 'COLLISION'
  | 'THEFT'
  | 'DAMAGE'
  | 'MECHANICAL_FAILURE'
  | 'OTHER';

export type IncidentFaultParty = 'DRIVER' | 'THIRD_PARTY' | 'UNKNOWN';

/** Ciclo OPERACIONAL — o que aconteceu com o VEÍCULO. */
export type IncidentResolutionStatus = 'OPEN' | 'IN_REPAIR' | 'RESOLVED' | 'WRITTEN_OFF';

/** Ciclo do PROCESSO com a seguradora. Independente do ciclo operacional. */
export type IncidentInsuranceStatus = 'NOT_FILED' | 'FILED' | 'APPROVED' | 'DENIED' | 'PAID';

export type IncidentDocumentKind =
  | 'DAMAGE_PHOTO'
  | 'POLICE_REPORT'
  | 'REPAIR_QUOTE'
  | 'INSURANCE_CLAIM'
  | 'OTHER';

// ---------------------------------------------------------------- wire shapes

/**
 * Linha da listagem consolidada. Enxuta DE PROPÓSITO: o backend mantém os dados
 * do terceiro (`thirdParty*`) fora daqui porque são dado pessoal — eles só saem
 * no detalhe, que é a leitura deliberada de um sinistro específico. Nada nesta
 * tela pode expor terceiro.
 */
export interface VehicleIncidentListItem {
  id: string;
  vehicleId: string;
  rentalId: string | null;
  driverId: string | null;
  incidentType: IncidentType;
  incidentTypeLabel: string;
  /** ISO date-time */
  occurredAt: string;
  location: string | null;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  resolutionStatus: IncidentResolutionStatus;
  resolutionStatusLabel: string;
  insuranceStatus: IncidentInsuranceStatus;
  insuranceStatusLabel: string;
  insuranceClaimNumber: string | null;
  createdDate: string;
}

/**
 * Sinistro completo. Carrega dado pessoal de terceiro — só renderize numa tela
 * de detalhe, nunca numa lista, e jamais mande para log/telemetria (LGPD).
 */
export interface VehicleIncident {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  companyId: string;
  vehicleId: string;
  rentalId: string | null;
  driverId: string | null;
  /** Apólice ATIVA no dia do registro, quando havia. Snapshot, não vínculo vivo. */
  insuranceId: string | null;

  incidentType: IncidentType;
  incidentTypeLabel: string;
  occurredAt: string;
  location: string | null;
  description: string;
  atFaultParty: IncidentFaultParty;

  estimatedCostCents: number | null;
  actualCostCents: number | null;
  deductibleCents: number | null;
  indemnifiedAmountCents: number | null;
  /** `actualCost + deductible - indenização`, piso zero. Calculado no backend. */
  netCostCents: number | null;

  insuranceClaimNumber: string | null;
  insuranceStatus: IncidentInsuranceStatus;
  insuranceStatusLabel: string;
  resolutionStatus: IncidentResolutionStatus;
  resolutionStatusLabel: string;
  resolvedAt: string | null;

  thirdPartyName: string | null;
  thirdPartyDocument: string | null;
  thirdPartyPhone: string | null;
  thirdPartyPlate: string | null;

  notes: string | null;

  /** Só na resposta de criação: `true` se o veículo foi mesmo para MAINTENANCE. */
  vehicleTakenOutOfService: boolean | null;
}

export interface VehicleIncidentSummary {
  openCount: number;
  inRepairCount: number;
  /** OPEN + IN_REPAIR — o número do card. */
  activeCount: number;
  writtenOffCount: number;
  totalEstimatedCostCents: number;
  totalActualCostCents: number;
  totalIndemnifiedCents: number;
  totalNetCostCents: number;
}

export interface IncidentDocument {
  id: string;
  incidentId: string;
  kind: IncidentDocumentKind;
  kindLabel: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdDate: string;
}

export interface IncidentDocumentUrl {
  url: string;
  expiresInSeconds: number;
}

// ------------------------------------------------------------------- requests

/**
 * Note o que NÃO está aqui: os dois status. Um sinistro nasce sempre
 * `OPEN` / `NOT_FILED` e só se move pelos endpoints de transição.
 */
export interface CreateVehicleIncidentRequest {
  vehicleId: string;
  rentalId?: string | null;
  driverId?: string | null;
  incidentType: IncidentType;
  /** ISO local date-time `yyyy-MM-ddTHH:mm:ss` — o backend recusa data futura. */
  occurredAt: string;
  location?: string | null;
  description: string;
  atFaultParty?: IncidentFaultParty | null;
  estimatedCostCents?: number | null;
  deductibleCents?: number | null;
  thirdPartyName?: string | null;
  thirdPartyDocument?: string | null;
  thirdPartyPhone?: string | null;
  thirdPartyPlate?: string | null;
  notes?: string | null;
  /** Opt-in: tenta AVAILABLE → MAINTENANCE. Nunca mexe num veículo RENTED. */
  takeVehicleOutOfService?: boolean | null;
}

/** Correção dos dados descritivos. Sem status e sem `vehicleId` — nem no backend. */
export type UpdateVehicleIncidentRequest = Omit<
  CreateVehicleIncidentRequest,
  'vehicleId' | 'takeVehicleOutOfService'
>;

export interface ChangeResolutionStatusRequest {
  status: IncidentResolutionStatus;
  /** Obrigatório para RESOLVED / WRITTEN_OFF quando ainda não gravado. */
  actualCostCents?: number | null;
  /** Anexada às notas do sinistro, não as substitui. */
  notes?: string | null;
}

export interface ChangeInsuranceStatusRequest {
  status: IncidentInsuranceStatus;
  /** Obrigatório para FILED quando ainda não gravado. */
  insuranceClaimNumber?: string | null;
  /** Obrigatório para PAID quando ainda não gravado. */
  indemnifiedAmountCents?: number | null;
  deductibleCents?: number | null;
}

export interface VehicleIncidentFilters {
  vehicleId?: string;
  driverId?: string;
  rentalId?: string;
  incidentType?: IncidentType | '';
  /** Aceita também o atalho `ACTIVE` = OPEN + IN_REPAIR numa chamada só. */
  resolutionStatus?: IncidentResolutionStatus | 'ACTIVE' | '';
  insuranceStatus?: IncidentInsuranceStatus | '';
  /** ISO date `yyyy-MM-dd` */
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  size?: number;
}

// ------------------------------------------------------- rótulos e aparência

/**
 * Metadados de exibição de um status.
 *
 * `icon` e `shape` existem para o requisito de AA: as duas dimensões NÃO podem
 * ser distinguíveis só por cor. O chip carrega sempre o rótulo textual, um
 * glifo próprio e — em `dimensionLabel` — a dimensão a que pertence, porque
 * confundir "Resolvido" (o carro) com "Indenizado" (o seguro) é exatamente o
 * erro que esta interface tem que impedir.
 */
export interface IncidentStatusMeta {
  label: string;
  /** Classes Tailwind (bg + text + border) — aplique via `[class]`. */
  chip: string;
  /** Glifo textual, redundante com a cor. Decorativo (`aria-hidden`). */
  icon: string;
  /** `true` quando não existe transição a partir daqui. */
  terminal: boolean;
}

/** Prefixo que amarra o rótulo à sua máquina de estado. */
export const RESOLUTION_DIMENSION_LABEL = 'Veículo';
export const INSURANCE_DIMENSION_LABEL = 'Seguro';

export const INCIDENT_RESOLUTION_META: Record<IncidentResolutionStatus, IncidentStatusMeta> = {
  OPEN: {
    label: 'Em aberto',
    chip: 'bg-amber-100 text-amber-900 border-amber-300',
    icon: '●',
    terminal: false,
  },
  IN_REPAIR: {
    label: 'Em reparo',
    chip: 'bg-blue-100 text-blue-900 border-blue-300',
    icon: '◐',
    terminal: false,
  },
  RESOLVED: {
    label: 'Resolvido',
    chip: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    icon: '✓',
    terminal: true,
  },
  WRITTEN_OFF: {
    label: 'Perda total',
    chip: 'bg-neutral-200 text-neutral-900 border-neutral-400',
    icon: '✕',
    terminal: true,
  },
};

export const INCIDENT_INSURANCE_META: Record<IncidentInsuranceStatus, IncidentStatusMeta> = {
  NOT_FILED: {
    label: 'Não acionado',
    chip: 'bg-neutral-100 text-neutral-800 border-neutral-300',
    icon: '—',
    terminal: false,
  },
  FILED: {
    label: 'Aberto na seguradora',
    chip: 'bg-indigo-100 text-indigo-900 border-indigo-300',
    icon: '▶',
    terminal: false,
  },
  APPROVED: {
    label: 'Aprovado',
    chip: 'bg-sky-100 text-sky-900 border-sky-300',
    icon: '✓',
    terminal: false,
  },
  DENIED: {
    label: 'Negado',
    chip: 'bg-rose-100 text-rose-900 border-rose-300',
    icon: '✕',
    terminal: true,
  },
  PAID: {
    label: 'Indenizado',
    chip: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    icon: '★',
    terminal: true,
  },
};

export const INCIDENT_TYPE_META: Record<IncidentType, string> = {
  COLLISION: 'Colisão',
  THEFT: 'Roubo/Furto',
  DAMAGE: 'Dano ao veículo',
  MECHANICAL_FAILURE: 'Falha mecânica',
  OTHER: 'Outro',
};

export const INCIDENT_FAULT_PARTY_META: Record<IncidentFaultParty, string> = {
  DRIVER: 'Motorista',
  THIRD_PARTY: 'Terceiro',
  UNKNOWN: 'Não apurado',
};

export const INCIDENT_DOCUMENT_KIND_META: Record<IncidentDocumentKind, string> = {
  DAMAGE_PHOTO: 'Foto do dano',
  POLICE_REPORT: 'Boletim de ocorrência',
  REPAIR_QUOTE: 'Orçamento de reparo',
  INSURANCE_CLAIM: 'Documento da seguradora',
  OTHER: 'Outro',
};

// ------------------------------------------------------- máquinas de estado

/**
 * Transições permitidas, espelhando `IncidentResolutionStatusEnum` e
 * `IncidentInsuranceStatusEnum`. A tela SÓ oferece o que está aqui — botão que
 * levaria a 409 não é oferecido.
 *
 * Nenhuma das duas tem marcha à ré: reabrir um sinistro encerrado é registro
 * novo, não edição do antigo.
 */
export const INCIDENT_RESOLUTION_TRANSITIONS: Record<
  IncidentResolutionStatus,
  readonly IncidentResolutionStatus[]
> = {
  OPEN: ['IN_REPAIR', 'RESOLVED', 'WRITTEN_OFF'],
  IN_REPAIR: ['RESOLVED', 'WRITTEN_OFF'],
  RESOLVED: [],
  WRITTEN_OFF: [],
};

export const INCIDENT_INSURANCE_TRANSITIONS: Record<
  IncidentInsuranceStatus,
  readonly IncidentInsuranceStatus[]
> = {
  NOT_FILED: ['FILED'],
  FILED: ['APPROVED', 'DENIED'],
  APPROVED: ['PAID'],
  DENIED: [],
  PAID: [],
};

/** Alvos que exigem o custo real — encerrar sem saber quanto custou esvazia o RCA. */
export function resolutionRequiresActualCost(target: IncidentResolutionStatus): boolean {
  return target === 'RESOLVED' || target === 'WRITTEN_OFF';
}

/** Acionar o seguro sem o número do sinistro é registro não rastreável. */
export function insuranceRequiresClaimNumber(target: IncidentInsuranceStatus): boolean {
  return target === 'FILED';
}

/** Marcar como indenizado sem o valor deixa a trilha financeira sem desfecho. */
export function insuranceRequiresIndemnified(target: IncidentInsuranceStatus): boolean {
  return target === 'PAID';
}

// ------------------------------------------------------------ opções de tela

export const INCIDENT_TYPE_OPTIONS: ReadonlyArray<{ value: IncidentType; label: string }> = (
  Object.keys(INCIDENT_TYPE_META) as IncidentType[]
).map((value) => ({ value, label: INCIDENT_TYPE_META[value] }));

export const INCIDENT_FAULT_PARTY_OPTIONS: ReadonlyArray<{
  value: IncidentFaultParty;
  label: string;
}> = (Object.keys(INCIDENT_FAULT_PARTY_META) as IncidentFaultParty[]).map((value) => ({
  value,
  label: INCIDENT_FAULT_PARTY_META[value],
}));

export const INCIDENT_DOCUMENT_KIND_OPTIONS: ReadonlyArray<{
  value: IncidentDocumentKind;
  label: string;
}> = (Object.keys(INCIDENT_DOCUMENT_KIND_META) as IncidentDocumentKind[]).map((value) => ({
  value,
  label: INCIDENT_DOCUMENT_KIND_META[value],
}));

/** `ACTIVE` primeiro: é o recorte que a locadora abre a tela para ver. */
export const INCIDENT_RESOLUTION_FILTER_OPTIONS: ReadonlyArray<{
  value: IncidentResolutionStatus | 'ACTIVE' | '';
  label: string;
}> = [
  { value: '', label: 'Todos' },
  { value: 'ACTIVE', label: 'Em aberto + em reparo' },
  { value: 'OPEN', label: INCIDENT_RESOLUTION_META.OPEN.label },
  { value: 'IN_REPAIR', label: INCIDENT_RESOLUTION_META.IN_REPAIR.label },
  { value: 'RESOLVED', label: INCIDENT_RESOLUTION_META.RESOLVED.label },
  { value: 'WRITTEN_OFF', label: INCIDENT_RESOLUTION_META.WRITTEN_OFF.label },
];

export const INCIDENT_INSURANCE_FILTER_OPTIONS: ReadonlyArray<{
  value: IncidentInsuranceStatus | '';
  label: string;
}> = [
  { value: '', label: 'Todos' },
  ...(Object.keys(INCIDENT_INSURANCE_META) as IncidentInsuranceStatus[]).map((value) => ({
    value,
    label: INCIDENT_INSURANCE_META[value].label,
  })),
];

export const INCIDENT_TYPE_FILTER_OPTIONS: ReadonlyArray<{
  value: IncidentType | '';
  label: string;
}> = [{ value: '', label: 'Todos' }, ...INCIDENT_TYPE_OPTIONS];

export const INCIDENT_SORT_OPTIONS = [
  { value: 'occurred_desc', label: 'Ocorrência (recente)' },
  { value: 'occurred_asc', label: 'Ocorrência (antiga)' },
  { value: 'created_desc', label: 'Cadastro (recente)' },
  { value: 'created_asc', label: 'Cadastro (antigo)' },
  { value: 'estimated_cost_desc', label: 'Custo estimado (maior)' },
  { value: 'actual_cost_desc', label: 'Custo real (maior)' },
] as const;
