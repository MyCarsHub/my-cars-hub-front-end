import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, of, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AlertSettings, AlertSettingsUpdate } from '../types/alert-settings.types';
import { SessionService } from './session.service';
import { OWNED_HTTP_ERRORS } from './http-errors.context';

const BASE = `${environment.apiUrl}/companies/current/alert-settings`;

/**
 * Janelas de aviso da empresa (`/v1/companies/current/alert-settings`).
 *
 * O `GET` é OWNER-only desde o PR #170 do backend (antes era aberto a qualquer
 * membro); o `PUT` é de OWNER/MANAGER e **substitui a lista inteira**. Um
 * MANAGER recebe 403 na leitura, e isso é o contrato, não um defeito: a
 * política de aviso e de cobrança por atraso é painel do dono. Por isso a
 * leitura leva `OWNED_HTTP_ERRORS` — a tela é dona do desfecho e degrada
 * escondendo os atalhos — enquanto o `PUT` fica de fora do token, para um 403
 * de escrita continuar virando o toast genérico.
 *
 * Os limites (`minWindowDays`, `maxWindowDays`, `maxWindowCount`) chegam na
 * própria resposta e são a única fonte de verdade da validação do cliente —
 * este serviço não guarda constante alguma sobre eles.
 *
 * O cache é chaveado pela empresa selecionada em vez de zerado no logout: o
 * serviço é `providedIn: 'root'` e sobrevive ao `sessionStorage.clear()`, mas
 * `selectedCompanyId` some junto, então a próxima leitura já não encontra a
 * chave do usuário anterior e refaz a requisição. Isso vale também para a troca
 * de tenant na mesma sessão.
 */
@Injectable({ providedIn: 'root' })
export class AlertSettingsService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  private readonly _settings = signal<AlertSettings | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _forbidden = signal(false);

  /** Empresa a que o cache pertence; `undefined` enquanto nada foi carregado. */
  private cachedFor: string | null | undefined = undefined;

  readonly settings = this._settings.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * A leitura foi recusada por papel (403), e não por falha. Estado separado de
   * `error` de propósito: quem não pode ver a política não deve ler "não foi
   * possível carregar" — não houve problema algum, ele só não é o dono.
   */
  readonly forbidden = this._forbidden.asReadonly();

  /**
   * Lê as janelas da empresa. Devolve o cache quando ele pertence à empresa
   * selecionada; `force` refaz a requisição para quem precisa do estado do
   * servidor, e não do que ficou em cache por outra tela.
   *
   * A tela que originou o `force` (AlertWindows, em `/configuracoes`) não existe
   * mais. O parâmetro fica: é o único jeito de furar o cache sem expor o sinal
   * interno, e o cache é `providedIn: 'root'`, logo sobrevive a qualquer
   * navegação.
   */
  load(force = false): Observable<AlertSettings> {
    const company = this.session.getItem('selectedCompanyId');
    if (company !== this.cachedFor) {
      this._settings.set(null);
      this.cachedFor = company;
    }

    const cached = this._settings();
    if (cached && !force) return of(cached);

    this._loading.set(true);
    this._error.set(null);
    this._forbidden.set(false);

    return this.http
      .get<AlertSettings>(BASE, {
        context: new HttpContext().set(OWNED_HTTP_ERRORS, true),
      })
      .pipe(
        tap((response) => this.adopt(response, company)),
        catchError((err: HttpErrorResponse) => {
          // 403 é o papel, não uma falha: a tela some com os atalhos e segue.
          if (err.status === 403) this._forbidden.set(true);
          else this._error.set('Não foi possível carregar as janelas de aviso.');
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }

  /**
   * Substitui a lista inteira. A resposta (já com `customized: true`) vira o
   * novo estado; um 400 chega intacto para a tela extrair `fieldErrors.windows`
   * pelo `ApiErrorService`.
   *
   * Sem chamador no frontend desde que a tela de janelas de aviso saiu — e isso
   * é deliberado, igual ao endpoint de multa por atraso: o `PUT` continua vivo no
   * backend e este método é o ponto de entrada pronto para a tela que voltar a
   * expor a edição. Não apague sem essa decisão ser revista.
   */
  save(windows: number[]): Observable<AlertSettings> {
    const body: AlertSettingsUpdate = { windows };
    return this.http
      .put<AlertSettings>(BASE, body)
      .pipe(tap((response) => this.adopt(response, this.session.getItem('selectedCompanyId'))));
  }

  private adopt(response: AlertSettings, company: string | null): void {
    this._settings.set(response);
    this.cachedFor = company;
  }
}
