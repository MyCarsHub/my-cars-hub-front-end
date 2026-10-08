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
import { LicenseCategory } from './driver.types';

export type InviteRole = 'MANAGER' | 'DRIVER';

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';

/**
 * Dias que um convite continua valido — ESPELHO da constante do backend
 * `InvitesService.INVITE_TTL_DAYS` (`my-cars-hub-back-end`, `origin/main @ 09f165f`).
 *
 * O TTL e decisao do backend e nenhuma rota o expoe: `GET /v1/invites` devolve o
 * `expiresAt` de cada convite (e a lista mostra essa data real), mas os dois lugares que
 * PROMETEM a janela nao tem de onde le-la — o formulario de envio fala antes de existir
 * convite, e a tela publica de aceite so recebe `ValidateInviteResponse`, que nao carrega
 * expiracao alguma. Por isso o numero e espelhado aqui, UMA vez.
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

/** Item of `GET /v1/invites` and body of `POST /v1/invites` (201). */
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

/** Delivery state of the invitation e-mail, when the backend reports it. */
export type InviteEmailDelivery = 'QUEUED' | 'SENT' | 'FAILED';

/**
 * Body of `GET /v1/invites/validate/{rawToken}` — the only PUBLIC invite endpoint.
 * It works anonymously and tolerates a stale `Authorization` header, which is what
 * lets the accept screen render before the invitee has logged in.
 */
export interface ValidateInviteResponse {
  email: string;
  role: InviteRole;
  companyName: string;
  /** `true` when the invited e-mail already has a MyCarsHub account. */
  userExists: boolean;

  /**
   * FEAT-0167 — pre-fill for the invitee onboarding. OPTIONAL on purpose: a backend that
   * has not shipped these yet simply omits them, and the screen has to keep working.
   *
   * >>> THE CPF IS NOT HERE, AND THAT IS DELIBERATE. <<< This route is ANONYMOUS: whoever
   * holds the link reads the response. The invitee TYPES the CPF and the backend compares
   * it against the vault, so this screen cannot pre-fill it — there is nothing to pre-fill
   * from. Do not "add the missing field": its absence is the decision.
   */
  name?: string;
  phoneNumber?: string;
  /** `true` asks for the manager onboarding form before the accept call. */
  requiresManagerOnboarding?: boolean;
}

/**
 * Body of `POST /v1/invites/accept/{rawToken}` — FEAT-0167.
 *
 * Required for MANAGER; a DRIVER accept still posts NO body at all. CPF and phone may go
 * masked, the backend normalizes; `cpf` is what the backend checks against the vault, and
 * a mismatch comes back as `INVITE_CPF_MISMATCH`.
 */
export interface AcceptInviteRequest {
  name: string;
  cpf: string;
  phone: string;
}

/** Endereço do motorista no aceite — mesmos campos do cadastro manual. */
export interface InviteAddressRequest {
  street: string;
  number: string;
  complement: string;
  district: string;
  cep: string;
  city: string;
  uf: string;
}

/**
 * Corpo do aceite quando o convidado é MOTORISTA e ainda NÃO tem cadastro.
 *
 * Quem já tem cadastro continua postando SEM corpo nenhum — mandar um corpo nesse caso
 * pediria dados que o sistema já conhece.
 */
export interface DriverAcceptInviteRequest extends AcceptInviteRequest {
  licenseNumber: string;
  licenseCategory: LicenseCategory;
  licenseExpiry: string;
  address: InviteAddressRequest;
}

/**
 * Body of `POST /v1/invites/accept/{rawToken}`.
 *
 * `token` is a full ACCESS token already scoped to `companyId` — storing it is what
 * lets the invitee land straight inside the company, with no `/auth/select-company`
 * and no `/auth/me` round trip.
 */
export interface AcceptInviteResponse {
  message: string;
  token: string;
  companyId: string;
  companyName: string;
  role: InviteRole;
}
