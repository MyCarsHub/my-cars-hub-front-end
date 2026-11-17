import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, finalize, tap, throwError } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AdminRevenue, AdminRevenuePeriod } from '../../../types/admin-revenue.types';

/**
 * Receita da plataforma para a Visão geral do admin. Estado próprio: uma falha aqui não apaga os
 * cartões do overview, que vêm de outra rota.
 */
@Injectable({ providedIn: 'root' })
export class AdminRevenueService {
  private readonly http = inject(HttpClient);

  private readonly _revenue = signal<AdminRevenue | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly revenue = this._revenue.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(period: AdminRevenuePeriod) {
    this._loading.set(true);
    this._error.set(null);
    return this.http
      .get<AdminRevenue>(`${environment.apiUrl}/admin/billing/revenue`, {
        params: new HttpParams().set('period', period),
      })
      .pipe(
        tap((res) => this._revenue.set(res)),
        catchError((err: unknown) => {
          this._error.set('Não foi possível carregar a receita da plataforma.');
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }
}
