import { HttpErrorResponse } from '@angular/common/http';
import { CompanyMemberResponse } from '../../../types/company-member.types';
import { InviteResponse } from '../../../types/invite.types';
import { companyRoleLabel } from '../../../utils/role-labels';

/**
 * The Members page view model: pure functions from the two API payloads to what a row
 * renders and which actions it offers. No Angular here on purpose — every permission rule
 * of the page lives in this file and is decided BEFORE a click, never by waiting for the
 * server's 403/409.
 */

/** Chip tones. Values are the design-system ramps the guidelines name for each meaning. */
export const CHIP_TONE = {
  ok: 'bg-success-100 text-success-900',
  amber: 'bg-amber-100 text-amber-800',
  rose: 'bg-rose-50 text-rose-700',
  neutral: 'bg-neutral-100 text-neutral-700',
} as const;

export type ChipTone = keyof typeof CHIP_TONE;

export interface Chip {
  label: string;
  tone: ChipTone;
}

/** One active member, as the card, the table row and the actions sheet render it. */
export interface MemberRow {
  /** `userId` — what `DELETE /members/{userId}` is keyed by. */
  id: string;
  name: string;
  email: string;
  initial: string;
  /** Raw role (`OWNER` | `MANAGER` | `DRIVER`) — what the Acesso filter compares. */
  role: string;
  roleLabel: string;
  memberSince: string;
  /** Is this row ME? Changes the verb: leaving the company, not removing someone. */
  isSelf: boolean;
  canRemove: boolean;
  /** Why there is no action, when there is none — absence is explained, never silent. */
  lockedReason: string;
  /** Label of the destructive action: "Remover acesso" or "Sair desta empresa". */
  removeLabel: string;
}

/** One PENDING or EXPIRED invite. */
export interface InviteRow {
  /** Invite UUID — what resend and cancel are keyed by. */
  id: string;
  /** Invitee name when the API sends it; the e-mail otherwise. */
  title: string;
  email: string;
  /** Second line: the e-mail, only when the title is a name. */
  subtitle: string;
  initial: string;
  role: string;
  roleLabel: string;
  sentAt: string;
  expired: boolean;
  validity: Chip;
  /** `null` when the API does not report delivery — the screen never guesses. */
  delivery: (Chip & { icon: 'check' | 'clock' | 'x' }) | null;
  deliveryFailed: boolean;
  /** Resend and cancel both work on PENDING and EXPIRED (measured on the backend). */
  canAct: boolean;
  lockedReason: string;
}

export const OWNER_LOCKED = 'O dono não pode ser removido.';
/**
 * Do NOT promise "promote another owner": the product has no way to create a second owner
 * (invites refuse OWNER, there is no role-change endpoint), so this lock is permanent.
 */
export const LAST_OWNER_LOCKED =
  'Você é o único dono desta empresa, e o acesso do dono não pode ser removido.';
/** Not reachable from the page (a driver never loads the list); kept so absence is explained. */
export const INVITE_LOCKED = 'Só o dono e os gerenciadores gerenciam convites.';
export const ROLE_CHANGE_NOTE = 'Para mudar o nível de acesso, remova e convide de novo.';

const DAY_MS = 24 * 60 * 60 * 1000;

function initialOf(text: string): string {
  return (text.trim().charAt(0) || '?').toUpperCase();
}

/**
 * THE THREE BACKEND LOCKS, decided here (`CompanyMemberService.removeMember`):
 *
 *  1 and 2. target is OWNER and is NOT me -> 403. Same branch on the backend: the TARGET's
 *           role decides, not the actor's — so it holds for a MANAGER and for another OWNER.
 *  3.       target is OWNER and IS me -> allowed only if another ACTIVE owner exists;
 *           409 when I am the last one.
 *
 * Anyone else can be removed, including a manager removing their own access.
 */
export function toMemberRow(
  member: CompanyMemberResponse,
  myId: string | null,
  activeOwners: number,
): MemberRow {
  const isSelf = myId !== null && myId === member.userId;
  const isOwner = member.role === 'OWNER';
  const isLastOwner = isOwner && isSelf && activeOwners <= 1;
  const canRemove = isSelf ? !isLastOwner : !isOwner;
  let lockedReason = '';
  if (isLastOwner) lockedReason = LAST_OWNER_LOCKED;
  else if (isOwner && !isSelf) lockedReason = OWNER_LOCKED;
  return {
    id: member.userId,
    name: member.name,
    email: member.email,
    initial: initialOf(member.name || member.email),
    role: member.role,
    roleLabel: companyRoleLabel(member.role),
    memberSince: member.memberSince,
    isSelf,
    canRemove,
    lockedReason,
    removeLabel: isSelf ? 'Sair desta empresa' : 'Remover acesso',
  };
}

/**
 * Active members sorted by name. The owner count comes from the list itself, which is
 * correct and not a shortcut: the roster returns ACTIVE links only, exactly the universe
 * the backend counts in `countActiveOwners`.
 */
