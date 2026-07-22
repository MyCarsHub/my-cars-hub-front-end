import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import { GerenciaSummary } from '../types/gerencia-summary.types';
import {
  CreateFinancingRequest,
  CreateVehicleRequest,
  Financing,
  FinancingDetail,
  FinancingFilters,
  FinancingListItem,
  MarkPaidOffRequest,
  UpdateVehicleRequest,
  Vehicle,
  VehicleFilters,
  VehicleListItem,
} from '../types/vehicle.types';

const BASE = `${environment.apiUrl}/vehicles`;
const FLEET_FINANCINGS_BASE = `${environment.apiUrl}/financings`;

@Injectable({ providedIn: 'root' })
export class VehiclesService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<VehicleListItem[]>([]);
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

  // Fleet-wide financings cache (separate keys from vehicle-scoped state above).
  private readonly _financings = signal<FinancingListItem[]>([]);
  private readonly _financingsPage = signal(0);
  private readonly _financingsSize = signal(20);
  private readonly _financingsTotal = signal(0);
  private readonly _financingsLoading = signal(false);
  private readonly _financingsError = signal<string | null>(null);

  readonly financings = this._financings.asReadonly();
  readonly financingsPage = this._financingsPage.asReadonly();
  readonly financingsSize = this._financingsSize.asReadonly();
  readonly financingsTotal = this._financingsTotal.asReadonly();
  readonly financingsLoading = this._financingsLoading.asReadonly();
  readonly financingsError = this._financingsError.asReadonly();

  list(filters: VehicleFilters = {}): Observable<PagedResponse<VehicleListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (filters.q?.trim()) params = params.set('q', filters.q.trim());
    if (filters.type) params = params.set('type', filters.type);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));
    if (filters.availableForRental) params = params.set('availableForRental', 'true');
    if (filters.includeCurrentRentalId)
      params = params.set('includeCurrentRentalId', filters.includeCurrentRentalId);

    return this.http.get<PagedResponse<VehicleListItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os veículos.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  getOne(id: string): Observable<Vehicle> {
    return this.http.get<Vehicle>(`${BASE}/${id}`);
  }

  create(payload: CreateVehicleRequest): Observable<Vehicle> {
    return this.http.post<Vehicle>(BASE, payload);
  }

  update(id: string, payload: UpdateVehicleRequest): Observable<Vehicle> {
    return this.http.put<Vehicle>(`${BASE}/${id}`, payload);
  }

  /**
   * Manual status transition. Backend rejects RENTED (system-managed) and
   * returns 409 when there is an active rental. Cache is updated inline so
   * the list reflects the new status without a refetch.
   */
  updateStatus(id: string, status: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE'): Observable<Vehicle> {
    return this.http.patch<Vehicle>(`${BASE}/${id}/status`, { status }).pipe(
      tap((v) =>
        this._items.update((list) => list.map((it) => (it.id === id ? { ...it, status: v.status } : it))),
      ),
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => this._items.update((list) => list.filter((v) => v.id !== id))),
    );
  }

  /** Aggregated vehicle summary for the "Gerência do veículo" hub. */
  getGerenciaSummary(vehicleId: string): Observable<GerenciaSummary> {
    return this.http.get<GerenciaSummary>(`${BASE}/${vehicleId}/gerencia/summary`);
  }

  listFinancings(vehicleId: string): Observable<Financing[]> {
    return this.http.get<Financing[]>(`${BASE}/${vehicleId}/financings`);
  }

  createFinancing(
    vehicleId: string,
    payload: CreateFinancingRequest,
  ): Observable<Financing> {
    return this.http.post<Financing>(`${BASE}/${vehicleId}/financings`, payload);
  }

  markPaidOff(
    vehicleId: string,
    financingId: string,
    payload: MarkPaidOffRequest = {},
  ): Observable<Financing> {
    return this.http.patch<Financing>(
      `${BASE}/${vehicleId}/financings/${financingId}/paid-off`,
      payload,
    );
  }

  deleteFinancing(vehicleId: string, financingId: string): Observable<void> {
    return this.http
      .delete(`${BASE}/${vehicleId}/financings/${financingId}`, { responseType: 'text' })
      .pipe(map(() => void 0));
  }

  /** Fleet-wide financing detail (GET /v1/financings/{id}). */
  getFleetFinancing(id: string): Observable<FinancingDetail> {
    return this.http.get<FinancingDetail>(`${FLEET_FINANCINGS_BASE}/${id}`);
  }

  /**
   * Marca uma parcela como paga. Payload é opcional — backend usa hoje/valor
   * da parcela quando ausente. Retorna o detalhe completo com o cronograma
   * refrescado, incluindo os KPIs `paidCents/remainingCents` já derivados.
   */
  payFinancingInstallment(
    financingId: string,
    installmentId: string,
    payload: { paidAt?: string; paidAmountCents?: number } = {},
  ): Observable<FinancingDetail> {
    return this.http.post<FinancingDetail>(
      `${FLEET_FINANCINGS_BASE}/${financingId}/installments/${installmentId}/pay`,
      payload,
    );
  }

  /**
   * Undo a previous mark-as-paid on a financing installment. Backend clears
   * the paidDate/paidAmount + reverts status to PENDING/OVERDUE based on the
   * dueDate. Returns the refreshed detail.
   */
  unpayFinancingInstallment(
    financingId: string,
    installmentId: string,
  ): Observable<FinancingDetail> {
    return this.http.post<FinancingDetail>(
      `${FLEET_FINANCINGS_BASE}/${financingId}/installments/${installmentId}/unpay`,
      {},
    );
  }

  /** Fleet-wide financings listing (GET /v1/financings). */
  listFleetFinancings(
    filters: FinancingFilters = {},
  ): Observable<PagedResponse<FinancingListItem>> {
    this._financingsLoading.set(true);
    this._financingsError.set(null);

    let params = new HttpParams();
    if (filters.vehicleId) params = params.set('vehicleId', filters.vehicleId);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.sort) params = params.set('sort', filters.sort);
    if (filters.page !== undefined) params = params.set('page', String(filters.page));
    if (filters.size !== undefined) params = params.set('size', String(filters.size));

    return this.http
      .get<PagedResponse<FinancingListItem>>(FLEET_FINANCINGS_BASE, { params })
      .pipe(
        tap((res) => {
          this._financings.set(res.content ?? []);
          this._financingsPage.set(res.page ?? 0);
          this._financingsSize.set(res.size ?? 20);
          this._financingsTotal.set(res.total ?? 0);
        }),
        catchError((err: HttpErrorResponse) => {
          this._financingsError.set('Não foi possível carregar os financiamentos.');
          return throwError(() => err);
        }),
        finalize(() => this._financingsLoading.set(false)),
      );
  }
}
