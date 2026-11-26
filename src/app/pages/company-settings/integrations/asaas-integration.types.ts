export type AsaasEnvironment = 'SANDBOX' | 'PRODUCTION';

/**
 * Veredito do webhook, vindo do backend. Distingue "sem conexão" de "conectado,
 * mas com o webhook quebrado" — o booleano `webhookAutoConfigured` não consegue.
 */
export type AsaasWebhookStatus = 'NOT_CONNECTED' | 'REGISTERED' | 'FAILED';

/**
 * Uma das chaves guardadas (uma por ambiente). Só vem para o PLATFORM_ADMIN, dentro
 * de `environments`; nunca carrega a chave em si.
 */
export interface AsaasEnvironmentCredential {
  environment: AsaasEnvironment;
  active: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  webhookAutoConfigured: boolean;
  webhookStatus: AsaasWebhookStatus;
  webhookFailureReason: string | null;
}

export interface AsaasIntegrationStatus {
  connected: boolean;
  /** Ambiente da chave ATIVA (a que o fluxo de cobrança usa). */
  environment: AsaasEnvironment | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  /**
   * True when the backend was able to auto-register the webhook in Asaas
   * during connect (no manual webhook-token entry required from the user).
   */
  webhookAutoConfigured?: boolean;
  /**
   * Fonte da verdade sobre o webhook. Opcional por tolerância a respostas
   * antigas: sem ele a tela cai em `webhookAutoConfigured`.
   */
  webhookStatus?: AsaasWebhookStatus;
  /**
   * Motivo da última recusa do Asaas. `null` com `webhookStatus = 'FAILED'` é
   * "não sabemos" (linha anterior ao registro do motivo) — a tela não inventa um.
   */
  webhookFailureReason?: string | null;
  /** Só PLATFORM_ADMIN (ausente para o resto): qual chave está ativa, `null` se nenhuma. */
  activeEnvironment?: AsaasEnvironment | null;
  /** Só PLATFORM_ADMIN: as chaves guardadas, uma por ambiente. */
  environments?: AsaasEnvironmentCredential[];
}

export interface ConnectAsaasRequest {
  accessToken: string;
  environment: AsaasEnvironment;
}

/** Códigos do `PUT .../active-environment` (corpo `code` do erro). */
export const ASAAS_SWITCH_CODES = {
  adminOnly: 'ASAAS_SWITCH_ADMIN_ONLY',
  openCharges: 'ASAAS_SWITCH_OPEN_CHARGES',
  targetNotConnected: 'ASAAS_SWITCH_TARGET_NOT_CONNECTED',
  concurrentChange: 'ASAAS_CONCURRENT_CHANGE',
} as const;

/* ------------------------------------------------------------------------------------------
 * GET .../asaas/overview — só leitura (contrato de 26/11, `2026-11-26_SPEC_integracao-asaas-pagina.md`).
 * Valores em centavos. Qualquer campo pode vir `null` quando não há dado: a tela esconde,
 * nunca inventa.
 * ---------------------------------------------------------------------------------------- */

/** Taxas da conta, como o Asaas informa. Campo `null` = o Asaas não informou. */
export interface AsaasFees {
  pixFixedCents: number | null;
  boletoFixedCents: number | null;
  cardPercent: number | null;
  cardFixedCents: number | null;
}

/**
 * O que vem do próprio Asaas (com a chave ativa). `null` inteiro quando o Asaas falhou. Se só
 * a leitura das taxas falhar, o bloco vem com o saldo e todos os campos de `fees` `null`.
 */
export interface AsaasAccountInfo {
  accountName: string | null;
  cpfCnpjMasked: string | null;
  balanceCents: number | null;
  fees: AsaasFees | null;
}

/** Por que o bloco `asaas` veio `null`. */
export type AsaasOverviewError = 'UNAVAILABLE' | 'UNAUTHORIZED';

/** Mês corrente no fuso do negócio; só cobranças que foram ao Asaas. */
export interface AsaasMonthSummary {
  sentCount: number;
  sentCents: number;
  paidCount: number;
  paidCents: number;
  overdueCount: number;
  overdueCents: number;
  /** Pagas pela confirmação do Asaas (webhook/sync), não marcadas à mão. */
  autoSettledCount: number;
  /** Sempre `null` hoje (o `netValue` do Asaas não é guardado); a linha "Pagas em …" some. */
  feesPaidCents: number | null;
}

/** A mesma régua da trava de troca de ambiente. */
export interface AsaasOpenCharges {
  charges: number;
  rentals: number;
}

export interface AsaasReceipt {
  /** `yyyy-MM-dd`. */
  paidAt: string;
  driverName: string | null;
  plate: string | null;
  /** "Semana 3", "Caução", "Acordo 1/3"… */
  chargeLabel: string | null;
  /**
   * Sempre `null` hoje: nenhuma coluna guarda a forma de pagamento usada. A tela não mostra
   * forma nenhuma (nem "Pix" presumido) enquanto o dado não existir.
   */
  method: string | null;
  amountCents: number;
  /** UUID do aluguel. */
  rentalId: string | null;
}

export interface AsaasOverview {
  asaas: AsaasAccountInfo | null;
  asaasError: AsaasOverviewError | null;
  month: AsaasMonthSummary | null;
  /**
   * Último aviso de pagamento do Asaas processado, horário de parede de Brasília SEM fuso
   * (`2026-11-26T11:22:00`): lido como texto, nunca convertido. `null` se nunca.
   */
  lastPaymentNoticeAt: string | null;
  /**
   * Pagamentos confirmados no Asaas ainda sem baixa. `null` sempre que o webhook não está
   * REGISTERED (aviso que não chegou não se conta) — então o aviso parado não tem número.
   */
  awaitingSettlementCount: number | null;
  openCharges: AsaasOpenCharges | null;
  /** Últimas pagas via Asaas, mais recente primeiro. */
  recentReceipts: AsaasReceipt[] | null;
}
