import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';

/**
 * Como a Auditoria FALA de cada ação gravada. A chave é o `name()` do enum
 * `AdminAuditAction` do backend; o valor cru continua sendo o que vai no filtro
 * da API (traduzir o filtro daria 400). O dono nunca vê o código: ação nova sem
 * rótulo aqui passa por `fallbackActionLabel`, que monta uma frase em português.
 *
 * Tom do chip (só quatro, regra do dono para a Auditoria):
 * - `green`: algo passou a existir ou foi recebido (criar, publicar, conceder, receber);
 * - `red`: algo deixou de existir ou foi barrado (excluir, remover, revogar, cancelar, recusar);
 * - `amber`: o estado de algo mudou (alterar, editar, mover, estender, salvar);
 * - `neutral`: ninguém mudou nada, alguém olhou, comparou, leu ou enviou um aviso.
 */
export interface AuditActionMeta {
  readonly label: string;
  readonly tone: AuditTone;
}

export type AuditTone = Extract<StatusChipTone, 'green' | 'red' | 'amber' | 'neutral'>;

export const AUDIT_ACTIONS: Readonly<Record<string, AuditActionMeta>> = {
  // Usuários e admins
  USER_STATUS_CHANGED: { label: 'Situação do usuário alterada', tone: 'amber' },
  USER_SYSTEM_ROLE_CHANGED: { label: 'Papel de sistema alterado', tone: 'amber' },
  USER_REMOVED: { label: 'Usuário excluído', tone: 'red' },
  USER_INVITE_RESENT: { label: 'Convite reenviado', tone: 'neutral' },
  COMPANY_MEMBER_REMOVED: { label: 'Membro removido da empresa', tone: 'red' },
  USER_CONTACT_REVEALED: { label: 'Contato do usuário visto', tone: 'neutral' },
  ADMIN_ROLE_GRANTED: { label: 'Acesso de admin concedido', tone: 'green' },
  ADMIN_ROLE_CHANGED: { label: 'Papel de admin alterado', tone: 'amber' },
  ADMIN_ROLE_REVOKED: { label: 'Acesso de admin removido', tone: 'red' },

  // Empresas
  COMPANY_STATUS_CHANGED: { label: 'Situação da empresa alterada', tone: 'amber' },
  COMPANY_INTERNAL_FLAG_CHANGED: { label: 'Empresa marcada como interna ou externa', tone: 'amber' },
  COMPANY_TRIAL_EXTENDED: { label: 'Teste estendido', tone: 'amber' },
  COMPANY_CONTACT_REVEALED: { label: 'Contato da empresa visto', tone: 'neutral' },
  ADMIN_COMPANY_ACCESS_GRANTED: { label: 'Acesso de edição à empresa', tone: 'amber' },

  // Ver como empresa e modo edição
  IMPERSONATION_STARTED: { label: 'Entrou como empresa (só leitura)', tone: 'neutral' },
  IMPERSONATION_ENDED: { label: 'Saiu da visão da empresa', tone: 'neutral' },
  IMPERSONATED_INVITES_LISTED: { label: 'Convites da empresa consultados', tone: 'neutral' },
  SUPPORT_EDIT_STARTED: { label: 'Modo edição aberto', tone: 'amber' },
  SUPPORT_EDIT_EXTENDED: { label: 'Modo edição prolongado', tone: 'amber' },
  SUPPORT_EDIT_REQUEST: { label: 'Alteração no modo edição', tone: 'amber' },
  SUPPORT_EDIT_WRITE_CAP_REACHED: { label: 'Limite de alterações atingido', tone: 'red' },
  SUPPORT_EDIT_SIDE_EFFECT_SUPPRESSED: { label: 'Aviso ao motorista suspenso', tone: 'neutral' },

  // Sugestões
  FEEDBACK_TASK_STATUS_CHANGED: { label: 'Sugestão movida', tone: 'amber' },
  FEEDBACK_TASK_DELETED: { label: 'Sugestão excluída', tone: 'red' },

  // Blog
  BLOG_POST_CREATED: { label: 'Post criado', tone: 'green' },
  BLOG_POST_UPDATED: { label: 'Post editado', tone: 'amber' },
  BLOG_POST_PUBLISHED: { label: 'Post publicado', tone: 'green' },
  BLOG_POST_UNPUBLISHED: { label: 'Post despublicado', tone: 'amber' },
  BLOG_POST_DELETED: { label: 'Post excluído', tone: 'red' },

  // Suporte
  SUPPORT_TICKET_STATUS_CHANGED: { label: 'Situação do ticket alterada', tone: 'amber' },
  SUPPORT_TICKET_REPLIED: { label: 'Ticket respondido', tone: 'neutral' },
  SUPPORT_TICKET_ASSIGNED: { label: 'Responsável do ticket definido', tone: 'amber' },

  // Aluguéis, contratos e notificações
  RENTAL_SCHEDULE_REGENERATED: { label: 'Cronograma refeito', tone: 'amber' },
  CONTRACT_TEMPLATE_SAVED: { label: 'Template de contrato salvo', tone: 'amber' },
  CONTRACT_AI_CONSENT_GIVEN: { label: 'Uso da IA no contrato autorizado', tone: 'green' },
  CONTRACT_DRAFT_DISCARDED: { label: 'Rascunho de contrato descartado', tone: 'red' },
  NOTIFICATION_TEST_DISPATCHED: { label: 'Teste de avisos enviado', tone: 'neutral' },

  // Cobranças
  CHARGE_EMAIL_RESENT: { label: 'E-mail de cobrança reenviado', tone: 'neutral' },
  CHARGE_ASAAS_COMPARED: { label: 'Cobrança comparada com o Asaas', tone: 'neutral' },
  // Cobre qualquer tipo de cobrança, não só a caução.
  CHARGE_MARKED_RECEIVED_OUTSIDE: { label: 'Recebida por fora (admin)', tone: 'green' },
  CHARGE_RETRIED_BY_ADMIN: { label: 'Cobrança gerada de novo', tone: 'amber' },
  CHARGE_CANCELED_BY_ADMIN: { label: 'Cobrança cancelada (admin)', tone: 'red' },
  // FEAT-0573: movimentações da locadora nas cobranças flexíveis.
  RENTAL_CHARGES_RENEGOTIATED: { label: 'Cobranças renegociadas (acordo)', tone: 'amber' },
  RENTAL_CHARGE_RECEIVED_OUTSIDE: { label: 'Recebida por fora (locadora)', tone: 'green' },
  RENTAL_CHARGE_AGREEMENT_NEEDS_ATTENTION: { label: 'Acordo precisa de atenção', tone: 'amber' },
  BILLING_REMINDER: { label: 'Lembrete de assinatura enviado', tone: 'neutral' },

  // Motoristas
  DRIVER_CONTACT_REVEALED: { label: 'Contato do motorista visto', tone: 'neutral' },
  DRIVER_NAME_CORRECTED: { label: 'Nome do motorista corrigido', tone: 'amber' },
  DRIVER_ASAAS_CUSTOMER_SYNCED: { label: 'Cliente atualizado no Asaas', tone: 'amber' },

  // Cupons
  COUPON_CREATED: { label: 'Cupom criado', tone: 'green' },
  COUPON_APPLIED: { label: 'Cupom aplicado', tone: 'green' },
  COUPON_DEACTIVATED: { label: 'Cupom desativado', tone: 'red' },

  // Custos da plataforma
  PLATFORM_VENDOR_CREATED: { label: 'Fornecedor cadastrado', tone: 'green' },
  PLATFORM_VENDOR_UPDATED: { label: 'Fornecedor alterado', tone: 'amber' },
  PLATFORM_COST_SET: { label: 'Custo mensal lançado', tone: 'amber' },
  PLATFORM_COST_DELETED: { label: 'Custo mensal excluído', tone: 'red' },

  // Novidades
  ANNOUNCEMENT_CREATED: { label: 'Novidade criada', tone: 'green' },
  ANNOUNCEMENT_UPDATED: { label: 'Novidade editada', tone: 'amber' },
  ANNOUNCEMENT_PUBLISHED: { label: 'Novidade publicada', tone: 'green' },
  ANNOUNCEMENT_UNPUBLISHED: { label: 'Novidade encerrada', tone: 'amber' },
  ANNOUNCEMENT_DELETED: { label: 'Novidade excluída', tone: 'red' },
  ANNOUNCEMENT_MEDIA_SET: { label: 'Mídia da novidade trocada', tone: 'amber' },
  ANNOUNCEMENT_MEDIA_REMOVED: { label: 'Mídia da novidade removida', tone: 'red' },
};

