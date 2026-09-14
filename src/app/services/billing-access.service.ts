import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
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

  /**
   * Zera a decisão de acesso. Mais forte que `invalidate()`, que só marca o
   * cache como vencido e deixa `isBlocked` respondendo com a decisão ANTERIOR
   * até a próxima resposta chegar. Numa troca de empresa isso é a decisão de
   * OUTRA empresa — bloqueio ou liberação — valendo por alguns instantes na
   * empresa nova (FIX-0272).
   */
  reset(): void {
    this._status.set(null);
    this._loading.set(false);
    this._loaded.set(false);
    this.retireInFlight();
  }

  /**
   * Geração da decisão corrente. Incrementá-la APOSENTA qualquer `refresh()`
   * em voo: a resposta dele é anterior à transição que o invalidou e, gravada,
   * marcaria o cache como carregado com a decisão VELHA — o paywall continuaria
   * de pé depois do upgrade até um recarregamento da página. Mesmo padrão do
   * `FleetActivationService` (FIX-0273).
   */
  private generation = 0;

  private retireInFlight(): void {
    this.generation++;
  }

  /**
   * Grava a decisão só se esta resposta ainda for a corrente e devolve a que
   * vale — quem assinou uma requisição aposentada recebe a decisão fresca em
   * vez da que acabou de ser descartada.
   */
  private commit(status: AccessStatus | null, generation: number): AccessStatus | null {
    this._loading.set(false);
    if (generation !== this.generation) return this._status();
    this._status.set(status);
    this._loaded.set(true);
    return status;
  }

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

  /**
   * Drop the cached status so the next `load()` hits the backend. Called on
   * every subscription transition (checkout started, cancel, downgrade,
   * reactivate, return from the gateway) — without this the guard/paywall
   * keep the stale decision until a full page reload.
   */
  invalidate(): void {
    this._loaded.set(false);
    this.retireInFlight();
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

    // Carimbo desta requisição: `invalidate()`/`reset()` durante o voo o tornam
    // obsoleto e a resposta é descartada em `commit()`.
    const generation = this.generation;
    this._loading.set(true);
    return this.http.get<AccessStatus>(API_URL).pipe(
      map((s) => this.commit(s, generation)),
      catchError((err: HttpErrorResponse) => {
        // Fail-OPEN only for transport/server faults, so a flaky backend can't
        // lock every tenant out. This guard is UX, not security — the real
        // enforcement is server-side on the write endpoints.
        if (err.status === 0 || err.status >= 500) {
          return of(this.commit(null, generation));
        }

        // 401 belongs to the auth layer (interceptor + authGuard); pretending
        // the tenant is blocked would fight the logout redirect.
        if (err.status === 401) {
          return of(this.commit(null, generation));
        }

        // Any other 4xx (403 / 404 / 422 …) means we could not prove access.
        // Fail-CLOSED: treat as blocked so the paywall shows instead of a
        // silently unlocked app.
        const blocked: AccessStatus = {
          status: 'BLOCKED',
          trialEndsAt: null,
          graceEndsAt: null,
          plan: null,
          blocked: true,
          reason: 'NO_SUBSCRIPTION',
        };
        return of(this.commit(blocked, generation));
      }),
    );
  }
}
