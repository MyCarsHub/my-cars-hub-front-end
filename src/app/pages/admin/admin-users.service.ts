import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import {
  AdminUserDetail,
  AdminUserListItem,
  AdminUserRoleFilter,
  AdminUserStatusFilter,
  AdminUserSystemRole,
} from '../../types/admin-user.types';

const BASE = `${environment.apiUrl}/admin/users`;

export interface AdminUserQuery {
  search?: string;
  status?: AdminUserStatusFilter;
  systemRole?: AdminUserRoleFilter;
  page?: number;
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<AdminUserListItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  private readonly _detail = signal<AdminUserDetail | null>(null);
  private readonly _detailLoading = signal(false);
  private readonly _detailError = signal<string | null>(null);

  readonly detail = this._detail.asReadonly();
  readonly detailLoading = this._detailLoading.asReadonly();
  readonly detailError = this._detailError.asReadonly();

  readonly items = this._items.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(query: AdminUserQuery = {}): Observable<PagedResponse<AdminUserListItem>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (query.search && query.search.trim().length > 0) {
      params = params.set('search', query.search.trim());
    }
    if (query.status && query.status !== 'ALL') {
      params = params.set('status', query.status);
    }
    if (query.systemRole && query.systemRole !== 'ALL') {
      params = params.set('systemRole', query.systemRole);
    }
    params = params.set('page', String(query.page ?? 0));
    params = params.set('size', String(query.size ?? 20));

    return this.http.get<PagedResponse<AdminUserListItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      catchError((err: HttpErrorResponse) => {
        this._error.set('Não foi possível carregar os usuários. Tente novamente.');
        return throwError(() => err);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  getDetail(id: string): Observable<AdminUserDetail> {
    this._detailLoading.set(true);
    this._detailError.set(null);
    return this.http.get<AdminUserDetail>(`${BASE}/${id}`).pipe(
      tap((res) => this._detail.set(res)),
      catchError((err: HttpErrorResponse) => {
        this._detailError.set('Não foi possível carregar o usuário.');
        return throwError(() => err);
      }),
      finalize(() => this._detailLoading.set(false)),
    );
  }

  clearDetail(): void {
    this._detail.set(null);
    this._detailError.set(null);
  }

  updateStatus(id: string, active: boolean): Observable<AdminUserListItem> {
    return this.http
      .patch<AdminUserListItem>(`${BASE}/${id}/status`, { active })
      .pipe(tap((updated) => {
        this.replaceItem(updated);
        this.patchDetail(updated);
      }));
  }

  updateSystemRole(id: string, systemRole: AdminUserSystemRole): Observable<AdminUserListItem> {
    return this.http
      .patch<AdminUserListItem>(`${BASE}/${id}/system-role`, { systemRole })
      .pipe(tap((updated) => {
        this.replaceItem(updated);
        this.patchDetail(updated);
      }));
  }

  private patchDetail(next: AdminUserListItem): void {
    this._detail.update((cur) =>
      cur && cur.id === next.id
        ? { ...cur, active: next.active, systemRole: next.systemRole, name: next.name, email: next.email }
        : cur,
    );
  }

  private replaceItem(next: AdminUserListItem): void {
    this._items.update((list) => list.map((u) => (u.id === next.id ? next : u)));
  }
}
