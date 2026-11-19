/**
 * Fornecedores e custos da plataforma (`/v1/admin/finance`, contrato
 * `2026-11-18_CONTRACT_admin-costs.md`). Ler pede `ver`; escrever pede `custo.gerir` (só o Dono).
 * Dinheiro em CENTAVOS inteiros; mês `yyyy-MM`; data `yyyy-MM-dd` (São Paulo).
 */

/** Espelha `PlatformVendorCategory` (V137). `OTHER` exige `categoryLabel`. */
export type PlatformVendorCategory =
  | 'FRONTEND'
  | 'BACKEND'
  | 'DATABASE'
  | 'EMAIL'
  | 'AI'
  /** Gasto para conquistar cliente: a base do CAC. */
  | 'ACQUISITION'
  | 'OTHER';

/** Fornecedor: só nome, categoria e se está ativo. O dia de cobrança mora no custo fixo. */
export interface PlatformVendor {
  id: string;
  name: string;
  category: PlatformVendorCategory;
  categoryLabel: string | null;
  active: boolean;
}

export interface PlatformVendorRequest {
  name: string;
  category: PlatformVendorCategory;
  categoryLabel: string | null;
  active?: boolean | null;
}

/** `SCHEDULED`: começa depois do mês corrente · `ACTIVE`: roda no mês corrente · `ENDED`: acabou antes. */
export type CostScheduleStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED';

/** Custo fixo: lança uma linha por mês de `startMonth` até `endMonth` (inclusive). */
export interface PlatformCostSchedule {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorCategory: PlatformVendorCategory;
  service: string;
  amountCents: number;
  /** 1..31; só define o vencimento da linha do mês (31 vira 30/11, 28/29 em fevereiro). */
  billingDay: number;
  startMonth: string;
  endMonth: string | null;
  status: CostScheduleStatus;
  /** O custo fixo que este substituiu ao mudar de valor ("a partir de"); a cadeia é o histórico de preço. */
  previousScheduleId: string | null;
  /** Só o último da cadeia aceita mudar valor, encerrar e editar (os outros respondem 409). */
  latest: boolean;
}

export interface PlatformCostScheduleRequest {
  vendorId: string;
  service: string;
  amountCents: number;
  billingDay: number;
  startMonth: string;
  endMonth: string | null;
}

export interface PlatformCostScheduleUpdate {
  service: string;
  billingDay: number;
}

export interface PlatformCostAmountChange {
  fromMonth: string;
  amountCents: number;
}

/** `endMonth` nulo reabre um custo fixo encerrado. */
export interface PlatformCostScheduleEnd {
  endMonth: string | null;
}

/** `FIXED` veio de um custo fixo · `ONE_OFF` foi digitado para o mês · `LEGACY` é anterior à V150. */
export type PlatformCostKind = 'FIXED' | 'ONE_OFF' | 'LEGACY';

/** Uma linha de um mês ("Lançamentos do mês"). */
export interface PlatformCost {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorCategory: PlatformVendorCategory;
  month: string;
  kind: PlatformCostKind;
  scheduleId: string | null;
  /** Nula na linha lançada à mão antes dos custos fixos (`LEGACY`). */
  description: string | null;
  amountCents: number;
  /** O valor do custo fixo neste mês; nulo fora de `FIXED`. */
  scheduleAmountCents: number | null;
  dueDate: string | null;
  /** Linha `FIXED` editada só neste mês: o custo fixo nunca mais a reescreve. */
  overridden: boolean;
  note: string | null;
}

export interface PlatformCostMonth {
  month: string;
  /** Nulo quando o mês não tem nenhuma linha ("sem custos", nunca zero). */
  totalCents: number | null;
  rows: PlatformCost[];
}

/** "Lançar custo avulso". */
export interface PlatformCostCreate {
  vendorId: string;
  month: string;
  description: string;
  amountCents: number;
  dueDate: string | null;
  note: string | null;
}

/** "Editar lançamento" (muda só este mês). `description` é ignorada em `FIXED`. */
export interface PlatformCostUpdate {
  amountCents: number;
  dueDate: string | null;
  note: string | null;
  description?: string | null;
}

export const VENDOR_CATEGORY_LABEL: Record<PlatformVendorCategory, string> = {
  FRONTEND: 'Site e app',
  BACKEND: 'Servidor',
  DATABASE: 'Banco de dados',
  EMAIL: 'E-mail',
  AI: 'Inteligência artificial',
  ACQUISITION: 'Aquisição de clientes',
  OTHER: 'Outro',
};
