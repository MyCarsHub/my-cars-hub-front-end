import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  ConcludeMaintenanceRequest,
  CreateMaintenanceRequest,
  Maintenance,
  MaintenanceDocument,
  MaintenanceDocumentKind,
  MaintenanceDocumentUrl,
  MaintenanceFilters,
  MaintenanceListItem,
  UpdateMaintenanceRequest,
} from '../types/maintenance.types';

const BASE = `${environment.apiUrl}/maintenances`;

@Injectable({ providedIn: 'root' })
export class MaintenancesService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<MaintenanceListItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  list(filters: MaintenanceFilters = {}): Observable<PagedResponse<MaintenanceListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http.get<PagedResponse<MaintenanceListItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar as manutenções.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  getOne(id: string): Observable<Maintenance> {
    return this.http.get<Maintenance>(`${BASE}/${id}`);
  }

  create(payload: CreateMaintenanceRequest): Observable<Maintenance> {
    return this.http.post<Maintenance>(BASE, payload);
  }

  update(id: string, payload: UpdateMaintenanceRequest): Observable<Maintenance> {
    return this.http.put<Maintenance>(`${BASE}/${id}`, payload);
  }

  /**
   * Marca a manutenção como `DONE`. Válido apenas a partir de `SCHEDULED` /
   * `IN_PROGRESS` — qualquer outro status volta 409.
   *
   * `payload.hodometerReading` sobrescreve a leitura gravada; a UI sempre envia
   * a leitura real do veículo (ver {@link ConcludeMaintenanceRequest}).
   */
  conclude(id: string, payload: ConcludeMaintenanceRequest = {}): Observable<Maintenance> {
    return this.http.post<Maintenance>(`${BASE}/${id}/conclude`, payload);
  }

  /**
   * Marca a manutenção como `CANCELED`. Sem corpo — válido apenas a partir de
   * `SCHEDULED` / `IN_PROGRESS`.
   */
  cancel(id: string): Observable<Maintenance> {
    return this.http.post<Maintenance>(`${BASE}/${id}/cancel`, null);
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._items.update((list) => list.filter((m) => m.id !== id))),
    );
  }

  // ------------------------------------------------------------------ anexos

  listDocuments(maintenanceId: string): Observable<MaintenanceDocument[]> {
    return this.http.get<MaintenanceDocument[]>(`${BASE}/${maintenanceId}/documents`);
  }

  /**
   * Anexa um arquivo (multipart: `file` + `kind`). Sem `reportProgress` DE
   * PROPÓSITO: o app usa `withFetch()` e o `FetchBackend` nunca emite
   * `UploadProgress` — pedir progresso só produziria uma barra falsa. A UI
   * mostra estado indeterminado com cancelamento real.
   */
  uploadDocument(
    maintenanceId: string,
    kind: MaintenanceDocumentKind,
    file: File,
  ): Observable<MaintenanceDocument> {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return this.http.post<MaintenanceDocument>(`${BASE}/${maintenanceId}/documents`, form);
  }

  /**
   * URL assinada de TTL curto — o bucket é privado, o path nunca sai do
   * backend. A rota é `/signed-url`, NÃO `/url`: todo endpoint de documento
   * deste projeto usa `/signed-url`, e errar isso é um 404 silencioso.
   */
  documentSignedUrl(maintenanceId: string, documentId: string): Observable<MaintenanceDocumentUrl> {
    return this.http.get<MaintenanceDocumentUrl>(
      `${BASE}/${maintenanceId}/documents/${documentId}/signed-url`,
    );
  }

  deleteDocument(maintenanceId: string, documentId: string): Observable<void> {
    return this.http
      .delete(`${BASE}/${maintenanceId}/documents/${documentId}`, { responseType: 'text' })
      .pipe(map(() => void 0));
  }
}
