import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { Membership, MembershipsResponse, PendingInvite } from '../types/membership.type';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { SessionResetRegistry } from './session-reset.registry';

/** `idle` = never asked; `unavailable` = the endpoint failed (older backend): callers fall back. */
export type MembershipsStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Every company the person belongs to, plus invites waiting for them
 * (`GET /auth/memberships`).
 *
 * Loaded lazily — once after login/shell start and again whenever the switcher opens. A
 * failure (404 on a backend that does not have the endpoint yet, network) is NOT an error
 * for the user: the status becomes `unavailable` and the layout keeps using the
 * `userCompanies` list from `/auth/me`, which is exactly today's behaviour. The request is
 * silent for that reason.
 */
@Injectable({ providedIn: 'root' })
export class MembershipsService {
  private readonly http = inject(HttpClient);

  constructor() {
    // Any `SessionService.clear()` (logout, 401, guard) drops the previous person's list.
    inject(SessionResetRegistry).register(() => this.reset());
  }

  private readonly _memberships = signal<Membership[]>([]);
  private readonly _pendingInvites = signal<PendingInvite[]>([]);
  private readonly _defaultCompanyId = signal<string | null>(null);
  private readonly _status = signal<MembershipsStatus>('idle');

  readonly memberships = this._memberships.asReadonly();
  readonly pendingInvites = this._pendingInvites.asReadonly();
  readonly defaultCompanyId = this._defaultCompanyId.asReadonly();
  readonly status = this._status.asReadonly();

  readonly active = computed(() => this._memberships().filter((m) => m.status === 'ACTIVE'));
  readonly onboarding = computed(() => this._memberships().filter((m) => m.status === 'ONBOARDING'));

  /** Loads once; pass `force` to refresh (the switcher does when it opens). */
  load(force = false): void {
    const status = this._status();
    if (status === 'loading') return;
    if (!force && (status === 'ready' || status === 'unavailable')) return;
    this._status.set('loading');
    const context = new HttpContext().set(SILENT_HTTP_ERRORS, true);
    this.http
      .get<MembershipsResponse>(`${environment.apiUrl}/auth/memberships`, { context })
      .subscribe({
        next: (res) => this.apply(res),
        error: () => this._status.set(this._memberships().length > 0 ? 'ready' : 'unavailable'),
      });
  }

  /** `/auth/me` carries the same data on a current backend: no second request needed. */
  seedFromMe(me: {
    memberships?: Membership[] | null;
    pendingInvites?: PendingInvite[] | null;
    defaultCompanyId?: string | null;
  }): void {
    if (!Array.isArray(me.memberships)) return;
    this.apply({
      memberships: me.memberships,
      pendingInvites: me.pendingInvites ?? [],
      defaultCompanyId: me.defaultCompanyId ?? null,
    });
  }

  /** Logout / session end: nothing of the previous person may linger. */
  reset(): void {
    this._memberships.set([]);
    this._pendingInvites.set([]);
    this._defaultCompanyId.set(null);
    this._status.set('idle');
  }

  private apply(res: Partial<MembershipsResponse> | null | undefined): void {
    this._memberships.set(Array.isArray(res?.memberships) ? res.memberships : []);
    this._pendingInvites.set(Array.isArray(res?.pendingInvites) ? res.pendingInvites : []);
    this._defaultCompanyId.set(res?.defaultCompanyId ?? null);
    this._status.set('ready');
  }
}
