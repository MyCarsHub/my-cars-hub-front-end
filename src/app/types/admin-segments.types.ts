/**
 * Segmentos de empresa, "Hoje, para agir" e registro de contato (admin, 18/11/2026).
 *
 * Espelho do contrato `2026-11-18_CONTRACT_admin-segments.md` (backend `feat/admin-segments`,
 * pacote `admin.segments.dto`). Instantes chegam em ISO-8601 UTC; datas de calendário
 * (`followUpDate`, `hiddenUntil`, `today`) são o dia de Brasília (`yyyy-MM-dd`).
 */

export type CompanySegment =
  | 'PAYING_COOLING'
  | 'PAYING_ONBOARDING'
  | 'PAYING_ACTIVE'
  | 'TRIAL_ACTIVATING'
  | 'TRIAL_STALLED'
  | 'TRIAL_EXPIRED_ACTIVATED'
  | 'NO_ACTIVATION'
  | 'EX_CLIENT';

/** As oito, na ordem das pílulas da tela (a ordem do desenho de 18/11). */
export const COMPANY_SEGMENTS: readonly CompanySegment[] = [
  'PAYING_ACTIVE',
  'PAYING_ONBOARDING',
  'PAYING_COOLING',
  'TRIAL_ACTIVATING',
  'TRIAL_STALLED',
  'TRIAL_EXPIRED_ACTIVATED',
  'NO_ACTIVATION',
  'EX_CLIENT',
];

export type SegmentReason =
  | 'NO_RECENT_SIGNAL'
  | 'PAST_DUE'
  | 'CANCEL_AT_PERIOD_END'
  | 'ACTIVE_RENTALS_DROPPED'
  | 'PAYING_WITHOUT_ACTIVE_RENTAL'
  | 'FIRST_RENTAL_PENDING'
  | 'RECENT_SIGNAL'
  | 'TRIAL_ENDED_RECENTLY'
  | 'TRIAL_ENDED_LONG_AGO'
  | 'STOPPED_PAYING';

export type CompanyProgress = 'SIGNUP_ONLY' | 'VEHICLE' | 'DRIVER' | 'RENTAL';

export type NextActionKey =
  | 'NONE'
  | 'ANSWER_SUPPORT'
  | 'OFFER_TRIAL_EXTENSION'
  | 'HELP_FIRST_VEHICLE'
  | 'HELP_FIRST_RENTAL'
  | 'CONVERT_TO_PAID'
  | 'REENGAGE_PAYING'
  | 'CHECK_IN'
  | 'LAST_ATTEMPT_OFFER'
  | 'REOPEN_TRIAL'
  | 'CAMPAIGN_ONLY'
  | 'ASK_WHY_LEFT'
  | 'FOLLOW_UP';

export type LastActionKind =
  | 'VEHICLE_CREATED'
  | 'DRIVER_CREATED'
  | 'RENTAL_CREATED'
  | 'CONTRACT_CREATED'
  | 'INSPECTION_CREATED'
  | 'MAINTENANCE_CREATED'
  | 'RENTAL_STATUS_CHANGED'
  | 'CHARGE_CANCELED'
  | 'SUPPORT_TICKET_OPENED';

export type DeadlineKind = 'TRIAL_ENDS' | 'TRIAL_ENDED' | 'RENEWAL';

export type ContactLogChannel = 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'IN_PERSON';

export type ContactLogResult = 'ANSWERED' | 'NO_ANSWER' | 'WILL_SUBSCRIBE' | 'NOT_INTERESTED';

export type TodayStatus =
  | 'LISTED'
  | 'HIDDEN_UNTIL_DATE'
  | 'HIDDEN_UNTIL_SEGMENT_CHANGES'
  | 'NOT_INTERESTED'
  | 'NOT_ELIGIBLE'
  | 'INTERNAL';

export interface EngagementLastContact {
  id: string;
  contactedAt: string;
  channel: ContactLogChannel;
  result: ContactLogResult;
  /** `yyyy-MM-dd` (Brasília); nulo = "Sem retorno". */
  followUpDate: string | null;
  createdByName: string | null;
}

