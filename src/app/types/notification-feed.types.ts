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
 * - `GET   /v1/alerts/documents?withinDays&page&size`
 *
 * O estado de leitura das notificações é **por usuário**: `read`,
 * `unread-count`, `PATCH /{id}/read` e `PATCH /read-all` respondem sempre pelo
 * usuário do token. Dois membros da mesma empresa têm sinos independentes, e
 * remarcar algo já lido responde sucesso sem renovar a data de leitura.
 *
 * Datas trafegam em ISO (`yyyy-MM-dd` para vencimentos, ISO completo para
 * `createdAt`).
 */

export type NotificationType =
  | 'CNH_DUE_SOON'
  | 'LICENSING_DUE_SOON'
  | 'INSURANCE_DUE_SOON'
  | 'FINANCING_INSTALLMENT_DUE'
  | 'IPVA_DUE_SOON';

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

/**
 * Resposta de `PATCH /v1/notifications/read-all` — linhas marcadas AGORA para
 * o usuário do token, não o total da empresa.
 */
export interface MarkAllReadResult {
  count: number;
}

/**
 * Item de `GET /v1/alerts/documents`, que devolve o envelope paginado padrão
 * (`PagedResponse<DocumentAlert>` — `content` / `page` / `size` / `total`),
 * ordenado por `dueDate` asc. Inclui itens já vencidos, com `daysRemaining`
 * negativo.
 *
 * `daysRemaining` é calculado no backend contra o "hoje" em **UTC**. Entre 21h
 * e a meia-noite no horário de Brasília um vencimento de amanhã chega como
 * `0`. A UI NÃO compensa esse offset (as duas pontas divergiriam) — ela mostra
 * a data junto do rótulo para que "vence hoje" seja sempre verificável.
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

/**
 * Janela de `withinDays` em dias.
 *
 * Deixou de ser a união fixa `1 | 7 | 15 | 30`: as janelas são configuráveis por
 * empresa (`GET /v1/companies/current/alert-settings`), dentro dos limites que a
 * própria resposta declara (`minWindowDays` … `maxWindowDays`). O alias fica
 * como nome do conceito — quem valida o intervalo é o servidor.
 */
export type AlertWindow = number;

/**
 * Tamanho de página pedido por `/alertas`. Bem abaixo do teto de 200 do
 * backend de propósito: a tela é lida no celular, onde 20 cartões já são uma
 * rolagem longa. O que sobra está na página seguinte, não truncado.
 */
export const DOCUMENT_ALERTS_PAGE_SIZE = 20;
