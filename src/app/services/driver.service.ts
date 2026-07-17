import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  CreateDriverRequest,
  DriverFilters,
  DriverListItem,
  DriverResponse,
  DriverStatus,
  UpdateDriverRequest,
} from '../types/driver.types';

const BASE = `${environment.apiUrl}/drivers`;

@Injectable({ providedIn: 'root' })
export class DriverService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<DriverListItem[]>([]);
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

  list(filters: DriverFilters = {}): Observable<PagedResponse<DriverListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.name?.trim()) params = params.set('name', filters.name.trim());
    if (filters.status) params = params.set('status', filters.status);
    if (filters.licenseCategory) params = params.set('licenseCategory', filters.licenseCategory);
    if (filters.licenseExpiryBefore) params = params.set('licenseExpiryBefore', filters.licenseExpiryBefore);
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http.get<PagedResponse<DriverListItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os motoristas.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  getOne(id: string): Observable<DriverResponse> {
    return this.http.get<DriverResponse>(`${BASE}/${id}`);
  }

  create(payload: CreateDriverRequest): Observable<DriverResponse> {
    return this.http.post<DriverResponse>(BASE, payload);
  }

  update(id: string, payload: UpdateDriverRequest): Observable<DriverResponse> {
    return this.http.put<DriverResponse>(`${BASE}/${id}`, payload);
  }

  /**
   * Suspend / reactivate a driver. Backend only accepts `AVAILABLE` or
   * `SUSPENDED` here — `WORKING` is system-managed by the rental lifecycle.
   * Also patches the in-memory list so the UI updates without a re-fetch.
   */
  changeStatus(id: string, status: DriverStatus): Observable<DriverResponse> {
    return this.http
      .patch<DriverResponse>(`${BASE}/${id}/status`, { status })
      .pipe(
        tap((updated) => {
          this._items.update((list) =>
            list.map((d) => (d.id === id ? { ...d, status: updated.status } : d)),
          );
        }),
      );
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._items.update((list) => list.filter((d) => d.id !== id))),
    );
  }
}