export function memberRows(
  members: readonly CompanyMemberResponse[],
  myId: string | null,
): MemberRow[] {
  const activeOwners = members.filter((m) => m.role === 'OWNER').length;
  return members
    .map((m) => toMemberRow(m, myId, activeOwners))
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name, 'pt-BR'));
}

/** `Expira em N dias` / `Expira hoje` / `Expirado`, from the server status + `expiresAt`. */
export function validityChip(invite: InviteResponse, now: number): Chip {
  // EXPIRED is derived by the server on read; the screen trusts it rather than running a
  // second rule for the same question.
  if (invite.status === 'EXPIRED') return { label: 'Expirado', tone: 'rose' };
  const left = Math.ceil((Date.parse(invite.expiresAt) - now) / DAY_MS);
  if (!Number.isFinite(left)) return { label: 'Pendente', tone: 'neutral' };
  if (left <= 0) return { label: 'Expira hoje', tone: 'amber' };
  const label = left === 1 ? 'Expira em 1 dia' : `Expira em ${left} dias`;
  return { label, tone: left <= 2 ? 'amber' : 'neutral' };
}

/** Only when the API reports delivery. Unknown values render nothing. */
export function deliveryChip(invite: InviteResponse): InviteRow['delivery'] {
  switch (invite.emailDelivery) {
    case 'SENT':
      return { label: 'Enviado', tone: 'neutral', icon: 'check' };
    case 'QUEUED':
      return { label: 'Enviando', tone: 'neutral', icon: 'clock' };
    case 'FAILED':
      return { label: 'Falha no envio', tone: 'rose', icon: 'x' };
    default:
      return null;
  }
}

/**
 * Who may resend/cancel an invite. OWNER and MANAGER alike, on EVERY invite of the company
 * (whoever created it, whatever role it grants): the backend lets a manager invite a
 * manager and list/cancel/resend all of them. Invites are the one place the manager is
 * the owner's equal; removing a MEMBER is a different rule and stays in `toMemberRow`.
 */
export function canManageInvites(callerRole: string | null): boolean {
  return callerRole === 'OWNER' || callerRole === 'MANAGER';
}

export function toInviteRow(
  invite: InviteResponse,
  callerRole: string | null,
  now: number,
): InviteRow {
  const name = (invite.name ?? '').trim();
  const canAct = canManageInvites(callerRole);
  const delivery = deliveryChip(invite);
  return {
    id: invite.id,
    title: name || invite.email,
    email: invite.email,
    subtitle: name ? invite.email : '',
    initial: initialOf(name || invite.email),
    role: invite.role,
    roleLabel: companyRoleLabel(invite.role),
    sentAt: invite.createDate,
    expired: invite.status === 'EXPIRED',
    validity: validityChip(invite, now),
    delivery,
    deliveryFailed: invite.emailDelivery === 'FAILED',
    canAct,
    lockedReason: canAct ? '' : INVITE_LOCKED,
  };
}

/**
 * Pending and expired rows. ACCEPTED is out (it is the same person the roster already returns —
 * joining raw would paint them twice), and so are CANCELLED and REVOKED. Someone who is
 * already an active member AND has a pending invite shows once, as a member: the e-mail
 * dedupe ignores case and surrounding spaces. Expired first: it is the only one that will
 * not resolve by itself.
 */
export function inviteRows(
  invites: readonly InviteResponse[],
  members: readonly CompanyMemberResponse[],
  callerRole: string | null,
  now: number,
): InviteRow[] {
  const norm = (email: string | null | undefined): string => (email ?? '').trim().toLowerCase();
  const activeEmails = new Set(members.map((m) => norm(m.email)));
  const open = invites
    .filter((i) => i.status === 'PENDING' || i.status === 'EXPIRED')
    .filter((i) => !activeEmails.has(norm(i.email)));
  return [
    ...open.filter((i) => i.status === 'EXPIRED'),
    ...open.filter((i) => i.status === 'PENDING'),
  ].map((i) => toInviteRow(i, callerRole, now));
}

// ------------------------------------------------------------------ error copy

export function listMessage(error: HttpErrorResponse, fallback: () => string): string {
  if (error.status === 403) {
    return 'Só o dono e os gerenciadores podem ver quem tem acesso a esta empresa.';
  }
  if (error.status === 404) {
    return 'Empresa não encontrada para esta sessão. Entre novamente e tente de novo.';
  }
  return fallback();
}

/**
 * The backend 404 is AMBIGUOUS on purpose (missing user, other company, already removed),
 * so the copy does not claim which: the access is not there any more — refresh.
 */
export function removeMessage(
  error: HttpErrorResponse,
  row: MemberRow,
  fallback: () => string,
): string {
  if (error.status === 403) return 'Você não tem permissão para remover o acesso de ' + row.name + '.';
  if (error.status === 409) return 'Esta empresa ficaria sem dono. Não é possível remover o último dono.';
  if (error.status === 404) return row.name + ' já não tem acesso a esta empresa. Atualize a lista.';
  return fallback();
}

