import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import {
  AdminBillingIssue,
  AdminBillingIssuesQuery,
  AdminMrrBreakdown,
  AdminSubscriptionListItem,
  AdminSubscriptionsQuery,
} from '../../types/admin-billing.types';

const BASE = `${environment.apiUrl}/admin/billing`;

const DEFAULT_SIZE = 20;
const DEFAULT_DAYS = 30;

/**
 * Billing administrativo. Três recursos independentes sob o mesmo gate
 * `/v1/admin/**`: assinaturas paginadas, composição do MRR e problemas abertos.
 *
 * Cada um tem seu próprio `loading` e limpa o próprio estado em erro — uma falha
 * (ex.: 400 de `status` inválido) não pode apagar nem congelar os outros dois
 * blocos da tela.
 */
@Injectable({ providedIn: 'root' })
export class AdminBillingService {
  private readonly http = inject(HttpClient);

  private readonly _subscriptions = signal<AdminSubscriptionListItem[]>([]);
  private readonly _subscriptionsTotal = signal(0);
  private readonly _subscriptionsLoading = signal(false);

  /** Vocabulário aceito no filtro `status`, vindo do backend — nunca hardcoded. */
  private readonly _statuses = signal<string[]>([]);

  private readonly _mrr = signal<AdminMrrBreakdown | null>(null);
  private readonly _mrrLoading = signal(false);

  private readonly _issues = signal<AdminBillingIssue[]>([]);
  private readonly _issuesTotal = signal(0);
  private readonly _issuesLoading = signal(false);

  readonly subscriptions = this._subscriptions.asReadonly();
  readonly subscriptionsTotal = this._subscriptionsTotal.asReadonly();
  readonly subscriptionsLoading = this._subscriptionsLoading.asReadonly();
  readonly statuses = this._statuses.asReadonly();
  readonly mrr = this._mrr.asReadonly();
  readonly mrrLoading = this._mrrLoading.asReadonly();
  readonly issues = this._issues.asReadonly();
  readonly issuesTotal = this._issuesTotal.asReadonly();
  readonly issuesLoading = this._issuesLoading.asReadonly();

  /**
   * `status` inválido devolve **400**, não lista vazia. Por isso o erro limpa a
   * listagem: manter as linhas da consulta anterior sob um filtro que o backend
   * recusou daria ao admin um resultado que não corresponde ao que ele pediu.
   */
  loadSubscriptions(
    query: AdminSubscriptionsQuery = {},
  ): Observable<PagedResponse<AdminSubscriptionListItem>> {
    this._subscriptionsLoading.set(true);

    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    params = params.set('page', String(query.page ?? 0));
    params = params.set('size', String(query.size ?? DEFAULT_SIZE));

    return this.http
      .get<PagedResponse<AdminSubscriptionListItem>>(`${BASE}/subscriptions`, { params })
      .pipe(
        tap((res) => {
          this._subscriptions.set(res.content ?? []);
          this._subscriptionsTotal.set(res.total ?? 0);
        }),
        catchError((err: HttpErrorResponse) => {
          this._subscriptions.set([]);
          this._subscriptionsTotal.set(0);
          return throwError(() => err);
        }),
        finalize(() => this._subscriptionsLoading.set(false)),
      );
  }

  /**
   * Popula o dropdown de status. Falha aqui é silenciosa por decisão: a listagem
   * continua utilizável com o filtro em "todos".
   */
  loadStatuses(): Observable<string[]> {
    return this.http.get<string[]>(`${BASE}/statuses`).pipe(
      tap((res) => this._statuses.set(res ?? [])),
      catchError((err: HttpErrorResponse) => {
        this._statuses.set([]);
        return throwError(() => err);
      }),
    );
  }

  loadMrr(): Observable<AdminMrrBreakdown> {
    this._mrrLoading.set(true);
    return this.http.get<AdminMrrBreakdown>(`${BASE}/mrr`).pipe(
      tap((res) => this._mrr.set(res ?? null)),
      catchError((err: HttpErrorResponse) => {
        this._mrr.set(null);
        return throwError(() => err);
      }),
      finalize(() => this._mrrLoading.set(false)),
    );
  }

  loadIssues(
    query: AdminBillingIssuesQuery = {},
  ): Observable<PagedResponse<AdminBillingIssue>> {
    this._issuesLoading.set(true);

    const params = new HttpParams()
      .set('days', String(query.days ?? DEFAULT_DAYS))
      .set('page', String(query.page ?? 0))
      .set('size', String(query.size ?? DEFAULT_SIZE));

    return this.http.get<PagedResponse<AdminBillingIssue>>(`${BASE}/issues`, { params }).pipe(
      tap((res) => {
        this._issues.set(res.content ?? []);
        this._issuesTotal.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._issues.set([]);
        this._issuesTotal.set(0);
        return throwError(() => err);
      }),
      finalize(() => this._issuesLoading.set(false)),
    );
  }
}