export const AUDIT_TARGETS: Readonly<Record<string, string>> = {
  USER: 'Usuário',
  COMPANY: 'Empresa',
  FEEDBACK_TASK: 'Sugestão',
  BLOG_POST: 'Post',
  SUPPORT_TICKET: 'Ticket de suporte',
  RENTAL: 'Aluguel',
  NOTIFICATION: 'Notificação',
  RENTAL_CHARGE: 'Cobrança',
  DRIVER: 'Motorista',
  PLATFORM_VENDOR: 'Fornecedor',
  PLATFORM_COST: 'Custo da plataforma',
  ANNOUNCEMENT: 'Novidade',
};

/** Verbo do fim do código → substantivo ("CREATED" → "Criação"): sem concordância de gênero. */
const VERB_NOUNS: Readonly<Record<string, { noun: string; tone: AuditTone }>> = {
  CREATED: { noun: 'Criação', tone: 'green' },
  ADDED: { noun: 'Inclusão', tone: 'green' },
  PUBLISHED: { noun: 'Publicação', tone: 'green' },
  GRANTED: { noun: 'Concessão', tone: 'green' },
  APPROVED: { noun: 'Aprovação', tone: 'green' },
  RECEIVED: { noun: 'Recebimento', tone: 'green' },
  APPLIED: { noun: 'Aplicação', tone: 'green' },
  OPENED: { noun: 'Abertura', tone: 'green' },
  RESOLVED: { noun: 'Resolução', tone: 'green' },
  ENABLED: { noun: 'Ativação', tone: 'green' },
  ACTIVATED: { noun: 'Ativação', tone: 'green' },
  DELETED: { noun: 'Exclusão', tone: 'red' },
  REMOVED: { noun: 'Remoção', tone: 'red' },
  REVOKED: { noun: 'Revogação', tone: 'red' },
  CANCELED: { noun: 'Cancelamento', tone: 'red' },
  CANCELLED: { noun: 'Cancelamento', tone: 'red' },
  REJECTED: { noun: 'Recusa', tone: 'red' },
  REFUSED: { noun: 'Recusa', tone: 'red' },
  DEACTIVATED: { noun: 'Desativação', tone: 'red' },
  DISCARDED: { noun: 'Descarte', tone: 'red' },
  DISABLED: { noun: 'Desativação', tone: 'red' },
  BLOCKED: { noun: 'Bloqueio', tone: 'red' },
  CHANGED: { noun: 'Alteração', tone: 'amber' },
  UPDATED: { noun: 'Edição', tone: 'amber' },
  EDITED: { noun: 'Edição', tone: 'amber' },
  SAVED: { noun: 'Gravação', tone: 'amber' },
  SET: { noun: 'Definição', tone: 'amber' },
  EXTENDED: { noun: 'Extensão', tone: 'amber' },
  MOVED: { noun: 'Mudança', tone: 'amber' },
  ASSIGNED: { noun: 'Atribuição', tone: 'amber' },
  SYNCED: { noun: 'Sincronização', tone: 'amber' },
  CORRECTED: { noun: 'Correção', tone: 'amber' },
  REGENERATED: { noun: 'Nova geração', tone: 'amber' },
  RENEGOTIATED: { noun: 'Renegociação', tone: 'amber' },
  CLOSED: { noun: 'Encerramento', tone: 'amber' },
  REOPENED: { noun: 'Reabertura', tone: 'amber' },
  STARTED: { noun: 'Início', tone: 'neutral' },
  ENDED: { noun: 'Fim', tone: 'neutral' },
  VIEWED: { noun: 'Consulta', tone: 'neutral' },
  LISTED: { noun: 'Consulta', tone: 'neutral' },
  READ: { noun: 'Leitura', tone: 'neutral' },
  REVEALED: { noun: 'Consulta', tone: 'neutral' },
  COMPARED: { noun: 'Comparação', tone: 'neutral' },
  SENT: { noun: 'Envio', tone: 'neutral' },
  RESENT: { noun: 'Reenvio', tone: 'neutral' },
  DISPATCHED: { noun: 'Envio', tone: 'neutral' },
  REPLIED: { noun: 'Resposta', tone: 'neutral' },
};

