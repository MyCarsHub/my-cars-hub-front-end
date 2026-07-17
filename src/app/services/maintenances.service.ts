import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  CreateMaintenanceRequest,
  Maintenance,
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

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._items.update((list) => list.filter((m) => m.id !== id))),
    );
  }
}
