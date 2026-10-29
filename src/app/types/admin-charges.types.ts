/** Abas da página Cobranças. Só leitura no P0 ("atrasado é nossa prova"). */
export type AdminChargeTab = 'FAILED' | 'OVERDUE';

export interface AdminChargeListItem {
  chargeId: string;
  rentalId: string;
  rentalStatus: string;
  kind: string;
  status: string;
  /** Centavos. */
  amountCents: number;
  /** yyyy-MM-dd */
  dueDate: string | null;
  /** Dias desde o vencimento (BRT); negativo = ainda vai vencer. */
  daysOverdue: number;
  failureCode: string | null;
  /** Motivo do gateway, saneado no servidor. */
  failureReason: string | null;
  companyId: string;
  companyName: string;
  companyInternal: boolean;
  driverId: string | null;
  driverName: string | null;
  /** Só mascarado; o WhatsApp pede o número ao endpoint auditado (DRIVER). */
  driverPhoneMasked: string | null;
}

export interface AdminChargesPage {
  tab: AdminChargeTab;
  includeInternal: boolean;
  content: AdminChargeListItem[];
  page: number;
  size: number;
  total: number;
  failedCount: number;
  overdueCount: number;
}

/** Uma empresa em "Converter testes" (D5). */
export interface TrialConversionItem {
  companyId: string;
  companyName: string;
  companyStatus: string;
  internal: boolean;
  signupAt: string | null;
  trialEndsAt: string | null;
  /** Negativo = o teste ainda acaba em N dias. */
  daysSinceTrialEnd: number;
  subscriptionStatus: string | null;
  planName: string | null;
  vehicles: number;
  drivers: number;
  rentals: number;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  /** 3 aluguel · 2 motorista · 1 veículo · 0 nada. */
  activationStage: number;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerPhoneMasked: string | null;
}
