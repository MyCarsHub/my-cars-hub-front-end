import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminOverviewResponse } from '../types/admin-overview.types';

@Injectable({ providedIn: 'root' })
export class AdminMetricsService {
  private readonly http = inject(HttpClient);

  private readonly _overview = signal<AdminOverviewResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly overview = this._overview.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  loadOverview() {
    this._loading.set(true);
    this._error.set(null);
    return this.http
      .get<AdminOverviewResponse>(`${environment.apiUrl}/admin/metrics/overview`)
      .pipe(
        tap((res) => this._overview.set(res)),
        catchError((err: HttpErrorResponse) => {
          this._error.set(
            'Não foi possível carregar as métricas. Tente novamente.',
          );
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }
}
