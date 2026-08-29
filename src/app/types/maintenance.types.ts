export type MaintenanceType =
  | 'PREVENTIVE'
  | 'CORRECTIVE'
  | 'INSPECTION'
  | 'TIRE'
  | 'OIL'
  | 'OTHER';

export type MaintenanceStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'CANCELED';

import {
  MAINTENANCE_STATUS_FILTER_OPTIONS,
  MAINTENANCE_TYPE_FILTER_OPTIONS,
} from '../utils/status-maps';

/**
 * @deprecated Import `MAINTENANCE_TYPE_FILTER_OPTIONS` from
 * `utils/status-maps.ts` instead.
 */
export const MAINTENANCE_TYPE_OPTIONS = MAINTENANCE_TYPE_FILTER_OPTIONS;

/**
 * @deprecated Import `MAINTENANCE_STATUS_FILTER_OPTIONS` from
 * `utils/status-maps.ts` instead.
 */
export const MAINTENANCE_STATUS_OPTIONS = MAINTENANCE_STATUS_FILTER_OPTIONS;

export const MAINTENANCE_SORT_OPTIONS = [
  { value: 'service_date_desc', label: 'Serviço (recente)' },
  { value: 'service_date_asc', label: 'Serviço (antigo)' },
  { value: 'next_service_asc', label: 'Próximo serviço (próximo)' },
  { value: 'cost_desc', label: 'Custo (maior)' },
  { value: 'cost_asc', label: 'Custo (menor)' },
  { value: 'created_desc', label: 'Cadastro (recente)' },
  { value: 'created_asc', label: 'Cadastro (antigo)' },
] as const;

/**
 * Uma peça na RESPOSTA da manutenção.
 *
 * `totalCents` vem da coluna gerada no banco (`quantity * unit_price_cents`), nunca
 * de conta feita no cliente — a tela exibe o que foi gravado.
 *
 * `quantity` é fracionário: o backend guarda `NUMERIC(10,3)`, até 3 casas decimais
 * (3,5 litros de óleo é o caso motivador).
 */
export interface MaintenanceItem {
  id: string;
  /** Ordem de exibição, base 1. */
  position: number;
  name: string;
  /** Até 3 casas decimais. */
  quantity: number;
  unitPriceCents: number;
  /** Coluna gerada no banco — somente resposta. */
  totalCents: number;
}

/**
 * Uma peça no payload de criar/atualizar.
 *
 * **Não existe `totalCents` aqui** — informá-lo reabriria a divergência que a coluna
 * gerada tornou impossível. Os nomes destes atributos são contrato de erro: o backend
 * devolve `fieldErrors["items[<i>].<atributo>"]` e a tela posiciona a mensagem por eles.
 */
export interface MaintenanceItemRequest {
  name: string;
  /** Até 3 casas decimais. */
  quantity: number;
  unitPriceCents: number;
}

export interface MaintenanceListItem {
  id: string;
  vehicleId: string;
  type: MaintenanceType;
  description: string;
  /** ISO date */
  serviceDate: string;
  /** Null quando a manutenção não foi realizada (agendada/em andamento/cancelada). */
  hodometerReading: number | null;
  costCents: number;
  /** ISO date */
  nextServiceDate: string | null;
  status: MaintenanceStatus;
  /** ISO date-time */
  createdDate: string;
}

export interface Maintenance {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  companyId: string;
  vehicleId: string;
  type: MaintenanceType;
  description: string;
  serviceDate: string;
  /** Null quando a manutenção não foi realizada (agendada/em andamento/cancelada). */
  hodometerReading: number | null;
  /**
   * Total CALCULADO pelo backend: `peças + mão de obra − desconto + acréscimos`.
   * Somente resposta — saiu dos payloads de escrita.
   */
  costCents: number;
  /** Peças lançadas. Lista vazia é caso normal: manutenção só de mão de obra. */
  items: MaintenanceItem[];
  labourCostCents: number;
  discountCents: number;
  surchargeCents: number;
  /** Opcional mesmo quando `surchargeCents > 0`. */
  surchargeNote: string | null;
  provider: string | null;
  invoiceNumber: string | null;
  nextServiceDate: string | null;
  nextServiceHodometer: number | null;
  status: MaintenanceStatus;
  notes: string | null;
}

