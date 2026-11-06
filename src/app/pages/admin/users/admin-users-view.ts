import { HttpErrorResponse } from '@angular/common/http';
import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import type {
  AdminUserCompanyLink,
  AdminUserCompanyRole,
  AdminUserListItem,
} from '../../../types/admin-user.types';
import { companyRoleLabel } from '../../../utils/role-labels';

/**
 * Pura de proposito: a regra de cada coluna da lista de Usuarios (papel, situacao, ultimo
 * acesso, aba) mora aqui, sem Angular, para os specs a exercitarem sem montar a tela.
 */

export type UsersTab = 'ALL' | 'OWNER' | 'MANAGER' | 'DRIVER' | 'INACTIVE';

const ROLE_RANK: Readonly<Record<string, number>> = { OWNER: 3, MANAGER: 2, DRIVER: 1 };

const ROLE_TONE: Readonly<Record<string, StatusChipTone>> = {
  OWNER: 'orange',
  MANAGER: 'blue',
  DRIVER: 'green',
};

export interface Labelled {
  label: string;
  tone: StatusChipTone;
}

/** O papel mais alto entre as empresas ATIVAS do usuario; `null` sem nenhuma. */
export function primaryCompanyRole(companies: readonly AdminUserCompanyRole[] | undefined): string | null {
  let best: string | null = null;
  for (const link of companies ?? []) {
    if ((ROLE_RANK[link.role] ?? 0) > (ROLE_RANK[best ?? ''] ?? 0)) best = link.role;
  }
  return best;
}

/** Papel que a coluna "Papel" mostra: admin da plataforma vence; senao o mais alto. */
export function userRole(user: Pick<AdminUserListItem, 'systemRole' | 'companies'>): Labelled | null {
  if (user.systemRole === 'PLATFORM_ADMIN') return { label: 'Admin', tone: 'neutral' };
  const role = primaryCompanyRole(user.companies);
  return role ? { label: companyRoleLabel(role), tone: ROLE_TONE[role] ?? 'neutral' } : null;
}

/** Convite ainda nao aceito: a conta so existe porque um convite a pre-cadastrou. */
export function hasPendingInvite(user: Pick<AdminUserListItem, 'accountStatus'>): boolean {
  return user.accountStatus === 'PRE_REGISTERED';
}

/** Situacao da conta, so texto no chip (cor no chip, nunca na linha). */
export function userSituation(
  user: Pick<AdminUserListItem, 'active' | 'accountStatus'>,
): Labelled {
  if (!user.active) return { label: 'Inativo', tone: 'red' };
  if (hasPendingInvite(user)) return { label: 'Convite pendente', tone: 'amber' };
  return { label: 'Ativo', tone: 'green' };
}

/**
 * "Online agora", "Visto ha 12 min"... ou `null` quando nunca visto. O "agora" entra por
 * parametro para o spec fixar o relogio.
 */
export function lastAccessLabel(
  user: Pick<AdminUserListItem, 'online' | 'lastSeenAt'>,
  now: number,
): string | null {
  if (user.online) return 'Online agora';
  if (!user.lastSeenAt) return null;
  const seen = Date.parse(user.lastSeenAt);
  if (Number.isNaN(seen)) return null;
  const minutes = Math.max(1, Math.floor((now - seen) / 60_000));
  if (minutes < 60) return `Visto há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Visto há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Visto há 1 dia' : `Visto há ${days} dias`;
}

/**
 * Aba da lista. "Inativos" e filtro do SERVIDOR (status); os tres papeis o servidor nao
 * filtra, entao valem para as linhas ja carregadas.
 */
export function matchesTab(user: AdminUserListItem, tab: UsersTab): boolean {
  switch (tab) {
    case 'ALL':
    case 'INACTIVE':
      return true;
    default:
      return (user.companies ?? []).some((c) => c.role === tab);
  }
}

/** "Mobi Fortaleza" / "Mobi Fortaleza +1" para a coluna Empresas. */
export function companiesSummary(user: Pick<AdminUserListItem, 'companies' | 'companyCount'>): string {
  const list = user.companies ?? [];
  const count = user.companyCount ?? list.length;
  if (count === 0) return '—';
  const first = list[0]?.companyName;
  if (!first) return String(count);
  return count > 1 ? `${first} +${count - 1}` : first;
}

/**
 * "Entrar como": as empresas onde o usuario NAO e motorista e o vinculo esta ATIVO.
 * Motorista fica de fora ate existir "Ver como motorista" (o "Ver como" de hoje abre a
 * empresa, nao o app do motorista).
 */
export function enterAsTargets(links: readonly AdminUserCompanyLink[]): AdminUserCompanyLink[] {
  return links.filter((l) => l.status === 'ACTIVE' && l.role !== 'DRIVER');
}

/** O detalhe nao traz `accountStatus`; um vinculo INVITED e o sinal que ele tem. */
export function detailHasPendingInvite(links: readonly AdminUserCompanyLink[]): boolean {
  return links.some((l) => l.status === 'INVITED');
}

const RESEND_FALLBACK = 'Não foi possível reenviar o convite.';

/**
 * Texto INLINE das tres recusas do reenvio: 404 (usuario sumiu), 409 (sem convite pendente
 * ou ele mudou no meio) e 429 (reenviado ha pouco; o corpo traz `retryAfterSeconds`).
 * `null` = nao e uma dessas, quem chama cai no texto generico do `ApiErrorService`.
 */
export function resendRefusal(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  if (err.status === 404) return 'Usuário não encontrado. Atualize a lista.';
  if (err.status === 409) return 'Este usuário não tem convite pendente para reenviar.';
  if (err.status === 429) {
    const body = err.error as { retryAfterSeconds?: unknown } | null;
    const fromBody = Number(body?.retryAfterSeconds);
    const fromHeader = Number(err.headers?.get('Retry-After'));
    const seconds = [fromBody, fromHeader].find((n) => Number.isFinite(n) && n > 0);
    if (!seconds) return 'Este convite foi reenviado há pouco. Aguarde alguns minutos.';
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `Este convite foi reenviado há pouco. Tente de novo em ${minutes} min.`;
  }
  return null;
}

export { RESEND_FALLBACK };
