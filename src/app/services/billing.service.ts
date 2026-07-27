import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, switchMap, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CheckoutRequest,
  CheckoutResponse,
  DowngradeRequest,
  GatewayOverride,
  PlanResponse,
  SubscriptionChangeResponse,
  SubscriptionResponse,
} from '../types/billing.types';
import { BillingAccessService } from './billing-access.service';

const API_BASE = `${environment.apiUrl}/billing`;

/**
 * sessionStorage marker so a same-tab checkout redirect survives the round-trip.
 * Shared by `/billing` and `/billing/success` — the gateway returns to EITHER,
 * so both are responsible for clearing it once the round-trip is over.
 */
export const CHECKOUT_PENDING_KEY = 'billingCheckoutPending';

/**
 * Plan code the pending checkout was opened for. Stripe uses the SAME return
 * URL for success and cancel, so this is the only way `/billing/success` can
 * tell "the payment landed" from "the user backed out and was already ACTIVE".
 */
export const CHECKOUT_PLAN_CODE_KEY = 'billingCheckoutPlanCode';

/** Pull the backend's `{ message }` out of a 4xx body, else use the fallback. */
const backendMessage = (err: HttpErrorResponse, fallback: string): string => {
  const body: unknown = err.error;
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

/**
 * Is the subscription in force sitting on a FREE plan?
 *
 * After an applied downgrade the backend leaves the subscription `ACTIVE` on
 * the free plan with `currentPeriodEnd: null` (it used to be `TRIALING`), so
 * `status === 'ACTIVE'` alone no longer means "paid subscription in force".
 * The plan PRICE is the ONLY discriminator, and it requires POSITIVE evidence:
 * the `/plans` row backing `sub.planCode` must exist and cost zero.
 *
 * Absence of data is never proof of a free plan. A missing row means `/plans`
 * failed or has not landed yet, and the previous `currentPeriodEnd === null`
 * fallback turned that gap into "gratuito" — which hid "Cancelar assinatura"
 * from a PAYING customer whose period end was momentarily null, for the whole
 * session if `/plans` stayed down. This also aligns the rule with
 * `canReactivate()`, which already reads a null period end as "unknown, not
 * expired". When in doubt we classify as PAID: offering a cancel button that
 * the backend may refuse is strictly better than withholding it from someone
 * being charged.
 */
export const isFreePlanInForce = (
  sub: SubscriptionResponse | null,
  plans: readonly PlanResponse[],
): boolean => {
  if (!sub || sub.status !== 'ACTIVE') return false;
  const row = plans.find((p) => p.code === sub.planCode);
  return row ? row.price <= 0 : false;
};

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);
  private readonly access = inject(BillingAccessService);

  private readonly _plans = signal<PlanResponse[]>([]);
  private readonly _subscription = signal<SubscriptionResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly plans = this._plans.asReadonly();
  readonly subscription = this._subscription.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  clearError(): void {
    this._error.set(null);
  }

  loadPlans(): Observable<PlanResponse[]> {
    this._loading.set(true);
    this._error.set(null);
    return this.http.get<PlanResponse[]>(`${API_BASE}/plans`).pipe(
      tap((plans) => this._plans.set(plans ?? [])),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os planos. Tente novamente.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  loadSubscription(): Observable<SubscriptionResponse | null> {
    this._loading.set(true);
    this._error.set(null);
    return this.http.get<SubscriptionResponse>(`${API_BASE}/subscription`).pipe(
      tap((sub) => this._subscription.set(sub ?? null)),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 404) {
          this._subscription.set(null);
          return of(null);
        }
        this._error.set('Não foi possível carregar sua assinatura. Tente novamente.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * @param planCode Fully-qualified plan code (e.g. `PRO_MONTHLY_STRIPE`).
   *                 The specific row already encodes name + period + gateway;
   *                 no separate billing cycle argument is needed.
   *
   * Upgrades and first subscriptions ONLY. Downgrades must go through
   * `downgrade()` — routing them here produced a R$ 0,00 checkout.
   */
  startCheckout(planCode: string, gatewayOverride?: GatewayOverride): Observable<CheckoutResponse> {
    this._loading.set(true);
    this._error.set(null);
    const payload: CheckoutRequest = { planCode };
    if (gatewayOverride) {
      payload.gatewayOverride = gatewayOverride;
    }
    return this.http.post<CheckoutResponse>(`${API_BASE}/checkout`, payload).pipe(
      // A started checkout can change entitlement the moment it is paid.
      tap(() => this.access.invalidate()),
      catchError((err: HttpErrorResponse) => {
        this._error.set(
          backendMessage(err, 'Não foi possível iniciar o pagamento. Tente novamente.'),
        );
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Schedule the move to the FREE plan at the end of the paid period.
   * NEVER hits `/checkout` and never returns a redirect URL.
   *
   * The backend rejects a PAID `planCode` with 400 ("…exige um novo checkout"),
   * so paid→paid changes must go through `startCheckout()` instead.
   *
   * @param planCode Target free plan. Omit to let the backend pick it.
   */
  downgrade(planCode?: string): Observable<SubscriptionChangeResponse> {
    const body: DowngradeRequest = planCode ? { planCode } : {};
    return this.mutate(
      this.http.post<SubscriptionChangeResponse>(`${API_BASE}/downgrade`, body),
      'Não foi possível alterar o plano. Tente novamente.',
    );
  }

  /** Undo a scheduled cancellation. 400 means the user must pay again. */
  reactivate(): Observable<SubscriptionChangeResponse> {
    return this.mutate(
      this.http.post<SubscriptionChangeResponse>(`${API_BASE}/reactivate`, {}),
      'Não foi possível reativar a assinatura. Tente novamente.',
    );
  }

  cancel(): Observable<void> {
    this._loading.set(true);
    this._error.set(null);
    return this.http.post(`${API_BASE}/cancel`, {}, { responseType: 'text' }).pipe(
      map(() => void 0),
      // No optimistic `cancelAtPeriodEnd` write here — the backend is the
      // source of truth and the caller re-reads `/subscription`.
      tap(() => this.access.invalidate()),
      catchError((err: HttpErrorResponse) => {
        this._error.set(
          backendMessage(err, 'Não foi possível cancelar a assinatura. Tente novamente.'),
        );
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Shared pipeline for the state-changing endpoints: invalidate the access
   * cache, re-read the subscription from the backend, surface `{message}`.
   */
  private mutate(
    request$: Observable<SubscriptionChangeResponse>,
    fallbackMessage: string,
  ): Observable<SubscriptionChangeResponse> {
    this._loading.set(true);
    this._error.set(null);
    return request$.pipe(
      tap(() => this.access.invalidate()),
      switchMap((res) =>
        this.http.get<SubscriptionResponse>(`${API_BASE}/subscription`).pipe(
          tap((sub) => this._subscription.set(sub ?? null)),
          map(() => res),
          catchError(() => of(res)),
        ),
      ),
      catchError((err: HttpErrorResponse) => {
        this._error.set(backendMessage(err, fallbackMessage));
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }
}
