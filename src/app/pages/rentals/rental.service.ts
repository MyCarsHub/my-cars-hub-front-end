import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import {
  CreateRentalRequest,
  RentalFilters,
  RentalListItemDto,
  RentalResponseDto,
  RentalStatusHistoryDto,
  RentalUpdateRequest,
} from '../../types/rental.types';

const BASE = `${environment.apiUrl}/rentals`;

@Injectable({ providedIn: 'root' })
export class RentalService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<RentalListItemDto[]>([]);
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

  list(filters: RentalFilters = {}): Observable<PagedResponse<RentalListItemDto>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.status) params = params.set('status', filters.status);
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.driverId) params = params.set('driverId', filters.driverId);
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http
      .get<PagedResponse<RentalListItemDto>>(BASE, { params })
      .pipe(
        tap((res) => {
          this._items.set(res.content ?? []);
          this._page.set(res.page ?? 0);
          this._size.set(res.size ?? 20);
          this._total.set(res.total ?? 0);
        }),
        catchError((err: HttpErrorResponse) => {
          this._error.set('Não foi possível carregar os aluguéis.');
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }

  getById(id: string): Observable<RentalResponseDto> {
    return this.http.get<RentalResponseDto>(`${BASE}/${id}`);
  }

  create(payload: CreateRentalRequest): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(BASE, payload);
  }

  update(id: string, payload: RentalUpdateRequest): Observable<RentalResponseDto> {
    return this.http.put<RentalResponseDto>(`${BASE}/${id}`, payload);
  }

  cancel(id: string): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${id}/cancel`, {});
  }

  /**
   * Manually activate a RESERVED rental created with automaticCharge=false.
   * Skips the Asaas webhook path entirely.
   */
  activate(id: string): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${id}/activate`, {});
  }

  complete(id: string): Observable<RentalResponseDto> {
    return this.http.post<RentalResponseDto>(`${BASE}/${id}/complete`, {});
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/${id}`);
  }

  /**
   * Histórico de transições de status. Ordenado do mais recente pro mais antigo.
   * Cross-tenant retorna 404 no backend.
   */
  history(id: string): Observable<RentalStatusHistoryDto[]> {
    return this.http.get<RentalStatusHistoryDto[]>(`${BASE}/${id}/history`);
  }
}
