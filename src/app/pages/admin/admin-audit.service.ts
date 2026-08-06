import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import { AdminAuditActor, AdminAuditLogItem, AdminAuditQuery } from '../../types/admin-audit.types';
import { AdminUserListItem } from '../../types/admin-user.types';

const BASE = `${environment.apiUrl}/admin/audit`;
const USERS_BASE = `${environment.apiUrl}/admin/users`;

/** Teto do backend é 100; o filtro de atores pede uma página só. */
const ACTORS_PAGE_SIZE = 100;

@Injectable({ providedIn: 'root' })
export class AdminAuditService {
  private readonly http = inject(HttpClient);

  private readonly _items = signal<AdminAuditLogItem[]>([]);
  private readonly _page = signal(0);
  private readonly _size = signal(20);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);

  /** Vocabulário aceito no filtro `action`, vindo do backend — nunca hardcoded. */
  private readonly _actions = signal<string[]>([]);
  private readonly _actors = signal<AdminAuditActor[]>([]);

  readonly items = this._items.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly actions = this._actions.asReadonly();
  readonly actors = this._actors.asReadonly();

  load(query: AdminAuditQuery = {}): Observable<PagedResponse<AdminAuditLogItem>> {
    this._loading.set(true);

    let params = new HttpParams();
    if (query.actorUserId) params = params.set('actorUserId', query.actorUserId);
    if (query.action) params = params.set('action', query.action);
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    params = params.set('page', String(query.page ?? 0));
    params = params.set('size', String(query.size ?? 20));

    return this.http.get<PagedResponse<AdminAuditLogItem>>(BASE, { params }).pipe(
      tap((res) => {
        this._items.set(res.content ?? []);
        this._page.set(res.page ?? 0);
        this._size.set(res.size ?? 20);
        this._total.set(res.total ?? 0);
      }),
      finalize(() => this._loading.set(false)),
    );
  }

  /**
   * Popula o dropdown de ações. Falha aqui é silenciosa por decisão: a listagem
   * principal continua utilizável com o filtro em "todas".
   */
  loadActions(): Observable<string[]> {
    return this.http.get<string[]>(`${BASE}/actions`).pipe(
      tap((res) => this._actions.set(res ?? [])),
      catchError((err: HttpErrorResponse) => {
        this._actions.set([]);
        return throwError(() => err);
      }),
    );
  }

  /**
   * Atores do filtro: os PLATFORM_ADMIN atuais. Não cobre um admin já demovido
   * que aparece na trilha histórica — para esse caso o nome continua legível na
   * linha, que guarda o snapshot do ator.
   */
  loadActors(): Observable<PagedResponse<AdminUserListItem>> {
    const params = new HttpParams()
      .set('systemRole', 'PLATFORM_ADMIN')
      .set('page', '0')
      .set('size', String(ACTORS_PAGE_SIZE));

    return this.http.get<PagedResponse<AdminUserListItem>>(USERS_BASE, { params }).pipe(
      tap((res) =>
        this._actors.set(
          (res.content ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email })),
        ),
      ),
      catchError((err: HttpErrorResponse) => {
        this._actors.set([]);
        return throwError(() => err);
      }),
    );
  }
}
