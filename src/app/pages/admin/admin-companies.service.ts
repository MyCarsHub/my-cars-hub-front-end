import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import {
  AdminCompanyDetail,
  AdminCompanyListItem,
  AdminCompanyStatus,
} from '../../types/admin-company.types';

const API_BASE = `${environment.apiUrl}/admin/companies`;

export interface LoadCompaniesOptions {
  search?: string | null;
  status?: AdminCompanyStatus | 'ALL' | null;
  planCode?: string | null;
  page?: number;
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminCompaniesService {
  private readonly http = inject(HttpClient);

  private readonly _companies = signal<AdminCompanyListItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  private readonly _detail = signal<AdminCompanyDetail | null>(null);
  private readonly _detailLoading = signal(false);
  private readonly _detailError = signal<string | null>(null);
  private readonly _statusUpdating = signal(false);

  readonly companies = this._companies.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly detail = this._detail.asReadonly();
  readonly detailLoading = this._detailLoading.asReadonly();
  readonly detailError = this._detailError.asReadonly();
  readonly statusUpdating = this._statusUpdating.asReadonly();

  load(options: LoadCompaniesOptions = {}): Observable<PagedResponse<AdminCompanyListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (options.search && options.search.trim().length > 0) {
      params = params.set('search', options.search.trim());
    }
    if (options.status && options.status !== 'ALL') {
      params = params.set('status', options.status);
    }
    if (options.planCode && options.planCode.trim().length > 0) {
      params = params.set('planCode', options.planCode.trim());
    }
    if (options.page !== undefined) {
      params = params.set('page', String(options.page));
    }
    if (options.size !== undefined) {
      params = params.set('size', String(options.size));
    }

    return this.http.get<PagedResponse<AdminCompanyListItem>>(API_BASE, { params }).pipe(
      tap((res) => {
        this._companies.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar as empresas. Tente novamente.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  loadDetail(id: string): Observable<AdminCompanyDetail> {
    this._detailLoading.set(true);
    this._detailError.set(null);
    return this.http.get<AdminCompanyDetail>(`${API_BASE}/${id}`).pipe(
      tap((res) => this._detail.set(res)),
      catchError((err: HttpErrorResponse) => {
        this._detailError.set('Não foi possível carregar a empresa.');
        return throwError(() => err);
      }),
      finalize(() => this._detailLoading.set(false)),
    );
  }

  updateStatus(id: string, active: boolean): Observable<AdminCompanyDetail> {
    this._statusUpdating.set(true);
    return this.http
      .patch<AdminCompanyDetail>(`${API_BASE}/${id}/status`, { active })
      .pipe(
        tap((res) => {
          this._detail.set(res);
          this._companies.update((list) =>
            list.map((c) =>
              c.id === res.id
                ? { ...c, status: res.status, active: res.active }
                : c,
            ),
          );
        }),
        finalize(() => this._statusUpdating.set(false)),
      );
  }

  clearDetail(): void {
    this._detail.set(null);
    this._detailError.set(null);
  }
}