/** Palavras do sujeito do código, para a frase de reserva. Palavra fora daqui fica minúscula. */
const SUBJECT_WORDS: Readonly<Record<string, string>> = {
  USER: 'usuário',
  USERS: 'usuários',
  COMPANY: 'empresa',
  MEMBER: 'membro',
  ADMIN: 'admin',
  ROLE: 'papel',
  STATUS: 'situação',
  CONTACT: 'contato',
  DRIVER: 'motorista',
  RENTAL: 'aluguel',
  CHARGE: 'cobrança',
  CHARGES: 'cobranças',
  CONTRACT: 'contrato',
  TEMPLATE: 'template',
  DRAFT: 'rascunho',
  FEEDBACK: 'sugestão',
  TASK: '',
  BLOG: '',
  POST: 'post',
  SUPPORT: 'suporte',
  TICKET: 'ticket',
  NOTIFICATION: 'aviso',
  EMAIL: 'e-mail',
  COUPON: 'cupom',
  PLATFORM: 'plataforma',
  VENDOR: 'fornecedor',
  COST: 'custo',
  ANNOUNCEMENT: 'novidade',
  MEDIA: 'mídia',
  INVITE: 'convite',
  TRIAL: 'teste',
  PLAN: 'plano',
  SUBSCRIPTION: 'assinatura',
  PAYMENT: 'pagamento',
  VEHICLE: 'veículo',
  SCHEDULE: 'cronograma',
  AGREEMENT: 'acordo',
  BILLING: 'assinatura',
  REMINDER: 'lembrete',
  ACCESS: 'acesso',
  NAME: 'nome',
  CUSTOMER: 'cliente',
  ASAAS: 'Asaas',
  EDIT: 'edição',
  REQUEST: 'pedido',
  SESSION: 'sessão',
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function splitCode(raw: string): string[] {
  return raw
    .trim()
    .toUpperCase()
    .split(/[_\s-]+/)
    .filter(Boolean);
}

/**
 * Frase em português para um código que a tela ainda não conhece. Nunca devolve vazio:
 * `SUPPORT_TICKET_CLOSED` → "Encerramento de suporte ticket"; sem verbo conhecido,
 * `FOO_BAR_ZAPPED` → "Foo bar zapped" (ainda legível, nunca o código cru com sublinhado).
 */
export function fallbackActionLabel(raw: string): string {
  const words = splitCode(raw);
  if (!words.length) return 'Ação sem nome';
  const verb = VERB_NOUNS[words[words.length - 1]];
  const subjectWords = (verb ? words.slice(0, -1) : words)
    .map((w) => SUBJECT_WORDS[w] ?? w.toLowerCase())
    .filter(Boolean);
  const subject = subjectWords.join(' ');
  if (verb) return subject ? `${verb.noun} de ${subject}` : verb.noun;
  return capitalize(subject || raw.toLowerCase());
}

/** Rótulo em português da ação (mapa; reserva em frase). */
export function auditActionLabel(raw: string | null | undefined): string {
  if (!raw) return 'Ação sem nome';
  return AUDIT_ACTIONS[raw]?.label ?? fallbackActionLabel(raw);
}

/** Tom do chip da ação (mapa; reserva pelo verbo do fim do código; neutro se nada bater). */
export function auditActionTone(raw: string | null | undefined): AuditTone {
  if (!raw) return 'neutral';
  const known = AUDIT_ACTIONS[raw];
  if (known) return known.tone;
  const words = splitCode(raw);
  return VERB_NOUNS[words[words.length - 1] ?? '']?.tone ?? 'neutral';
}

/** Tipo do alvo em português; desconhecido vira texto legível, nunca o código cru. */
export function auditTargetLabel(raw: string | null | undefined): string {
  if (!raw) return 'Sem alvo';
  if (AUDIT_TARGETS[raw]) return AUDIT_TARGETS[raw];
  const words = splitCode(raw)
    .map((w) => SUBJECT_WORDS[w] ?? w.toLowerCase())
    .filter(Boolean);
  return capitalize(words.join(' ') || raw.toLowerCase());
}
