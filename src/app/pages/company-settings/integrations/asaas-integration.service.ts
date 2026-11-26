import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import {
  AsaasEnvironment,
  AsaasIntegrationStatus,
  AsaasOverview,
  ConnectAsaasRequest,
} from './asaas-integration.types';

const BASE = `${environment.apiUrl}/companies/current/integrations/asaas`;

const DISCONNECTED: AsaasIntegrationStatus = {
  connected: false,
  environment: null,
  connectedAt: null,
  lastVerifiedAt: null,
};

/**
 * Owns the Asaas integration lifecycle for the current company.
 *   GET    /companies/current/integrations/asaas                    -> AsaasIntegrationStatus
 *   GET    /companies/current/integrations/asaas/overview           -> AsaasOverview (só leitura)
 *   POST   /companies/current/integrations/asaas                    -> AsaasIntegrationStatus
 *   POST   /companies/current/integrations/asaas/webhook            -> AsaasIntegrationStatus
 *   PUT    /companies/current/integrations/asaas/active-environment -> AsaasIntegrationStatus (só admin)
 *   DELETE /companies/current/integrations/asaas                    -> 204
 */
@Injectable({ providedIn: 'root' })
export class AsaasIntegrationService {
  private readonly http = inject(HttpClient);

  private readonly _status = signal<AsaasIntegrationStatus | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _webhookBusy = signal(false);
  private readonly _overview = signal<AsaasOverview | null>(null);
  private readonly _overviewLoading = signal(false);
  private readonly _overviewError = signal(false);
  private readonly _overviewDenied = signal(false);
  private readonly _switching = signal(false);

  readonly status = this._status.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  /** Re-registro do webhook em voo — separado de `saving` para não travar o resto. */
  readonly webhookBusy = this._webhookBusy.asReadonly();
  readonly overview = this._overview.asReadonly();
  readonly overviewLoading = this._overviewLoading.asReadonly();
  /** A leitura do overview falhou (rede/servidor). Falha do Asaas NÃO é isto: vem em `asaasError`. */
  readonly overviewError = this._overviewError.asReadonly();
  /** 402/403: quem está vendo não é dono, gerente nem admin — os números não são para ele. */
  readonly overviewDenied = this._overviewDenied.asReadonly();
  readonly switching = this._switching.asReadonly();

  load(): Observable<AsaasIntegrationStatus> {
    this._loading.set(true);
    this._error.set(null);
    return this.http.get<AsaasIntegrationStatus>(BASE).pipe(
      tap((res) => this._status.set(res)),
      catchError((err: HttpErrorResponse) => {
        // 404 → treat as "not connected" so the initial UI can show the connect state.
        if (err.status === 404) {
          this._status.set(DISCONNECTED);
          return throwError(() => err);
        }
        this._error.set('Não foi possível carregar o status da integração.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Leitura discreta para a faixa de testes da casca (só admin, uma vez por sessão da casca):
   * não mexe em `loading`/`error` da página, não mostra toast (a tela não é dela) e não pede de
   * novo se o status já está carregado ou a caminho. Falha = sem faixa.
   */
  loadQuietly(): void {
    if (this._status() !== null || this.quietInFlight) return;
    this.quietInFlight = true;
    this.http
      .get<AsaasIntegrationStatus>(BASE, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .pipe(finalize(() => (this.quietInFlight = false)))
      .subscribe({
        next: (res) => {
          if (this._status() === null) this._status.set(res);
        },
        error: () => void 0,
      });
  }
  private quietInFlight = false;

  /**
   * Números do caminho do dinheiro, saldo, taxas e recebimentos. 404 = sem integração
   * (corrida com uma desconexão): limpa o overview em vez de acusar erro. 402 = papel sem
   * acesso (só OWNER/MANAGER/ADMIN): vira o estado "sem acesso", não um erro de rede — e
   * NÃO é o paywall da assinatura. A tela é dona de todos os status desta leitura
   * (`OWNED_HTTP_ERRORS`): nenhum toast genérico; 401/sessão vencida seguem com o interceptor.
   */
  loadOverview(): Observable<AsaasOverview> {
    this._overviewLoading.set(true);
    this._overviewError.set(false);
    this._overviewDenied.set(false);
    return this.http
      .get<AsaasOverview>(`${BASE}/overview`, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .pipe(
        tap((res) => this._overview.set(res)),
        catchError((err: HttpErrorResponse) => {
          if (err.status === 404) {
            this._overview.set(null);
          } else if (err.status === 402 || err.status === 403) {
            this._overview.set(null);
            this._overviewDenied.set(true);
          } else {
            this._overviewError.set(true);
          }
          return throwError(() => err);
        }),
        finalize(() => this._overviewLoading.set(false)),
      );
  }

  connect(payload: ConnectAsaasRequest): Observable<AsaasIntegrationStatus> {
    this._saving.set(true);
    this._error.set(null);
    return this.http.post<AsaasIntegrationStatus>(BASE, payload).pipe(
      tap((res) => this._status.set(res)),
      finalize(() => this._saving.set(false)),
    );
  }

  /**
   * Registra o webhook de novo na conta Asaas já conectada, sem pedir a chave.
   * A recusa do Asaas NÃO é erro HTTP: volta 200 com `webhookStatus = 'FAILED'`
   * e o motivo, então quem chama lê o status devolvido.
   */
  reregisterWebhook(): Observable<AsaasIntegrationStatus> {
    this._webhookBusy.set(true);
    return this.http.post<AsaasIntegrationStatus>(`${BASE}/webhook`, {}).pipe(
      tap((res) => this._status.set(res)),
      finalize(() => this._webhookBusy.set(false)),
    );
  }

  /** Troca a chave ativa (só PLATFORM_ADMIN). 409 com `code` quando a troca é recusada. */
  switchEnvironment(target: AsaasEnvironment): Observable<AsaasIntegrationStatus> {
    this._switching.set(true);
    return this.http
      .put<AsaasIntegrationStatus>(`${BASE}/active-environment`, { environment: target })
      .pipe(
        tap((res) => this._status.set(res)),
        finalize(() => this._switching.set(false)),
      );
  }

  disconnect(): Observable<void> {
    this._saving.set(true);
    this._error.set(null);
    return this.http.delete<void>(BASE).pipe(
      tap(() => {
        this._status.set(DISCONNECTED);
        this._overview.set(null);
      }),
      finalize(() => this._saving.set(false)),
    );
  }
}
