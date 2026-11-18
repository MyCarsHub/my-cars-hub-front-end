import { HttpErrorResponse } from '@angular/common/http';
import type { StatusChipTone } from '../../../components/core/status-chip/status-chip';
import type {
  AdminUserCompanyLink,
  AdminUserCompanyRole,
  AdminUserListItem,
  AdminUserStatusFilter,
} from '../../../types/admin-user.types';
import { companyRoleLabel } from '../../../utils/role-labels';
import { formatFullDate, formatTime, parseServerTime } from '../../../utils/server-time';

/**
 * Pura de proposito: a regra de cada coluna da lista de Usuarios (papel, situacao, ultimo
 * acesso, aba) mora aqui, sem Angular, para os specs a exercitarem sem montar a tela.
 */

/** A fileira unica de pilulas de situacao (padrao da plataforma: so situacao vira pilula). */
export type UsersStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'ONLINE';
/** Papel numa empresa: vai no select "Papel: X" da linha da busca, nunca numa segunda fileira. */
export type UsersRoleFilter = 'ALL' | 'OWNER' | 'MANAGER' | 'DRIVER';

const ROLE_RANK: Readonly<Record<string, number>> = { OWNER: 3, MANAGER: 2, DRIVER: 1 };

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

/**
 * Papel que a coluna "Papel" mostra: admin da plataforma vence; senao o mais alto. Chip
 * NEUTRO sempre: cor e so para situacao, nunca para quem a pessoa e (`people-table.ts`).
 */
export function userRole(user: Pick<AdminUserListItem, 'systemRole' | 'companies'>): Labelled | null {
  if (user.systemRole === 'PLATFORM_ADMIN') return { label: 'Admin', tone: 'neutral' };
  const role = primaryCompanyRole(user.companies);
  return role ? { label: companyRoleLabel(role), tone: 'neutral' } : null;
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
  const seen = parseServerTime(user.lastSeenAt)?.getTime();
  if (seen === undefined) return null;
  const minutes = Math.max(1, Math.floor((now - seen) / 60_000));
  if (minutes < 60) return `Visto há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Visto há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Visto há 1 dia' : `Visto há ${days} dias`;
}

/**
 * O que cada pilula pede ao SERVIDOR. Ele filtra situacao (ACTIVE/INACTIVE) e presenca;
 * "Convite pendente" ele nao filtra, entao pede os ativos e a tela recorta a pagina.
 */
export function serverQueryFor(status: UsersStatusFilter): {
  status: AdminUserStatusFilter;
  online: boolean;
} {
  switch (status) {
    case 'ACTIVE':
    case 'PENDING':
      return { status: 'ACTIVE', online: false };
    case 'INACTIVE':
      return { status: 'INACTIVE', online: false };
    case 'ONLINE':
      return { status: 'ALL', online: true };
    default:
      return { status: 'ALL', online: false };
  }
}

/** Filtros que o servidor NAO faz (papel e convite pendente) valem so para a pagina carregada. */
export function isLocalFilter(status: UsersStatusFilter, role: UsersRoleFilter): boolean {
  return status === 'PENDING' || role !== 'ALL';
}

/**
 * A linha passa nos filtros LOCAIS: convite pendente e papel em QUALQUER empresa do usuario.
 * Situacao e presenca ja vieram filtradas do servidor.
 */
export function matchesLocalFilters(
  user: AdminUserListItem,
  status: UsersStatusFilter,
  role: UsersRoleFilter,
): boolean {
  if (status === 'PENDING' && !hasPendingInvite(user)) return false;
  if (role === 'ALL') return true;
  return (user.companies ?? []).some((c) => c.role === role);
}

/**
 * Data e hora exatas de um instante do servidor, no fuso do negocio: "18/11/2026 às 14:32".
 * `LocalDateTime` da API vem em UTC sem sufixo; `parseServerTime` le assim (sem ele o
 * navegador leria como hora local e erraria 3 h, e o dia depois das 21h).
 */
export function exactDateTime(value: string | null | undefined): string | null {
  const date = parseServerTime(value);
  return date ? `${formatFullDate(date)} às ${formatTime(date)}` : null;
}

/** So a data de um instante do servidor, no fuso do negocio: "18/11/2026"; "—" sem data. */
export function exactDate(value: string | null | undefined): string {
  return formatFullDate(parseServerTime(value));
}

/** Todas as empresas com o papel em cada uma, para o balao/leitor de tela da coluna Empresas. */
export function companiesDetail(user: Pick<AdminUserListItem, 'companies'>): string {
  return (user.companies ?? [])
    .map((c) => `${c.companyName} (${companyRoleLabel(c.role)})`)
    .join(', ');
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
