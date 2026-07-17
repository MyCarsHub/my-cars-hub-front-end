export type AsaasEnvironment = 'SANDBOX' | 'PRODUCTION';

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
}

export interface ConnectAsaasRequest {
  accessToken: string;
  environment: AsaasEnvironment;
}
