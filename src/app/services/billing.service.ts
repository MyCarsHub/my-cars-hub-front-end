import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CheckoutRequest,
  CheckoutResponse,
  GatewayOverride,
  PlanResponse,
  SubscriptionResponse,
} from '../types/billing.types';

const API_BASE = `${environment.apiUrl}/billing`;

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);

  private readonly _plans = signal<PlanResponse[]>([]);
  private readonly _subscription = signal<SubscriptionResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly plans = this._plans.asReadonly();
  readonly subscription = this._subscription.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

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
   */
  startCheckout(
    planCode: string,
    gatewayOverride?: GatewayOverride,
  ): Observable<CheckoutResponse> {
    this._loading.set(true);
    this._error.set(null);
    const payload: CheckoutRequest = { planCode };
    if (gatewayOverride) {
      payload.gatewayOverride = gatewayOverride;
    }
    return this.http.post<CheckoutResponse>(`${API_BASE}/checkout`, payload).pipe(
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível iniciar o checkout. Tente novamente.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  cancel(): Observable<void> {
    this._loading.set(true);
    this._error.set(null);
    return this.http
      .post(`${API_BASE}/cancel`, {}, { responseType: 'text' })
      .pipe(
        map(() => void 0),
        tap(() => {
          this._subscription.update((s) =>
            s ? { ...s, cancelAtPeriodEnd: true } : s,
          );
        }),
        catchError((err: HttpErrorResponse) => {
          this._error.set('Não foi possível cancelar a assinatura. Tente novamente.');
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }
}
