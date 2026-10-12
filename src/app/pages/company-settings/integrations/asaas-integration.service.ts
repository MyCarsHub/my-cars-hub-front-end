import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  AsaasIntegrationStatus,
  ConnectAsaasRequest,
} from './asaas-integration.types';

const BASE = `${environment.apiUrl}/companies/current/integrations/asaas`;

/**
 * Owns the Asaas integration lifecycle for the current company.
 * Backend endpoints (may not be deployed yet — contract mocked by callers if needed):
 *   GET    /companies/current/integrations/asaas       -> AsaasIntegrationStatus
 *   POST   /companies/current/integrations/asaas       -> AsaasIntegrationStatus
 *   DELETE /companies/current/integrations/asaas       -> 204
 */
@Injectable({ providedIn: 'root' })
export class AsaasIntegrationService {
  private readonly http = inject(HttpClient);

  private readonly _status = signal<AsaasIntegrationStatus | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _webhookBusy = signal(false);

  readonly status = this._status.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  /** Re-registro do webhook em voo — separado de `saving` para não travar o resto. */
  readonly webhookBusy = this._webhookBusy.asReadonly();

  load(): Observable<AsaasIntegrationStatus> {
    this._loading.set(true);
    this._error.set(null);
    return this.http.get<AsaasIntegrationStatus>(BASE).pipe(
      tap((res) => this._status.set(res)),
      catchError((err: HttpErrorResponse) => {
        // 404 → treat as "not connected" so the initial UI can show the connect state.
        if (err.status === 404) {
          const empty: AsaasIntegrationStatus = {
            connected: false,
            environment: null,
            connectedAt: null,
            lastVerifiedAt: null,
          };
          this._status.set(empty);
          return throwError(() => err);
        }
        this._error.set('Não foi possível carregar o status da integração.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  connect(payload: ConnectAsaasRequest): Observable<AsaasIntegrationStatus> {
    this._saving.set(true);
    this._error.set(null);
    return this.http.post<AsaasIntegrationStatus>(BASE, payload).pipe(
      tap((res) => this._status.set(res)),
      catchError((err: HttpErrorResponse) => throwError(() => err)),
      finalize(() => this._saving.set(false)),
    );
  }

  /**
   * Registra o webhook de novo na conta Asaas já conectada, sem pedir a chave.
   * A recusa do Asaas NÃO é erro HTTP: volta 200 com `webhookStatus = 'FAILED'`
   * e o motivo, então quem chama lê o status devolvido.
   *
   *   POST /companies/current/integrations/asaas/webhook -> AsaasIntegrationStatus
   */
  reregisterWebhook(): Observable<AsaasIntegrationStatus> {
    this._webhookBusy.set(true);
    return this.http.post<AsaasIntegrationStatus>(`${BASE}/webhook`, {}).pipe(
      tap((res) => this._status.set(res)),
      finalize(() => this._webhookBusy.set(false)),
    );
  }

  disconnect(): Observable<void> {
    this._saving.set(true);
    this._error.set(null);
    return this.http.delete<void>(BASE).pipe(
      tap(() =>
        this._status.set({
          connected: false,
          environment: null,
          connectedAt: null,
          lastVerifiedAt: null,
        }),
      ),
      catchError((err: HttpErrorResponse) => throwError(() => err)),
      finalize(() => this._saving.set(false)),
    );
  }
}