/** Objeto `engagement` (§2): o mesmo na lista, em "Hoje" e no detalhe. */
export interface CompanyEngagement {
  /** Nulo só em empresa interna. */
  segment: CompanySegment | null;
  segmentReasons: SegmentReason[];
  recent: boolean | null;
  progress: CompanyProgress | null;
  lastAction: { kind: LastActionKind; at: string } | null;
  lastAccessAt: string | null;
  lastSignalAt: string | null;
  deadline: { kind: DeadlineKind; at: string } | null;
  fleet: { vehicles: number; drivers: number; rentals: number; activeRentals: number } | null;
  openSupportTickets: number;
  retentionEmailOptOut: boolean;
  /** Nulo em empresa interna. `reason` é um motivo de §1.2 ou um dos motivos próprios de §1.4. */
  nextAction: { key: NextActionKey; reason: string } | null;
  lastContact: EngagementLastContact | null;
  today: { status: TodayStatus; listedReason: 'SEGMENT' | 'FOLLOW_UP_DUE' | null; hiddenUntil: string | null };
}

/** `segmentCounts` de `GET /admin/companies`: as oito chaves mais `ALL`, sempre presentes. */
export type SegmentCounts = Partial<Record<CompanySegment | 'ALL', number>>;

export interface TodayItem {
  rank: number;
  companyId: string;
  name: string;
  ownerName: string | null;
  engagement: CompanyEngagement;
}

export interface SnoozedItem {
  companyId: string;
  name: string;
  ownerName: string | null;
  engagement: CompanyEngagement;
}

/** `GET /admin/companies/today`. */
export interface TodayList {
  today: string;
  generatedAt: string;
  items: TodayItem[];
  snoozed: SnoozedItem[];
  notInterestedCount: number;
}

export type ActivityFilter = 'ALL' | 'ACTION' | 'CONTACT' | 'SUBSCRIPTION';

export type ActivityCategory = 'ACTION' | 'ACCESS' | 'CONTACT' | 'SUBSCRIPTION' | 'SIGNUP';

export interface ActivityContact {
  id: string;
  contactedAt: string;
  channel: ContactLogChannel;
  result: ContactLogResult;
  note: string | null;
  followUpDate: string | null;
  createdByName: string | null;
}

export interface ActivitySubscriptionChange {
  fromStatus: string | null;
  toStatus: string | null;
  fromPlanCode: string | null;
  toPlanCode: string | null;
  source: string | null;
}

/** Um item da atividade (§3.5). Ações vêm agrupadas por dia e tipo: `count` diz quantas. */
export interface ActivityItem {
  at: string;
  category: ActivityCategory;
  /** `ACCESSED`, `CONTACT_LOGGED`, `SUBSCRIPTION_CHANGED`, `COMPANY_CREATED` ou um `LastActionKind`. */
  kind: string;
  count: number;
  contact: ActivityContact | null;
  subscription: ActivitySubscriptionChange | null;
}

export interface CompanyContact {
  id: string;
  companyId: string;
  channel: ContactLogChannel;
  result: ContactLogResult;
  note: string | null;
  followUpDate: string | null;
  contactedAt: string;
  createdAt: string;
  createdById: string | null;
  createdByName: string | null;
  segmentAtContact: CompanySegment | null;
}

export type ContactExtendReason = 'NEGOTIATION' | 'ONBOARDING' | 'TECHNICAL_ISSUE' | 'GOODWILL' | 'OTHER';

/** `POST /admin/companies/{id}/contacts`. Campos opcionais ficam FORA do corpo quando vazios. */
export interface RegisterContactRequest {
  channel: ContactLogChannel;
  result: ContactLogResult;
  note?: string;
  followUpDate?: string;
  contactedAt?: string;
  extendTrialDays?: number;
  extendTrialReason?: ContactExtendReason;
}

export interface RegisterContactResponse {
  contact: CompanyContact;
  trialExtension: {
    companyId: string;
    days: number;
    previousStatus: string;
    status: string;
    trialEndsAt: string;
    emailRecipients: number;
  } | null;
  engagement: CompanyEngagement;
}
