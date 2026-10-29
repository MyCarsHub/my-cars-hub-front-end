/** Papel fino do admin da plataforma (backend `AdminRole`, V126). */
export type AdminRole = 'OWNER' | 'SUPPORT' | 'READONLY';

/** Motivo de uma mudança de papel (lista fechada; vai para a trilha). */
export type AdminRoleReason = 'NEW_TEAM_MEMBER' | 'ROLE_CHANGE' | 'LEFT_TEAM' | 'SECURITY' | 'OTHER';

/**
 * Códigos estáveis de capacidade (backend `AdminCapability#code`). O front só
 * esconde; o servidor confere de novo em toda rota.
 */
export type AdminCapabilityCode =
  | 'ver'
  | 'contato.ver'
  | 'ver_como'
  | 'modo_edicao'
  | 'cobranca.agir'
  | 'asaas.comparar'
  | 'empresa.teste'
  | 'empresa.gerir'
  | 'usuario.gerir'
  | 'admins.gerir'
  | 'suporte.atender'
  | 'blog'
  | 'plataforma.operar';

export interface AdminSelf {
  userId: string;
  adminRole: AdminRole;
  adminRoleLabel: string;
  capabilities: AdminCapabilityCode[];
}

export interface AdminMember {
  id: string;
  name: string | null;
  email: string;
  /** null = admin sem papel (sem capacidade até o Dono escolher). */
  adminRole: AdminRole | null;
  active: boolean;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
}
