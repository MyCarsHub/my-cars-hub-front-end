/**
 * Statuses the frontend knows how to render. Anything else is still accepted
 * at runtime (see `SubscriptionStatus`) so a new backend status degrades to a
 * neutral pill instead of blanking the UI.
 *
 * `PENDING` / `INCOMPLETE` are NOT producible by the current backend — the
 * CHECK constraint of migration V8 allows only TRIALING / ACTIVE / PAST_DUE /
 * CANCELED / EXPIRED. They are kept deliberately as forward-compat: Stripe's
 * own subscription lifecycle has `incomplete`, so the day the webhook mapper
 * stops collapsing it, the UI already labels and colours it instead of falling
 * into "Status desconhecido". Cost is two dead `case` branches; the benefit is
 * never shipping an unlabelled status to a paying customer.
 */
export type KnownSubscriptionStatus =
  | 'PENDING'
  | 'INCOMPLETE'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'PAUSED'
  | 'CANCELED'
  | 'EXPIRED';

/**
 * Open union: keeps autocomplete for the known set while forcing every
 * `switch` over a status to carry a `default` branch.
 */
export type SubscriptionStatus = KnownSubscriptionStatus | (string & {});

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export type PlanPeriod = 'MONTHLY' | 'YEARLY';

export type PlanGateway = 'stripe' | 'abacate';

/**
 * Flat plan row from the backend — one row per (name, period, gateway) triple.
 * `code` is the fully qualified variant identifier (e.g. `PRO_MONTHLY_STRIPE`).
 */
export interface PlanResponse {
  id: string;
  code: string;
  name: string;
  period: PlanPeriod;
  price: number;
  vehicleLimit: number | null;
  /**
   * `driverLimit` NÃO existe mais nesta resposta (FEAT-0070): o teto de
   * motoristas virou guarda-corpo interno e o backend o removeu das projeções
   * públicas de plano — inclusive do `GET /v1/plans/findAll`, que é anônimo.
   * Reintroduzir o campo aqui é reintroduzir o vazamento.
   */
  trialDays: number;
  productExternalId: string | null;
  gateway: PlanGateway;
  /** V127 — "Sob consulta": contato, nunca checkout (hoje o ENTERPRISE). */
  contactOnly?: boolean;
  /**
   * V127 — o checkout aceita este plano agora. `false` num plano pago e não-contato
   * = "em breve" (o Price do Stripe ainda não foi configurado pelo dono).
   * Ausente (backend antigo) conta como comprável.
   */
  purchasable?: boolean;
}

export interface SubscriptionResponse {
  id: string;
  planCode: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  externalId: string | null;
  /**
   * Checkout started but NOT paid. Must never be presented as the plan in
   * force — render it as "aguardando confirmação do pagamento" instead.
   * Optional: older backends omit it.
   */
  pendingPlanCode?: string | null;
  /** Plan the subscription drops to at the end of the paid period. */
  scheduledDowngradePlanCode?: string | null;
  /** ISO datetime when the scheduled downgrade takes effect. */
  scheduledDowngradeAt?: string | null;
}

export type GatewayOverride = PlanGateway;

export interface CheckoutRequest {
  planCode: string;
  gatewayOverride?: GatewayOverride;
}

export interface CheckoutResponse {
  redirectUrl: string;
  externalId: string;
}

/** Body of `POST /billing/downgrade`. Omit `planCode` to fall back to free. */
export interface DowngradeRequest {
  planCode?: string;
}

/**
 * `SCHEDULED` — takes effect at `effectiveAt` (end of the paid period).
 * `APPLIED`   — took effect NOW, `effectiveAt` is `null`. Only reachable from
 *               CANCELED / EXPIRED, where there is no paid period left to wait
 *               out: the account is put back on the free plan as ACTIVE
 *               immediately, which also unblocks access.
 */
export type SubscriptionChangeOutcome = 'SCHEDULED' | 'APPLIED' | 'NO_OP' | 'REACTIVATED';

/** Shared 200 shape of `POST /billing/downgrade` and `/billing/reactivate`. */
export interface SubscriptionChangeResponse {
  outcome: SubscriptionChangeOutcome;
  currentPlanCode: string | null;
  targetPlanCode: string | null;
  effectiveAt: string | null;
  message: string | null;
}

/**
 * `GET /billing/plan-change`: como este plano pode ser contratado por quem já tem
 * a assinatura. O servidor decide; a página só ramifica.
 */
export type PlanChangeMode = 'IN_PLACE' | 'CHECKOUT' | 'BLOCKED';

