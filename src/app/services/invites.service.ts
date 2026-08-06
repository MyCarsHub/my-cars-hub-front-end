import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AcceptInviteResponse,
  CreateInviteRequest,
  InviteResponse,
  ValidateInviteResponse,
} from '../types/invite.types';

const BASE = `${environment.apiUrl}/invites`;

/**
 * `/v1/invites` client + the signal cache the settings screen reads for its pending count.
 *
 * Endpoint notes that are NOT obvious from the URLs:
 *
 * - `validate` is the only public route. It is called before login, so it must never be
 *   wrapped in anything that assumes a session.
 * - `resend` and `cancel` are keyed by the invite **UUID**, not by the raw token — the
 *   list endpoint never returns tokens, so the id is all the screen has.
 * - `accept` returns a company-scoped ACCESS token; the caller persists it.
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

  /** `POST /v1/invites` — OWNER / MANAGER only. `role` OWNER is a 400. */
  create(payload: CreateInviteRequest): Observable<InviteResponse> {
    return this.http
      .post<InviteResponse>(BASE, payload)
      .pipe(tap((invite) => this._invites.update((list) => [invite, ...list])));
  }

  /**
   * `POST /v1/invites/resend/{id}` — by invite id. 400 unless the invite is PENDING or
   * EXPIRED, 409 if the status changes mid-flight. The body is ignored: the caller
   * re-lists so the new `expiresAt` comes from the server, not from a guess.
   */
  resend(id: string): Observable<void> {
    return this.http.post(`${BASE}/resend/${id}`, {}, { responseType: 'text' }).pipe(
      map(() => void 0),
    );
  }

  /** `DELETE /v1/invites/{id}` — 204, so `responseType: 'text'` per repo convention. */
  cancel(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._invites.update((list) => list.filter((invite) => invite.id !== id))),
    );
  }

  /**
   * `GET /v1/invites/validate/{rawToken}` — PUBLIC. Works anonymously and tolerates a
   * stale `Authorization` header, and never writes. Rate limited to 20 req/min per IP.
   */
  validate(rawToken: string): Observable<ValidateInviteResponse> {
    return this.http.get<ValidateInviteResponse>(
      `${BASE}/validate/${encodeURIComponent(rawToken)}`,
    );
  }

  /**
   * `POST /v1/invites/accept/{rawToken}` — authenticated, and deliberately accepts a
   * TEMPORALLY token: the invitee has just logged in with Google and belongs to no
   * company yet, so a company-scoped token cannot exist at this point.
   */
  accept(rawToken: string): Observable<AcceptInviteResponse> {
    return this.http.post<AcceptInviteResponse>(
      `${BASE}/accept/${encodeURIComponent(rawToken)}`,
      {},
    );
  }

  /** Drops the tenant-scoped cache. Called on logout. */
  reset(): void {
    this._invites.set([]);
    this._loading.set(false);
    this._loaded.set(false);
  }
}
