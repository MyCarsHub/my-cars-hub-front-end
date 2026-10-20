/**
 * Contract of `/v1/invites` (backend `develop @ 6d3bdb4`).
 *
 * Two properties of this contract are load-bearing and easy to get wrong:
 *
 * 1. The creation timestamp is `createDate`, **not** `createdDate` — every other
 *    resource in this app uses `createdDate`, so this one is the exception.
 * 2. `GET /v1/invites` deliberately never returns the raw token. The token exists
 *    only inside the invitation e-mail; the list screen can resend but can never
 *    rebuild the link.
 */

/** Roles an invite may grant. `OWNER` is rejected by the backend with a 400. */
export type InviteRole = 'MANAGER' | 'DRIVER';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';

/**
 * Dias que um convite continua valido — ESPELHO da constante do backend
 * `InvitesService.INVITE_TTL_DAYS` (`my-cars-hub-back-end`, `origin/main @ 09f165f`).
 *
 * O TTL e decisao do backend e nenhuma rota o expoe: `GET /v1/invites` devolve o
 * `expiresAt` de cada convite (e a lista mostra essa data real), mas os dois lugares que
 * PROMETEM a janela nao tem de onde le-la — o formulario de envio fala antes de existir
 * convite, e a tela publica de aceite (`/convite`) so recebe a resposta de
 * `POST /v1/invites/validate`, que nao carrega expiracao alguma. Por isso o numero e
 * espelhado aqui, UMA vez.
 *
 * Se o TTL do backend mudar, mude esta constante e mais nada: as duas frases e os dois
 * testes derivam dela. Nao redigite o numero num template nem num comentario — foi
 * exatamente assim que a tela passou a prometer 24 horas depois que o backend ja tinha
 * mudado a janela.
 *
 * A anotacao `: number` e LOAD-BEARING, nao e redundancia: sem ela o TypeScript estreita a
 * constante para o tipo literal `7`, e o ternario de plural de `INVITE_TTL_LABEL` abaixo
 * (`=== 1`) vira erro de compilacao TS2367 — "comparacao sem sobreposicao". Remove-la por
 * parecer ruido quebra o build numa linha que nao parece ter relacao com esta.
 */
export const INVITE_TTL_DAYS: number = 7;

/** `INVITE_TTL_DAYS` como copy pt-BR ("N dias"), para nenhuma frase fixar o numero. */
export const INVITE_TTL_LABEL = `${INVITE_TTL_DAYS} ${INVITE_TTL_DAYS === 1 ? 'dia' : 'dias'}`;

/**
 * Body of `POST /v1/invites`. The backend lowercases `email` before storing it.
 *
 * FEAT-0167 — `name`, `cpf` and `phone` are REQUIRED when `role` is MANAGER and IGNORED
 * when DRIVER, so they are optional here and the caller decides by role. CPF and phone may
 * go masked: the backend normalizes both.
 */
export interface CreateInviteRequest {
  email: string;
  role: InviteRole;
  name?: string;
  cpf?: string;
  phone?: string;
}

/** Item of `GET /v1/invites`. The creation response is `CreateInviteResponse`. */
export interface InviteResponse {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  expiresAt: string;
  /** Yes, `createDate` — the backend field has no `d`. Do not "fix" this. */
  createDate: string;
  /**
   * Invitee name given at creation. OPTIONAL: the list endpoint in production does not
   * return it yet, and the screen falls back to the e-mail when it is absent.
   */
  name?: string;
  /**
   * Delivery state of the invitation e-mail. OPTIONAL: not returned in production yet.
   * Absent means "unknown", and the screen shows no delivery chip at all — it never
   * guesses "sent".
   */
  emailDelivery?: InviteEmailDelivery;
}

/**
 * Body of `POST /v1/invites` (201): the invite plus the link, which exists ONLY here.
 *
 * `acceptUrl` is the absolute accept link, returned at creation and nowhere else: the
 * token is not stored, so `GET /v1/invites` can never rebuild it. OPTIONAL and nullable on
 * purpose — a backend that has not shipped it simply omits it, and the screen then falls
 * back to the e-mail-only confirmation. Keep it in component state only: never in storage,
 * never in a log, and never in the service cache (`InvitesService.create` strips it).
 */
export interface CreateInviteResponse extends InviteResponse {
  acceptUrl?: string | null;
}

/**
 * Body of `POST /v1/invites/resend/{id}` (200). Resending ROTATES the token: the link the
 * person may already hold stops working and the e-mail goes out again. An older backend
 * answers an empty body, which reads as `{}` — no link, no error.
 */
export interface ResendInviteResponse {
  acceptUrl?: string | null;
}

/** The invite as the list cache stores it: the same row, without the one-time link. */
export function withoutAcceptUrl(invite: CreateInviteResponse): InviteResponse {
  const copy: CreateInviteResponse = { ...invite };
  delete copy.acceptUrl;
  return copy;
}

/** Delivery state of the invitation e-mail, when the backend reports it. */
export type InviteEmailDelivery = 'QUEUED' | 'SENT' | 'FAILED';