export interface CreateMaintenanceRequest {
  vehicleId: string;
  type: MaintenanceType;
  description: string;
  serviceDate: string;
  /** Obrigatório apenas quando `status === 'DONE'` (o backend rejeita com 400). */
  hodometerReading?: number | null;
  /**
   * Peças. OPCIONAL: manutenção só de mão de obra (alinhamento, revisão, lavagem) é
   * caso normal. Ausente ou vazio APAGA as peças — o PUT é full-replace.
   */
  items?: MaintenanceItemRequest[];
  /** Ausência é ZERO, não "não informado". */
  labourCostCents?: number;
  discountCents?: number;
  surchargeCents?: number;
  surchargeNote?: string | null;
  provider?: string | null;
  invoiceNumber?: string | null;
  nextServiceDate?: string | null;
  nextServiceHodometer?: number | null;
  /**
   * Sempre envie explicitamente: quando omitido o backend assume `DONE`
   * e volta a exigir `hodometerReading`.
   */
  status: MaintenanceStatus;
  notes?: string | null;
}

export interface UpdateMaintenanceRequest {
  type: MaintenanceType;
  description: string;
  serviceDate: string;
  /** Obrigatório apenas quando `status === 'DONE'` (o backend rejeita com 400). */
  hodometerReading?: number | null;
  /** Ausente ou vazio APAGA as peças — o PUT é full-replace. */
  items?: MaintenanceItemRequest[];
  labourCostCents?: number;
  discountCents?: number;
  surchargeCents?: number;
  surchargeNote?: string | null;
  provider?: string | null;
  invoiceNumber?: string | null;
  nextServiceDate?: string | null;
  nextServiceHodometer?: number | null;
  status: MaintenanceStatus;
  notes?: string | null;
}

/**
 * Corpo de `POST /maintenances/{id}/conclude`.
 *
 * O backend aceita o corpo vazio e cai na leitura já gravada, mas a UI **sempre**
 * envia `hodometerReading`: uma manutenção agendada costuma carregar uma leitura
 * planejada defasada, e omitir o campo dispararia o 400 de "hodômetro menor que
 * o atual do veículo". Quando enviada, a leitura sobrescreve a armazenada.
 */
export interface ConcludeMaintenanceRequest {
  hodometerReading?: number | null;
}

export interface MaintenanceFilters {
  vehicleId?: string;
  type?: MaintenanceType | '';
  status?: MaintenanceStatus | '';
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  size?: number;
}

/**
 * Espelha `MaintenanceDocumentKindEnum` (FEAT-0050, migration V70).
 *
 * São só DOIS tipos, por decisão de produto registrada no javadoc do enum:
 * orçamento, garantia, laudo e ordem de serviço foram oferecidos e RECUSADOS —
 * slot permanentemente vazio na tela é ruído. Um kind novo entra por migração,
 * não por constante nova aqui.
 *
 * A tabela aceita N linhas do mesmo kind e NÃO tem unicidade por tipo: peça e
 * serviço saem em notas diferentes e a mão de obra costuma ser faturada à
 * parte. Enviar uma nota nova NUNCA substitui a anterior.
 */
export type MaintenanceDocumentKind = 'NOTA_FISCAL' | 'OTHER';

/** Espelha `MaintenanceDocumentDto`. Sem `storagePath`: o bucket é privado. */
export interface MaintenanceDocument {
  id: string;
  maintenanceId: string;
  kind: MaintenanceDocumentKind;
  kindLabel: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdDate: string;
}

/** Espelha `MaintenanceDocumentUrlDto` — URL assinada de TTL curto. */
export interface MaintenanceDocumentUrl {
  url: string;
  expiresInSeconds: number;
}

/** Rótulos do backend (`MaintenanceDocumentKindEnum.label`), em pt-BR. */
export const MAINTENANCE_DOCUMENT_KIND_META: Record<MaintenanceDocumentKind, string> = {
  NOTA_FISCAL: 'Nota fiscal',
  OTHER: 'Outro',
};
