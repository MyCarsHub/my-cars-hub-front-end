import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  DriverDashboard,
  LedgerEntry,
  LedgerEntryRequest,
  LedgerListQuery,
} from '../types/driver-ledger.types';
import { toDriverDashboard, toLedgerEntry } from '../utils/driver-area-adapters';

const LEDGER = `${environment.apiUrl}/driver/ledger`;
const DASHBOARD = `${environment.apiUrl}/driver/dashboard`;

/**
 * HTTP port of the driver's own ledger and dashboard (`/v1/driver/**`).
 *
 * Stateless on purpose: the page that asks owns the signals, so there is no cache to leak
 * across a company switch (the pivot recreates the pages) and nothing to register with the
 * tenant reset. Every read goes through `utils/driver-area-adapters.ts`, which is the one
 * place to touch when the backend's DTOs change.
 *
 * Every endpoint is scoped by the server to the caller's own driver identity — there is no
 * `driverId` anywhere in these requests, and the client never sends one.
 */
@Injectable({ providedIn: 'root' })
export class DriverLedgerService {
  private readonly http = inject(HttpClient);

  list(query: LedgerListQuery = {}): Observable<PagedResponse<LedgerEntry>> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.kind) params = params.set('kind', query.kind);
    if (query.category) params = params.set('category', query.category);
    if (query.rentalId) params = params.set('rentalId', query.rentalId);
    params = params.set('page', String(query.page ?? 0)).set('size', String(query.size ?? 20));

    return this.http.get<PagedResponse<unknown>>(LEDGER, { params }).pipe(
      map((res) => ({
        content: (res?.content ?? [])
          .map(toLedgerEntry)
          .filter((entry): entry is LedgerEntry => entry !== null),
        page: res?.page ?? 0,
        size: res?.size ?? query.size ?? 20,
        total: res?.total ?? 0,
      })),
    );
  }

  create(payload: LedgerEntryRequest): Observable<LedgerEntry> {
    return this.http.post<unknown>(LEDGER, payload).pipe(map((res) => this.entryOrFail(res)));
  }

  update(id: string, payload: LedgerEntryRequest): Observable<LedgerEntry> {
    return this.http
      .put<unknown>(`${LEDGER}/${encodeURIComponent(id)}`, payload)
      .pipe(map((res) => this.entryOrFail(res)));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${LEDGER}/${encodeURIComponent(id)}`);
  }

  dashboard(from: string, to: string): Observable<DriverDashboard> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<unknown>(DASHBOARD, { params })
      .pipe(map((res) => toDriverDashboard(res, from, to)));
  }

  private entryOrFail(raw: unknown): LedgerEntry {
    const entry = toLedgerEntry(raw);
    if (!entry) throw new Error('Resposta inválida do servidor ao salvar o lançamento.');
    return entry;
  }
}
