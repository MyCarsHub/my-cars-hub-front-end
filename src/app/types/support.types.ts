export type SupportTicketChannel = 'WHATSAPP' | 'EMAIL' | 'BOTH';
export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface CreateSupportTicketRequest {
  message: string;
  channel: SupportTicketChannel;
}

export interface UpdateSupportTicketStatusRequest {
  status: SupportTicketStatus;
}

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

export const SUPPORT_STATUS_META: Record<
  SupportTicketStatus,
  { label: string; chip: string }
> = {
  OPEN: { label: 'Aberto', chip: 'bg-amber-100 text-amber-800' },
  IN_PROGRESS: { label: 'Em atendimento', chip: 'bg-blue-100 text-blue-800' },
  RESOLVED: { label: 'Resolvido', chip: 'bg-emerald-100 text-emerald-800' },
};

export const SUPPORT_CHANNEL_LABEL: Record<SupportTicketChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  BOTH: 'WhatsApp + E-mail',
};
