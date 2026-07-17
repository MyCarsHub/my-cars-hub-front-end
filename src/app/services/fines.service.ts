import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  CreateFineRequest,
  Fine,
  FineFilters,
  FineListItem,
  PayFineRequest,
  UpdateFineRequest,
} from '../types/fine.types';

const BASE = `${environment.apiUrl}/fines`;

@Injectable({ providedIn: 'root' })
export class FinesService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<FineListItem[]>([]);
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

  list(filters: FineFilters = {}): Observable<PagedResponse<FineListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.driverId) params = params.set('driverId', filters.driverId);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.severity) params = params.set('severity', filters.severity);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http.get<PagedResponse<FineListItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar as multas.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  getOne(id: string): Observable<Fine> {
    return this.http.get<Fine>(`${BASE}/${id}`);
  }

  create(payload: CreateFineRequest): Observable<Fine> {
    return this.http.post<Fine>(BASE, payload);
  }

  update(id: string, payload: UpdateFineRequest): Observable<Fine> {
    return this.http.put<Fine>(`${BASE}/${id}`, payload);
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._items.update((list) => list.filter((f) => f.id !== id))),
    );
  }

  pay(id: string, payload: PayFineRequest = {}): Observable<Fine> {
    return this.http.post<Fine>(`${BASE}/${id}/pay`, payload);
  }
}
