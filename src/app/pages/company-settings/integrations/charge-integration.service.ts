import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment as env } from '../../../../environments/environment';
import {
  ChargeIntegrationStatus,
  ConnectChargeIntegrationRequest,
} from './charge-integration.types';

const BASE = `${env.apiUrl}/companies/current/integrations/charge`;

/**
 * Cliente do endpoint generalizado `/integrations/charge`. Substitui
 * `AsaasIntegrationService` para novas telas — o serviço antigo permanece
 * enquanto a página legada `/company-settings/integrations/asaas` existir.
 */
@Injectable({ providedIn: 'root' })
export class ChargeIntegrationService {
  private readonly http = inject(HttpClient);

  private readonly _status = signal<ChargeIntegrationStatus | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly status = this._status.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();

  load(): Observable<ChargeIntegrationStatus> {
    this._loading.set(true);
    this._error.set(null);
    return this.http.get<ChargeIntegrationStatus>(BASE).pipe(
      tap((s) => this._status.set(s)),
      catchError((e: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar o status da integração.');
        return throwError(() => e);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  connect(payload: ConnectChargeIntegrationRequest): Observable<ChargeIntegrationStatus> {
    this._saving.set(true);
    return this.http.post<ChargeIntegrationStatus>(BASE, payload).pipe(
      tap((s) => this._status.set(s)),
      finalize(() => this._saving.set(false)),
    );
  }

  disconnect(): Observable<void> {
    this._saving.set(true);
    return this.http.delete<void>(BASE).pipe(
      tap(() => this._status.set({
        connected: false,
        provider: null,
        environment: null,
        connectedAt: null,
        lastVerifiedAt: null,
        webhookAutoConfigured: false,
      })),
      finalize(() => this._saving.set(false)),
    );
  }
}
