export type ChargeProvider = 'asaas' | 'abacatepay';
export type ChargeEnvironment = 'SANDBOX' | 'PRODUCTION';

export interface ChargeIntegrationStatus {
  connected: boolean;
  provider: ChargeProvider | null;
  environment: ChargeEnvironment | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  webhookAutoConfigured: boolean;
}

export interface ConnectChargeIntegrationRequest {
  provider: ChargeProvider;
  accessToken: string;
  environment: ChargeEnvironment;
}
