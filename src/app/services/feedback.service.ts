import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateFeedbackTaskRequest,
  FeedbackSort,
  FeedbackStatus,
  FeedbackTaskResponse,
  PagedResponse,
  UpdateFeedbackTaskRequest,
} from '../types/feedback.types';

const API_BASE = `${environment.apiUrl}/feedback/tasks`;
const ADMIN_BASE = `${environment.apiUrl}/admin/feedback/tasks`;

export interface LoadTasksOptions {
  status?: FeedbackStatus[];
  sort?: FeedbackSort;
  page?: number;
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);

  private readonly _tasks = signal<FeedbackTaskResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _page = signal(0);
  private readonly _total = signal(0);

  readonly tasks = this._tasks.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly page = this._page.asReadonly();
  readonly total = this._total.asReadonly();

  loadTasks(
    options: LoadTasksOptions = {},
  ): Observable<PagedResponse<FeedbackTaskResponse>> {
    this._loading.set(true);
    this._error.set(null);

    let params = new HttpParams();
    if (options.status && options.status.length > 0) {
      params = params.set('status', options.status.join(','));
    }
    if (options.sort) {
      params = params.set('sort', options.sort);
    }
    if (options.page !== undefined) {
      params = params.set('page', String(options.page));
    }
    if (options.size !== undefined) {
      params = params.set('size', String(options.size));
    }

    return this.http
      .get<PagedResponse<FeedbackTaskResponse>>(API_BASE, { params })
      .pipe(
        tap((res) => {
          this._tasks.set(res.content ?? []);
          this._page.set(res.page ?? 0);
          this._total.set(res.total ?? 0);
        }),
        catchError((err: HttpErrorResponse) => {
          this._error.set(
            'Não foi possível carregar as sugestões. Tente novamente.',
          );
          return throwError(() => err);
        }),
        finalize(() => this._loading.set(false)),
      );
  }

  getOne(id: string): Observable<FeedbackTaskResponse> {
    return this.http.get<FeedbackTaskResponse>(`${API_BASE}/${id}`);
  }

  create(payload: CreateFeedbackTaskRequest): Observable<FeedbackTaskResponse> {
    return this.http.post<FeedbackTaskResponse>(API_BASE, payload).pipe(
      tap((task) => {
        this._tasks.update((list) => [task, ...list]);
      }),
    );
  }

  update(
    id: string,
    patch: UpdateFeedbackTaskRequest,
  ): Observable<FeedbackTaskResponse> {
    return this.http.patch<FeedbackTaskResponse>(`${API_BASE}/${id}`, patch).pipe(
      tap((updated) => {
        this._tasks.update((list) =>
          list.map((t) => (t.id === updated.id ? updated : t)),
        );
      }),
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${API_BASE}/${id}`, { responseType: 'text' }).pipe(
      map(() => void 0),
      tap(() => {
        this._tasks.update((list) => list.filter((t) => t.id !== id));
      }),
    );
  }

  fuel(id: string): Observable<FeedbackTaskResponse> {
    let previous: FeedbackTaskResponse | null = null;
    this._tasks.update((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        previous = t;
        if (t.hasVoted) return t;
        return { ...t, hasVoted: true, fuelCount: t.fuelCount + 1 };
      }),
    );

    return this.http
      .post<FeedbackTaskResponse>(`${API_BASE}/${id}/fuel`, {})
      .pipe(
        tap((updated) => {
          this._tasks.update((list) =>
            list.map((t) => (t.id === updated.id ? updated : t)),
          );
        }),
        catchError((err: HttpErrorResponse) => {
          if (previous) {
            const snapshot = previous;
            this._tasks.update((list) =>
              list.map((t) => (t.id === id ? snapshot : t)),
            );
          }
          return throwError(() => err);
        }),
      );
  }

  unfuel(id: string): Observable<void> {
    let previous: FeedbackTaskResponse | null = null;
    this._tasks.update((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        previous = t;
        if (!t.hasVoted) return t;
        return {
          ...t,
          hasVoted: false,
          fuelCount: Math.max(0, t.fuelCount - 1),
        };
      }),
    );

    return this.http
      .delete(`${API_BASE}/${id}/fuel`, { responseType: 'text' })
      .pipe(
        map(() => void 0),
        catchError((err: HttpErrorResponse) => {
          if (previous) {
            const snapshot = previous;
            this._tasks.update((list) =>
              list.map((t) => (t.id === id ? snapshot : t)),
            );
          }
          return throwError(() => err);
        }),
      );
  }

  updateStatus(
    id: string,
    status: FeedbackStatus,
    adminNote?: string | null,
  ): Observable<FeedbackTaskResponse> {
    const body = { status, adminNote: adminNote ?? null };
    return this.http
      .patch<FeedbackTaskResponse>(`${ADMIN_BASE}/${id}/status`, body)
      .pipe(
        tap((updated) => {
          this._tasks.update((list) =>
            list.map((t) => (t.id === updated.id ? updated : t)),
          );
        }),
      );
  }

  adminDelete(id: string): Observable<void> {
    return this.http
      .delete(`${ADMIN_BASE}/${id}`, { responseType: 'text' })
      .pipe(
        map(() => void 0),
        tap(() => {
          this._tasks.update((list) => list.filter((t) => t.id !== id));
        }),
      );
  }
}
