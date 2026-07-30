/**
 * Central de notificações + alertas de vencimento de documentos.
 *
 * NÃO confundir com `services/notification.service.ts`, que é o barramento de
 * TOASTS da aplicação. Aqui o domínio é o feed persistido no backend:
 *
 * - `GET   /v1/notifications?unreadOnly&page&size`
 * - `GET   /v1/notifications/unread-count`
 * - `PATCH /v1/notifications/{id}/read`
 * - `PATCH /v1/notifications/read-all`
 * - `GET   /v1/alerts/documents?withinDays=30`
 *
 * Datas trafegam em ISO (`yyyy-MM-dd` para vencimentos, ISO completo para
 * `createdAt`).
 */

export type NotificationType =
  'CNH_DUE_SOON' | 'LICENSING_DUE_SOON' | 'INSURANCE_DUE_SOON' | 'FINANCING_INSTALLMENT_DUE';

export type NotificationSeverity = 'INFO' | 'WARNING' | 'DANGER';

/** Item do feed (`GET /v1/notifications`). */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  typeLabel: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  /** `yyyy-MM-dd` do vencimento que originou a notificação. */
  dueDate: string | null;
  /** Já é uma rota do frontend — navegar direto, sem remontar. */
  actionUrl: string;
  read: boolean;
  createdAt: string;
}

/** Resposta de `GET /v1/notifications/unread-count`. */
export interface UnreadCount {
  count: number;
}

/** Resposta de `PATCH /v1/notifications/read-all` — linhas marcadas AGORA. */
export interface MarkAllReadResult {
  count: number;
}

/**
 * Item de `GET /v1/alerts/documents` — lista PLANA ordenada por `dueDate` asc.
 * Inclui itens já vencidos, com `daysRemaining` negativo.
 */
export interface DocumentAlert {
  type: NotificationType;
  typeLabel: string;
  severity: NotificationSeverity;
  title: string;
  subtitle: string;
  entityType: string;
  entityId: string;
  /** `yyyy-MM-dd`. */
  dueDate: string;
  /** Negativo = já vencido. */
  daysRemaining: number;
  actionUrl: string;
}

/** Janelas aceitas pelo seletor de `withinDays` da página `/alertas`. */
export type AlertWindow = 1 | 7 | 15 | 30;

/**
 * Teto silencioso do backend em `GET /v1/alerts/documents`. Quando a resposta
 * vem com exatamente esse tamanho a lista pode estar truncada.
 */
export const DOCUMENT_ALERTS_CAP = 200;
