import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import { BlogPostDetail, BlogPostListItem, BlogPostRequest } from '../../types/blog.types';
import { OWNED_HTTP_ERRORS } from '../../services/http-errors.context';

const BASE = `${environment.apiUrl}/blog`;
const ADMIN_BASE = `${environment.apiUrl}/admin/blog`;

@Injectable({ providedIn: 'root' })
export class BlogService {
  private readonly http = inject(HttpClient);

  // ---------- Público ----------

  /**
   * As duas chamadas públicas levam `OWNED_HTTP_ERRORS`: as telas do blog são
   * donas dos próprios erros e mostram tudo inline. Sem a marca, um leitor
   * ANÔNIMO numa superfície de marketing levava o toast do interceptor POR CIMA
   * da mensagem da tela — e no 5xx isso não é raro: cold start de free tier
   * devolve 502 com frequência (ver o comentário em `blog-detail.ts`).
   *
   * A marca NÃO sobe para o serviço inteiro de propósito. Os métodos
   * administrativos abaixo servem telas que JÁ migraram e que contam com o toast
   * do interceptor; marcá-los mudaria o comportamento delas em silêncio. O
   * escopo está preso por spec (FIX-0325).
   *
   * `OWNED` e não `SILENT`: estes são endpoints NOSSOS, então 401 / sessão
   * vencida continua sendo assunto do interceptor.
   */
  private publicContext(): HttpContext {
    return new HttpContext().set(OWNED_HTTP_ERRORS, true);
  }

  listPublished(category?: string, page = 0, size = 12): Observable<PagedResponse<BlogPostListItem>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (category) params = params.set('category', category);
    return this.http.get<PagedResponse<BlogPostListItem>>(BASE, {
      params,
      context: this.publicContext(),
    });
  }

  findBySlug(slug: string): Observable<BlogPostDetail> {
    return this.http.get<BlogPostDetail>(`${BASE}/${slug}`, { context: this.publicContext() });
  }

  // ---------- Admin ----------

  listAdmin(page = 0, size = 20): Observable<PagedResponse<BlogPostListItem>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResponse<BlogPostListItem>>(ADMIN_BASE, { params });
  }

  findByIdAdmin(id: string): Observable<BlogPostDetail> {
    return this.http.get<BlogPostDetail>(`${ADMIN_BASE}/${id}`);
  }

  create(req: BlogPostRequest): Observable<BlogPostDetail> {
    return this.http.post<BlogPostDetail>(ADMIN_BASE, req);
  }

  update(id: string, req: BlogPostRequest): Observable<BlogPostDetail> {
    return this.http.put<BlogPostDetail>(`${ADMIN_BASE}/${id}`, req);
  }

  publish(id: string): Observable<void> {
    return this.http.post<void>(`${ADMIN_BASE}/${id}/publish`, {});
  }

  unpublish(id: string): Observable<void> {
    return this.http.post<void>(`${ADMIN_BASE}/${id}/unpublish`, {});
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${ADMIN_BASE}/${id}`);
  }
}