/**
 * 410 and 404 are NOT the same answer: 410 is EXPIRED and recovers by resending; 404 never
 * existed (or was already cancelled) and asks for a reload and a new invite.
 */
export function inviteActionMessage(
  error: HttpErrorResponse,
  row: InviteRow,
  fallback: () => string,
): string {
  if (error.status === 410) {
    return 'O convite de ' + row.title + ' expirou. Use Reenviar convite para enviar um novo.';
  }
  if (error.status === 404) {
    return 'Este convite já não existe. Atualize a lista e convide a pessoa de novo.';
  }
  if (error.status === 409) {
    return 'Este convite já foi utilizado por ' + row.title + '. Atualize a lista.';
  }
  return fallback();
}

// ------------------------------------------------------------------ the unified list

export type PersonStatus = 'ACTIVE' | 'PENDING' | 'EXPIRED';
export type AccessFilter = '' | 'OWNER' | 'MANAGER' | 'DRIVER';
export type StatusFilter = '' | PersonStatus;

export interface PeopleFilters {
  query: string;
  access: AccessFilter;
  status: StatusFilter;
}

export const NO_FILTERS: PeopleFilters = { query: '', access: '', status: '' };

/** Options of the Acesso filter. Only the roles the roster can really hold. */
export const ACCESS_OPTIONS: readonly { value: AccessFilter; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'OWNER', label: 'Dono' },
  { value: 'MANAGER', label: 'Gerenciador' },
  { value: 'DRIVER', label: 'Motorista' },
];

/**
 * Options of the Status filter: only statuses the page DERIVES today (roster = Ativo;
 * invites = Pendente or Expirado). "Cadastro incompleto" has no source in either payload.
 */
export const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'PENDING', label: 'Pendente' },
  { value: 'EXPIRED', label: 'Expirado' },
];

/**
 * One line of the unified list: a member OR an invite, with the fields the filters, the
 * card and the table share. The original row travels along because the actions are keyed
 * by it (userId for a member, invite id for an invite).
 */
export interface PersonRow {
  /** Unique across both sources: `member:<userId>` or `invite:<id>`. */
  key: string;
  id: string;
  name: string;
  email: string;
  initial: string;
  role: string;
  roleLabel: string;
  status: PersonStatus;
  statusChip: Chip;
  isSelf: boolean;
  /** Joined date (member) or sent date (invite). */
  date: string;
  member: MemberRow | null;
  invite: InviteRow | null;
}

export function memberPerson(row: MemberRow): PersonRow {
  return {
    key: 'member:' + row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    initial: row.initial,
    role: row.role,
    roleLabel: row.roleLabel,
    status: 'ACTIVE',
    statusChip: { label: 'Ativo', tone: 'ok' },
    isSelf: row.isSelf,
    date: row.memberSince,
    member: row,
    invite: null,
  };
}

export function invitePerson(row: InviteRow): PersonRow {
  return {
    key: 'invite:' + row.id,
    id: row.id,
    name: row.title,
    email: row.email,
    initial: row.initial,
    role: row.role,
    roleLabel: row.roleLabel,
    status: row.expired ? 'EXPIRED' : 'PENDING',
    statusChip: row.expired ? { label: 'Expirado', tone: 'rose' } : { label: 'Pendente', tone: 'amber' },
    isSelf: false,
    date: row.sentAt,
    member: null,
    invite: row,
  };
}

/**
 * ONE list: you first, then the other members by name (both already ordered by
 * `memberRows`), then expired invites, then pending ones (already ordered by `inviteRows`).
 */
export function peopleRows(members: readonly MemberRow[], invites: readonly InviteRow[]): PersonRow[] {
  return [...members.map(memberPerson), ...invites.map(invitePerson)];
}

/** Lower-case, accent-free, trimmed: "JOSÉ" and "jose" are the same search. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function activeFilterCount(filters: PeopleFilters): number {
  return (filters.access ? 1 : 0) + (filters.status ? 1 : 0);
}

export function hasAnyFilter(filters: PeopleFilters): boolean {
  return normalizeSearch(filters.query) !== '' || activeFilterCount(filters) > 0;
}

export function filterPeople(rows: readonly PersonRow[], filters: PeopleFilters): PersonRow[] {
  const query = normalizeSearch(filters.query);
  return rows.filter((r) => {
    if (filters.access && r.role !== filters.access) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (query && !normalizeSearch(r.name + ' ' + r.email).includes(query)) return false;
    return true;
  });
}

export function resultsLabel(count: number): string {
  return count === 1 ? '1 resultado' : count + ' resultados';
}

export function accessLabel(value: AccessFilter): string {
  return ACCESS_OPTIONS.find((o) => o.value === value)?.label ?? '';
}

export function statusLabel(value: StatusFilter): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? '';
}

/** Text colours for the "Expira em N dias" / "Expirado" line (AA on white). */
export const validityTextTone: Record<ChipTone, string> = {
  ok: 'text-success-900',
  amber: 'text-amber-800',
  rose: 'text-rose-700',
  neutral: 'text-neutral-700',
};
