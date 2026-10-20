import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateInviteRequest,
  CreateInviteResponse,
  InviteResponse,
  ResendInviteResponse,
  withoutAcceptUrl,
} from '../types/invite.types';
import { TenantResetRegistry } from './tenant-reset.registry';

const BASE = `${environment.apiUrl}/invites`;

/** Reads the resend body without ever throwing: empty, non-JSON or a wrong shape is `{}`. */
function parseResendBody(body: unknown): ResendInviteResponse {
  if (typeof body !== 'string' || body.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(body);
    const url = (parsed as { acceptUrl?: unknown } | null)?.acceptUrl;
    return typeof url === 'string' && url.trim() !== '' ? { acceptUrl: url.trim() } : {};
  } catch {
    return {};
  }
}

/**
 * `/v1/invites` client + the signal cache the settings screen reads for its pending count.
 *
 * Endpoint notes that are NOT obvious from the URLs:
 *
 * - `resend` and `cancel` are keyed by the invite **UUID**, not by the raw token — the
 *   list endpoint never returns tokens, so the id is all the screen has.
 * - The invitee side (validate / accept by raw token) lives in `InviteFlowService`.
 *
 * The cache is company-scoped, so `reset()` is wired into logout the same way
 * `InsurancesService` / `AlertsService` are: `providedIn: 'root'` services outlive a
 * logout in the same tab and would otherwise show the previous tenant's invitee e-mails.
 */
@Injectable({ providedIn: 'root' })
export class InvitesService {
  private readonly http = inject(HttpClient);

  private readonly _invites = signal<InviteResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);

  readonly invites = this._invites.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** `true` once a `list()` has resolved — lets a screen tell "zero" from "unknown". */
  readonly loaded = this._loaded.asReadonly();

  /** Pending invites only. This is the number the settings screen shows. */
  readonly pendingCount = computed(
    () => this._invites().filter((invite) => invite.status === 'PENDING').length,
  );

  /** `GET /v1/invites` — any member of the company. Never includes tokens. */
  list(): Observable<InviteResponse[]> {
    this._loading.set(true);
    return this.http.get<InviteResponse[]>(BASE).pipe(
      tap({
        next: (invites) => {
          this._invites.set(invites ?? []);
          this._loaded.set(true);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  /**
   * `POST /v1/invites` — OWNER / MANAGER only. `role` OWNER is a 400.
   *
   * The response carries `acceptUrl`, which exists only here. The caller gets it; the list
   * cache does NOT — it holds the row without the link, so the one-time link cannot be read
   * back from a signal that outlives the screen.
   */
  create(payload: CreateInviteRequest): Observable<CreateInviteResponse> {
    return this.http
      .post<CreateInviteResponse>(BASE, payload)
      .pipe(tap((invite) => this._invites.update((list) => [withoutAcceptUrl(invite), ...list])));
  }

  /**
   * `POST /v1/invites/resend/{id}` — by invite id. 400 unless the invite is PENDING or
   * EXPIRED, 409 if the status changes mid-flight. It ROTATES the token: the previous link
   * stops working and the e-mail is sent again, counting towards the resend ceiling.
   *
   * The answer is `{ acceptUrl }` — the only way to get a link for an existing row. The body
   * is read as TEXT and parsed here, so an older backend that answers an empty body (or a
   * 204) is not an error: it resolves `{}`, which means "sent, but no link to show". The
   * caller still re-lists, so the new `expiresAt` comes from the server, not from a guess.
   */
  resend(id: string): Observable<ResendInviteResponse> {
    return this.http
      .post(`${BASE}/resend/${id}`, {}, { responseType: 'text' })
      .pipe(map((body) => parseResendBody(body)));
  }

  /** `DELETE /v1/invites/{id}` — 204, so `responseType: 'text'` per repo convention. */
  cancel(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._invites.update((list) => list.filter((invite) => invite.id !== id))),
    );
  }

  constructor() {
    // Troca de empresa e fim de sessao zeram este cache (FIX-0272).
    inject(TenantResetRegistry).register(() => this.reset());
  }

  /** Drops the tenant-scoped cache. Called on logout. */
  reset(): void {
    this._invites.set([]);
    this._loading.set(false);
    this._loaded.set(false);
  }
}
