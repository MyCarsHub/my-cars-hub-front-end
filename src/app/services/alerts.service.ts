import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import { DOCUMENT_ALERTS_PAGE_SIZE, DocumentAlert } from '../types/notification-feed.types';

const BASE = `${environment.apiUrl}/alerts`;

/**
 * Alertas de vencimento de documentos (`GET /v1/alerts/documents`).
 *
 * A rota devolve o envelope paginado padrão do projeto
 * (`content` / `page` / `size` / `total`) já ordenado por `dueDate` asc,
 * incluindo itens vencidos (`daysRemaining` negativo). Antes era um array
 * plano cortado em 200 linhas em silêncio; hoje o excedente está na página
 * seguinte e `total` diz quantos são.
 *
 * O agrupamento por urgência continua sendo responsabilidade da UI.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly http = inject(HttpClient);

  private readonly _documentAlerts = signal<DocumentAlert[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(DOCUMENT_ALERTS_PAGE_SIZE);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly documentAlerts = this._documentAlerts.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Zera o cache para o estado inicial. Obrigatório no logout: o serviço é
   * `providedIn: 'root'` e sobrevive ao `sessionStorage.clear()`, então sem
   * isso o próximo usuário logado na MESMA aba veria os alertas do anterior.
   */
  reset(): void {
    this._documentAlerts.set([]);
    this._page.set(0);
    this._size.set(DOCUMENT_ALERTS_PAGE_SIZE);
    this._total.set(0);
    this._loading.set(false);
    this._error.set(null);
  }

  /**
   * `withinDays` é opcional: omitido, o backend usa a MAIOR janela configurada
   * pela empresa (`/companies/current/alert-settings`) — não mais 30 fixo.
   * Passar um valor explícito continua vencendo, e é o que a página faz assim
   * que conhece as janelas da empresa.
   */
  listDocumentAlerts(
    withinDays: number | null = null,
    page = 0,
    size = DOCUMENT_ALERTS_PAGE_SIZE,
  ): Observable<PagedResponse<DocumentAlert>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams().set('page', String(page)).set('size', String(size));
    if (withinDays !== null) {
      params = params.set('withinDays', String(withinDays));
    }

    return this.http.get<PagedResponse<DocumentAlert>>(`${BASE}/documents`, { params }).pipe(
      tap((res) => {
        this._documentAlerts.set(res?.content ?? []);
        this._page.set(res?.page ?? page);
        this._size.set(res?.size ?? size);
        this._total.set(res?.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os alertas de vencimento.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }
}
