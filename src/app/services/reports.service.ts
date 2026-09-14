import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReportsOverviewResponse } from '../types/reports.types';
import { TenantResetRegistry } from './tenant-reset.registry';

const BASE = `${environment.apiUrl}/reports`;

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  private readonly _overview = signal<ReportsOverviewResponse | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly overview = this._overview.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Troca de empresa e fim de sessao zeram este cache (FIX-0272).
    inject(TenantResetRegistry).register(() => this.reset());
  }

  /**
   * Zera o cache para o estado inicial. Registrado no `TenantCachesService`:
   * o serviço é `providedIn: 'root'` e sobrevive tanto ao fim da sessão quanto
   * à TROCA DE EMPRESA, que não passa por `SessionService.clear()`. Sem isto a
   * empresa nova abre mostrando os relatórios da anterior (FIX-0272).
   */
  reset(): void {
    this._overview.set(null);
    this._loading.set(false);
    this._error.set(null);
  }

  loadOverview(from: string, to: string): Observable<ReportsOverviewResponse> {
    this._loading.set(true);
    this._error.set(null);
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<ReportsOverviewResponse>(`${BASE}/overview`, { params }).pipe(
      tap((res) => {
        this._overview.set(res);
        this._loading.set(false);
      }),
      catchError((err) => {
        this._error.set('Não foi possível carregar o relatório.');
        this._loading.set(false);
        return throwError(() => err);
      }),
    );
  }
}
