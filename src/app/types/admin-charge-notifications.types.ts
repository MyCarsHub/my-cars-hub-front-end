/**
 * Aba Notificações do painel admin — `GET/POST /v1/admin/charge-notifications/**`.
 *
 * Os estados (`state`) são vocabulário do backend; a tela usa os `label`/`reason`
 * que já chegam em pt-BR e só escolhe a cor pelo estado.
 */

export interface ChargeNotificationSummary {
  due: number;
  notified: number;
  notNotified: number;
}

export interface ChargeNotificationCompanySummary extends ChargeNotificationSummary {
  companyId: string;
  companyName: string;
  internal: boolean;
}

export interface ChargeEmailStatus {
  /** SENT | BOUNCED | FAILED | SKIPPED | CLAIMED | NOT_RECORDED */
  state: string;
  providerConfirmed: boolean;
  label: string;
  reason: string | null;
  attempts: number | null;
  finishedAt: string | null;
}

export interface ChargeAsaasStatus {
  /** CONFIGURED | PARTIAL | FAILED | NEVER | NO_CUSTOMER | NOT_APPLICABLE */
  state: string;
  label: string;
  dueDayOn: boolean;
  overdueD1On: boolean;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  outdatedPolicy: boolean;
  reason: string | null;
  lastAttemptAt: string | null;
}

export interface ChargeLastResend {
  requestedAt: string;
  /** CLAIMED | SENT | FAILED */
  outcome: string;
  providerConfirmed: boolean;
  requestedByName: string | null;
}

export interface ChargeNotificationItem {
  chargeId: string;
  companyId: string;
  companyName: string;
  companyInternal: boolean;
  driverFirstName: string;
  driverEmailMasked: string | null;
  amountCents: number | null;
  dueDate: string;
  chargeStatus: string;
  email: ChargeEmailStatus;
  asaas: ChargeAsaasStatus;
  lastResend: ChargeLastResend | null;
  notified: boolean;
  notNotifiedReason: string | null;
  resend: { allowed: boolean; blockedReason: string | null };
}

export interface ChargeNotificationDay {
  date: string;
  today: boolean;
  summary: ChargeNotificationSummary;
  companies: ChargeNotificationCompanySummary[];
  items: ChargeNotificationItem[];
  truncated: boolean;
}

export interface AsaasNotificationDriver {
  companyId: string;
  companyName: string;
  companyInternal: boolean;
  driverFirstName: string;
  state: string;
  label: string;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  reason: string | null;
  lastAttemptAt: string | null;
}

export interface AsaasNotificationsOverview {
  activeDrivers: number;
  configured: number;
  notConfigured: number;
  withoutWhatsapp: number;
  policyVersion: number;
  failures: AsaasNotificationDriver[];
  withoutWhatsappDrivers: AsaasNotificationDriver[];
}

export interface ChargeEmailResendResult {
  chargeId: string;
  /** SENT | FAILED */
  outcome: string;
  providerConfirmed: boolean;
  requestedAt: string | null;
  message: string;
}

export interface ChargeNotificationsQuery {
  /** `YYYY-MM-DD`; ausente = hoje (fuso de Brasília, decidido no backend). */
  date?: string | null;
  companyId?: string | null;
  onlyNotNotified?: boolean;
}
