import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import { SessionService } from '../../../services/session.service';
import { TenantResetRegistry } from '../../../services/tenant-reset.registry';
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
 *
 * ## Estado por empresa
 *
 * É um serviço de raiz e guarda dado da EMPRESA (saldo, nome e CNPJ da conta, motoristas,
 * placas e valores). Por isso se registra no `TenantResetRegistry`, que roda no logout, na
 * troca de empresa e ao entrar e sair de "ver como empresa": tudo volta a `null`. Cada
 * resposta carrega a "época" em que foi pedida; uma resposta de antes do reset é descartada,
 * então uma requisição em voo da empresa anterior nunca repinta a tela da seguinte.
 */
@Injectable({ providedIn: 'root' })
export class AsaasIntegrationService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  private readonly _status = signal<AsaasIntegrationStatus | null>(null);
  private readonly _statusToken = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _webhookBusy = signal(false);
  private readonly _overview = signal<AsaasOverview | null>(null);
  private readonly _overviewLoading = signal(false);
  private readonly _overviewError = signal(false);
  private readonly _overviewDenied = signal(false);
  private readonly _switching = signal(false);
  private readonly _epoch = signal(0);
  private quietInFlight = false;

  readonly status = this._status.asReadonly();
  /** O token com que o `status` atual foi lido: a faixa da casca só confia nele se for o de agora. */
  readonly statusToken = this._statusToken.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  /** Re-registro do webhook em voo — separado de `saving` para não travar o resto. */
  readonly webhookBusy = this._webhookBusy.asReadonly();
  readonly overview = this._overview.asReadonly();
  readonly overviewLoading = this._overviewLoading.asReadonly();
  /** A leitura do overview falhou (rede/servidor). Falha do Asaas NÃO é isto: vem em `asaasError`. */
  readonly overviewError = this._overviewError.asReadonly();
  /** 402/403 no overview: a integração não está disponível para quem está vendo. */
  readonly overviewDenied = this._overviewDenied.asReadonly();
  readonly switching = this._switching.asReadonly();
  /** Sobe a cada troca de contexto (logout, empresa, impersonação): quem depende do contexto reavalia. */
  readonly epoch = this._epoch.asReadonly();

  constructor() {
    inject(TenantResetRegistry).register(() => this.reset());
  }

  /** Esquece tudo da empresa anterior. Chamado pelo `TenantResetRegistry`. */
  reset(): void {
    this._epoch.update((e) => e + 1);
    this._status.set(null);
    this._statusToken.set(null);
    this._error.set(null);
    this.forgetOverview();
    this.quietInFlight = false;
  }

  /** A página chama ao abrir: nada de números de uma visita anterior antes da resposta nova. */
  forgetOverview(): void {
    this._overview.set(null);
    this._overviewError.set(false);
    this._overviewDenied.set(false);
  }

  load(): Observable<AsaasIntegrationStatus> {
    const epoch = this._epoch();
    this._loading.set(true);
    this._error.set(null);
    return this.http.get<AsaasIntegrationStatus>(BASE).pipe(
      tap((res) => this.setStatus(res, epoch)),
      catchError((err: HttpErrorResponse) => {
        if (this._epoch() === epoch) {
          // 404 → "não ligado"; qualquer outra falha não deixa status nenhum para trás.
          this.setStatus(err.status === 404 ? DISCONNECTED : null, epoch);
          if (err.status !== 404)
            this._error.set('Não foi possível carregar o status da integração.');
        }
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Leitura discreta para a faixa de testes da casca (só admin): não mexe em `loading`/`error`
   * da página, não mostra toast (a tela não é dela) e não pede de novo se o status já foi lido
   * com o token atual ou está a caminho. Falha = sem faixa.
   */
  loadQuietly(): void {
    const token = this.currentToken();
    if (this.quietInFlight) return;
    if (this._status() !== null && this._statusToken() === token) return;
    const epoch = this._epoch();
    this.quietInFlight = true;
    this.http
      .get<AsaasIntegrationStatus>(BASE, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .pipe(
        finalize(() => {
          if (this._epoch() === epoch) this.quietInFlight = false;
        }),
      )
      .subscribe({ next: (res) => this.setStatus(res, epoch), error: () => void 0 });
  }

  /**
   * Releitura do status para "Testar a conexão": sucesso atualiza, falha não apaga o que já
   * está na tela (a página não vira estado de erro por causa de um teste).
   */
  refreshStatus(): void {
    const epoch = this._epoch();
    this.http
      .get<AsaasIntegrationStatus>(BASE, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .subscribe({ next: (res) => this.setStatus(res, epoch), error: () => void 0 });
  }

  /**
   * Números do caminho do dinheiro, saldo, taxas e recebimentos. Qualquer falha limpa o
   * overview (nunca sobra número velho na tela). 404 = sem integração. 402/403 = a integração
   * não está disponível para quem está vendo — NÃO é o paywall da assinatura. A tela é dona de
   * todos os status desta leitura (`OWNED_HTTP_ERRORS`): nenhum toast genérico; 401/sessão
   * vencida seguem com o interceptor.
   */
  loadOverview(): Observable<AsaasOverview> {
    const epoch = this._epoch();
    this._overviewLoading.set(true);
    this._overviewError.set(false);
    this._overviewDenied.set(false);
    return this.http
      .get<AsaasOverview>(`${BASE}/overview`, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .pipe(
        tap((res) => {
          if (this._epoch() === epoch) this._overview.set(res);
        }),
        catchError((err: HttpErrorResponse) => {
          if (this._epoch() === epoch) {
            this._overview.set(null);
            if (err.status === 402 || err.status === 403) this._overviewDenied.set(true);
            else if (err.status !== 404) this._overviewError.set(true);
          }
          return throwError(() => err);
        }),
        finalize(() => this._overviewLoading.set(false)),
      );
  }

  connect(payload: ConnectAsaasRequest): Observable<AsaasIntegrationStatus> {
    const epoch = this._epoch();
    this._saving.set(true);
    this._error.set(null);
    return this.http.post<AsaasIntegrationStatus>(BASE, payload).pipe(
      tap((res) => this.setStatus(res, epoch)),
      finalize(() => this._saving.set(false)),
    );
  }

  /**
   * Registra o webhook de novo na conta Asaas já conectada, sem pedir a chave.
   * A recusa do Asaas NÃO é erro HTTP: volta 200 com `webhookStatus = 'FAILED'`
   * e o motivo, então quem chama lê o status devolvido.
   */
  reregisterWebhook(): Observable<AsaasIntegrationStatus> {
    const epoch = this._epoch();
    this._webhookBusy.set(true);
    return this.http.post<AsaasIntegrationStatus>(`${BASE}/webhook`, {}).pipe(
      tap((res) => this.setStatus(res, epoch)),
      finalize(() => this._webhookBusy.set(false)),
    );
  }

  /** Troca a chave ativa (só PLATFORM_ADMIN). 409 com `code` quando a troca é recusada. */
  switchEnvironment(target: AsaasEnvironment): Observable<AsaasIntegrationStatus> {
    const epoch = this._epoch();
    this._switching.set(true);
    return this.http
      .put<AsaasIntegrationStatus>(`${BASE}/active-environment`, { environment: target })
      .pipe(
        tap((res) => this.setStatus(res, epoch)),
        finalize(() => this._switching.set(false)),
      );
  }

  disconnect(): Observable<void> {
    const epoch = this._epoch();
    this._saving.set(true);
    this._error.set(null);
    return this.http.delete<void>(BASE).pipe(
      tap(() => {
        if (this._epoch() !== epoch) return;
        this.setStatus(DISCONNECTED, epoch);
        this._overview.set(null);
      }),
      finalize(() => this._saving.set(false)),
    );
  }

  /** Só grava se o contexto ainda é o do pedido; anota com que token o status foi lido. */
  private setStatus(status: AsaasIntegrationStatus | null, epoch: number): void {
    if (this._epoch() !== epoch) return;
    this._status.set(status);
    this._statusToken.set(status === null ? null : this.currentToken());
  }

  private currentToken(): string | null {
    try {
      return this.session.getToken();
    } catch {
      return null;
    }
  }
}
