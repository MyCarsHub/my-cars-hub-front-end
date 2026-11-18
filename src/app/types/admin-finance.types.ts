/**
 * Fornecedores e custo mensal da plataforma (backend FEAT-0460, `/v1/admin/finance`).
 * Ler pede `ver`; escrever pede `custo.gerir` (só o Dono).
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

export interface PlatformVendor {
  id: string;
  name: string;
  category: PlatformVendorCategory;
  categoryLabel: string | null;
  /** Dia do mês em que o fornecedor cobra (1..31); nulo = ninguém informou. */
  billingDay: number | null;
  active: boolean;
}

export interface PlatformVendorRequest {
  name: string;
  category: PlatformVendorCategory;
  categoryLabel: string | null;
  billingDay: number | null;
  active?: boolean | null;
}

/** Lançamento de UM fornecedor em UM mês. `month` = `yyyy-MM`. */
export interface PlatformCost {
  id: string;
  vendorId: string;
  month: string;
  amountCents: number;
  note: string | null;
}

export interface PlatformCostRequest {
  amountCents: number;
  note: string | null;
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