export type PlanChangeReason =
  | 'NO_PAID_SUBSCRIPTION'
  | 'NOT_ACTIVE'
  | 'INTERVAL_CHANGE'
  | 'YEARLY_PLAN'
  | 'LOWER_PLAN'
  | 'ALREADY_ON_PLAN'
  | 'PLAN_NOT_AVAILABLE'
  | 'DOWNGRADE_SCHEDULED'
  | 'CANCELLATION_SCHEDULED'
  | 'DOWNGRADE_LOCKED_UNTIL_PAID';

export interface PlanChangePreview {
  mode: PlanChangeMode;
  reasonCode: PlanChangeReason | null;
  /** Texto pronto para a tela quando `BLOCKED`. */
  message: string | null;
  currentPlanCode: string | null;
  planCode: string;
  planName: string;
  /** Os três abaixo só vêm em `IN_PLACE`. */
  amountTodayCents: number | null;
  listAmountCents: number;
  nextChargeAt: string | null;
  nextAmountCents: number | null;
}

/** `APPLIED`, ou `NO_OP` no clique repetido: o plano já é o destino. */
export interface PlanUpgradeResponse {
  outcome: 'APPLIED' | 'NO_OP';
  planCode: string;
  planName: string;
  amountTodayCents: number;
  nextChargeAt: string | null;
  nextAmountCents: number | null;
  message: string | null;
}

/** Estado da página Assinatura, derivado do veredito de acesso no backend. */
export type BillingState =
  | 'ACTIVE'
  | 'TRIALING'
  | 'TRIAL_EXPIRED'
  | 'PAST_DUE'
  | 'BLOCKED'
  | 'CANCELED'
  | 'NONE';

export type BillingAction =
  | 'PAY_NOW'
  | 'UPDATE_CARD'
  | 'CHANGE_PLAN'
  | 'CANCEL'
  | 'REACTIVATE'
  | 'SUBSCRIBE';

/** Datas são LocalDateTime do servidor em UTC, sem sufixo de zona — leia com `parseServerTime`. */
export interface BillingSummary {
  state: BillingState;
  canManage: boolean;
  plan: {
    code: string;
    name: string;
    period: PlanPeriod;
    price: number;
    vehicleLimit: number | null;
    contactOnly: boolean;
  } | null;
  usage: { vehicles: number; vehicleLimit: number | null };
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanCode: string | null;
  scheduledDowngradePlanCode: string | null;
  scheduledDowngradeAt: string | null;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  amountDueCents: number | null;
  openInvoice: { ref: string; amountCents: number; createdAt: string | null; payUrl: string | null } | null;
  paymentMethod: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null;
  lastFailure: { code: string | null; message: string; at: string | null } | null;
  invoices: BillingInvoice[];
  actions: BillingAction[];
  payWith: string[];
  providerDetailsAvailable: boolean;
}

export interface BillingInvoice {
  ref: string;
  number: string | null;
  createdAt: string | null;
  amountCents: number;
  status: 'PAID' | 'OPEN' | 'VOID' | 'UNCOLLECTIBLE' | (string & {});
  cardBrand: string | null;
  cardLast4: string | null;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

/**
 * `POST /billing/open-invoice/pix` — the Pix of the subscription's OPEN invoice.
 * Re-opening while the code is alive returns the same code (idempotent). Errors:
 * 409 no open invoice, 403 read-only/non-owner, 429 too many codes, 404 Pix off.
 */
export interface SubscriptionPix {
  attemptId: string;
  status: 'PENDING';
  /** The EMV "copia e cola" string. */
  payload: string;
  /** PNG of the QR code, base64 without the `data:` prefix. `null` when the server could not fetch it. */
  qrCodeBase64: string | null;
  /** ISO instant (with `Z`) when the code stops being accepted. */
  expiresAt: string;
  amountCents: number;
  /** Stripe's own instructions page — the fallback when there is no QR image. */
  hostedInstructionsUrl: string | null;
}

export type SubscriptionPixStatusCode =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'SETTLED'
  | 'EXPIRED'
  | 'CANCELED'
  | 'REFUNDING'
  | 'REFUNDED';

/**
 * `GET /billing/open-invoice/pix/{attemptId}` — reads our database; the server
 * re-checks Stripe itself (throttled), so asking again IS the "Já paguei".
 */
export interface SubscriptionPixStatus {
  attemptId: string;
  status: SubscriptionPixStatusCode;
  expiresAt: string;
  amountCents: number;
  /** The paid invoice already restored access (the `invoice.paid` funnel ran). */
  accessReleased: boolean;
}
