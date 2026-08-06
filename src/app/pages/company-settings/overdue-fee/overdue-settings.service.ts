import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, of, tap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SessionService } from '../../../services/session.service';
import { OverdueSettings, OverdueSettingsUpdate } from '../../../types/overdue.types';

const BASE = `${environment.apiUrl}/companies/current/overdue-settings`;

/**
 * Regra de multa por devolução em atraso da empresa
 * (`/v1/companies/current/overdue-settings`).
 *
 * Serviço PRÓPRIO desta rota, deliberadamente: a tela de Configurações da
 * empresa carrega um bloco inteiro de campos e tem uma corrida conhecida na
 * fila de defeitos que apaga o que o usuário digitou. Herdar aquele fluxo de
 * carregamento traria a corrida junto. Aqui o `PUT` substitui só multiplicador
 * + tolerância, e nada mais da empresa passa por este caminho.
 *
 * O `GET` é aberto a qualquer membro (a prévia de conclusão depende dele); o
 * `PUT` é de OWNER/MANAGER, checado no backend.
 *
 * Cache chaveado pela empresa selecionada — mesma estratégia do
 * `AlertSettingsService`: o serviço é `providedIn: 'root'` e sobrevive ao
 * `sessionStorage.clear()`, mas `selectedCompanyId` some junto, então a próxima
 * leitura já não acha a chave do usuário anterior e refaz a requisição.
 */
@Injectable({ providedIn: 'root' })
export class OverdueSettingsService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  private readonly _settings = signal<OverdueSettings | null>(null);
  private readonly _loading = signal(false);

  /** Empresa a que o cache pertence; `undefined` enquanto nada foi carregado. */
  private cachedFor: string | null | undefined = undefined;

  readonly settings = this._settings.asReadonly();
  readonly loading = this._loading.asReadonly();

  /**
   * Lê a regra da empresa. `force` refaz a requisição — a tela de configuração
   * precisa mostrar o servidor, não o que ficou em cache de outra visita.
   */
  load(force = false): Observable<OverdueSettings> {
    const company = this.session.getItem('selectedCompanyId');
    if (company !== this.cachedFor) {
      this._settings.set(null);
      this.cachedFor = company;
    }

    const cached = this._settings();
    if (cached && !force) return of(cached);

    this._loading.set(true);

    return this.http.get<OverdueSettings>(BASE).pipe(
      tap((response) => this.adopt(response, company)),
      catchError((err: HttpErrorResponse) => throwError(() => err)),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Substitui a configuração inteira. Um 400 chega intacto para a tela extrair
   * `fieldErrors` pelo `ApiErrorService` — 403 (papel) idem.
   */
  save(update: OverdueSettingsUpdate): Observable<OverdueSettings> {
    return this.http
      .put<OverdueSettings>(BASE, update)
      .pipe(tap((response) => this.adopt(response, this.session.getItem('selectedCompanyId'))));
  }

  private adopt(response: OverdueSettings, company: string | null): void {
    this._settings.set(response);
    this.cachedFor = company;
  }
}
