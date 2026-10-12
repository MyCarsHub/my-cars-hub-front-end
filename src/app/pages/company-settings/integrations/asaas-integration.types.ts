export type AsaasEnvironment = 'SANDBOX' | 'PRODUCTION';

/**
 * Veredito do webhook, vindo do backend. Distingue "sem conexão" de "conectado,
 * mas com o webhook quebrado" — o booleano `webhookAutoConfigured` não consegue.
 */
export type AsaasWebhookStatus = 'NOT_CONNECTED' | 'REGISTERED' | 'FAILED';

export interface AsaasIntegrationStatus {
  connected: boolean;
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
}

export interface ConnectAsaasRequest {
  accessToken: string;
  environment: AsaasEnvironment;
}
