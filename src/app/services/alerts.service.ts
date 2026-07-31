import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { DocumentAlert } from '../types/notification-feed.types';

const BASE = `${environment.apiUrl}/alerts`;

/**
 * Alertas de vencimento de documentos (`GET /v1/alerts/documents`).
 *
 * A resposta é uma lista PLANA já ordenada por `dueDate` asc, incluindo itens
 * vencidos (`daysRemaining` negativo), e é limitada silenciosamente a 200
 * linhas pelo backend — o agrupamento por urgência é responsabilidade da UI.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly http = inject(HttpClient);

  private readonly _documentAlerts = signal<DocumentAlert[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly documentAlerts = this._documentAlerts.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Zera o cache para o estado inicial. Obrigatório no logout: o serviço é
   * `providedIn: 'root'` e sobrevive ao `sessionStorage.clear()`, então sem
   * isso o próximo usuário logado na MESMA aba veria os alertas do anterior.
   */
  reset(): void {
    this._documentAlerts.set([]);
    this._loading.set(false);
    this._error.set(null);
  }

  listDocumentAlerts(withinDays = 30): Observable<DocumentAlert[]> {
    this._loading.set(true);
    this._error.set(null);

    const params = new HttpParams().set('withinDays', String(withinDays));

    return this.http.get<DocumentAlert[]>(`${BASE}/documents`, { params }).pipe(
      tap((res) => this._documentAlerts.set(res ?? [])),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os alertas de vencimento.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }
}
