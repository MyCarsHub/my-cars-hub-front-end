export type SupportTicketChannel = 'WHATSAPP' | 'EMAIL' | 'BOTH';
export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

/**
 * Resultado do DESPACHO do e-mail de uma resposta — nunca da entrega.
 * Espelha `SupportTicketReplyEmailStatusEnum` no backend.
 *
 * Só existem dois valores, e não há um `FAILED`: o DTO de resposta é montado
 * antes do commit e o e-mail só é despachado depois dele, então nenhum
 * resultado de envio cabe nesta resposta, por construção. `QUEUED` é
 * "despachado sem confirmação"; confirmação de entrega exigiria webhook do
 * provedor, que é outro campo e outro trabalho.
 */
export type SupportTicketReplyEmailStatus = 'QUEUED' | 'SKIPPED';

export interface CreateSupportTicketRequest {
  message: string;
  channel: SupportTicketChannel;
}

export interface UpdateSupportTicketStatusRequest {
  status: SupportTicketStatus;
}

/** Corpo de `POST /admin/support/tickets/{id}/replies`. */
export interface CreateSupportTicketReplyRequest {
  message: string;
}

/**
 * Corpo de `PUT /admin/support/tickets/{id}/assignee`.
 *
 * `assigneeId` é OBRIGATÓRIO — corpo `{}` ou campo com nome errado responde
 * 400. Desatribuir tem rota própria: `DELETE .../{id}/assignee`.
 */
export interface AssignSupportTicketRequest {
  assigneeId: string;
}

/** Resposta do endpoint público de criação (`POST /support/tickets`). */
export interface SupportTicketDto {
  id: string;
  createdDate: string;
  companyId: string | null;
  userId: string | null;
  message: string;
  channel: SupportTicketChannel;
  status: SupportTicketStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/**
 * Linha do backoffice (`SupportTicketAdminItemDto`), com os nomes já resolvidos
 * pelo backend. Os IDs vêm ao lado dos nomes de propósito — a UI mostra o nome,
 * o admin ainda precisa do ID para correlacionar com log.
 */
export interface SupportTicketAdminItem {
  id: string;
  createdDate: string;
  companyId: string | null;
  companyName: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  message: string;
  channel: SupportTicketChannel;
  status: SupportTicketStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedAt: string | null;
  replyCount: number;
  lastReplyAt: string | null;
}

export interface SupportTicketReply {
  id: string;
  createdDate: string;
  authorUserId: string | null;
  authorName: string | null;
  message: string;
  emailStatus: SupportTicketReplyEmailStatus;
}

/**
 * `SupportTicketAdminDetailDto`: a mesma linha da listagem + a thread.
 * Devolvido por TODAS as mutações admin (status, resposta, atribuição), então a
 * tela redesenha o card sem um GET de volta.
 */
export interface SupportTicketAdminDetail {
  ticket: SupportTicketAdminItem;
  replies: SupportTicketReply[];
}

/** Opção do seletor de responsável — um PLATFORM_ADMIN ativo. */
export interface SupportAssigneeOption {
  id: string;
  name: string | null;
  email: string;
}

/** Opção do filtro por empresa. */
export interface SupportCompanyOption {
  id: string;
  name: string;
}

export const SUPPORT_STATUS_META: Record<SupportTicketStatus, { label: string; chip: string }> = {
  OPEN: { label: 'Aberto', chip: 'bg-amber-100 text-amber-800' },
  IN_PROGRESS: { label: 'Em atendimento', chip: 'bg-blue-100 text-blue-800' },
  RESOLVED: { label: 'Resolvido', chip: 'bg-emerald-100 text-emerald-800' },
};

export const SUPPORT_CHANNEL_LABEL: Record<SupportTicketChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  BOTH: 'WhatsApp + E-mail',
};

/**
 * Rótulos de `emailStatus`. O contrato é de DESPACHO, não de entrega — por isso
 * nenhum rótulo aqui diz "enviado" ou "entregue" para `QUEUED`.
 */
export const SUPPORT_REPLY_EMAIL_STATUS_META: Record<
  SupportTicketReplyEmailStatus,
  { label: string; chip: string; hint: string }
> = {
  QUEUED: {
    label: 'E-mail despachado',
    chip: 'bg-sky-100 text-sky-800',
    hint: 'Entregue ao serviço de envio. Não confirma que chegou à caixa de entrada do autor.',
  },
  SKIPPED: {
    label: 'Sem e-mail do autor',
    chip: 'bg-neutral-200 text-neutral-800',
    hint: 'O autor não tem endereço conhecido, então nada foi despachado. A resposta ficou registrada aqui.',
  },
};

/** Limites de `CreateSupportTicketReplyRequestDto` — espelham o CHECK da V46. */
export const SUPPORT_REPLY_MIN_LENGTH = 5;
export const SUPPORT_REPLY_MAX_LENGTH = 4000;
