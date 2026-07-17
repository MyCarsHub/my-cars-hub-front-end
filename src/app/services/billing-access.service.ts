import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AccessStatus } from '../types/billing-access.types';
import { SessionService } from './session.service';

const API_URL = `${environment.apiUrl}/billing/access-status`;

/**
 * TODO(backend): Remove USE_MOCK once `GET /v1/billing/access-status` (brief §5.4)
 * is deployed. Set to `false` to hit the real endpoint. Kept as a runtime flag
 * so the frontend can be validated before backend Phase 4 ships.
 */
const USE_MOCK = false;

@Injectable({ providedIn: 'root' })
export class BillingAccessService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  private readonly _status = signal<AccessStatus | null>(null);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);

  readonly status = this._status.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  readonly isBlocked = computed(() => {
    // PLATFORM_ADMIN never gets blocked (brief Q1).
    if (this.session.isPlatformAdmin()) return false;
    return this._status()?.blocked === true;
  });

  readonly reason = computed(() => this._status()?.reason ?? null);

  /**
   * Load the current access status. Cached in memory; use `refresh()` to force.
   */
  load(): Observable<AccessStatus | null> {
    if (this._loaded()) {
      return of(this._status());
    }
    return this.refresh();
  }

  refresh(): Observable<AccessStatus | null> {
    // Skip while the user is still onboarding — they hold a TEMPORALLY-scoped
    // token that isn't allowed on billing endpoints and would 403.
    if (!this.session.isOnboardingCompleted()) {
      this._loaded.set(true);
      this._status.set(null);
      return of(null);
    }
    if (USE_MOCK) {
      const mock: AccessStatus = {
        status: 'TRIAL_ACTIVE',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        graceEndsAt: null,
        plan: null,
        blocked: false,
        reason: null,
      };
      this._status.set(mock);
      this._loaded.set(true);
      return of(mock);
    }

    this._loading.set(true);
    return this.http.get<AccessStatus>(API_URL).pipe(
      tap((s) => {
        this._status.set(s);
        this._loaded.set(true);
        this._loading.set(false);
      }),
      catchError((err: HttpErrorResponse) => {
        this._loading.set(false);
        // Fail-open on network/5xx so a flaky backend can't lock everyone out.
        // Real backend blocking still enforced server-side on write endpoints.
        if (err.status === 0 || err.status >= 500) {
          this._loaded.set(true);
          return of(null);
        }
        this._loaded.set(true);
        return of(null);
      }),
    );
  }
}
