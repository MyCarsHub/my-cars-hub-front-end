import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, of, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AlertSettings, AlertSettingsUpdate } from '../types/alert-settings.types';
import { SessionService } from './session.service';

const BASE = `${environment.apiUrl}/companies/current/alert-settings`;

/**
 * Janelas de aviso da empresa (`/v1/companies/current/alert-settings`).
 *
 * O `GET` é aberto a qualquer membro autenticado; o `PUT` é de OWNER/MANAGER e
 * **substitui a lista inteira**. Os limites (`minWindowDays`, `maxWindowDays`,
 * `maxWindowCount`) chegam na própria resposta e são a única fonte de verdade da
 * validação do cliente — este serviço não guarda constante alguma sobre eles.
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

  /** Empresa a que o cache pertence; `undefined` enquanto nada foi carregado. */
  private cachedFor: string | null | undefined = undefined;

  readonly settings = this._settings.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Lê as janelas da empresa. Devolve o cache quando ele pertence à empresa
   * selecionada; `force` refaz a requisição (usado pela tela de configuração,
   * que precisa exibir o estado do servidor, não o que ficou de outra tela).
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

    return this.http.get<AlertSettings>(BASE).pipe(
      tap((response) => this.adopt(response, company)),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar as janelas de aviso.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Substitui a lista inteira. A resposta (já com `customized: true`) vira o
   * novo estado; um 400 chega intacto para a tela extrair `fieldErrors.windows`
   * pelo `ApiErrorService`.
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
