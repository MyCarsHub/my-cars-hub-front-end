import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PagedResponse } from '../../types/paged.types';
import { BlogPostDetail, BlogPostListItem, BlogPostRequest } from '../../types/blog.types';

const BASE = `${environment.apiUrl}/blog`;
const ADMIN_BASE = `${environment.apiUrl}/admin/blog`;

@Injectable({ providedIn: 'root' })
export class BlogService {
  private readonly http = inject(HttpClient);

  // ---------- Público ----------

  listPublished(category?: string, page = 0, size = 12): Observable<PagedResponse<BlogPostListItem>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (category) params = params.set('category', category);
    return this.http.get<PagedResponse<BlogPostListItem>>(BASE, { params });
  }

  findBySlug(slug: string): Observable<BlogPostDetail> {
    return this.http.get<BlogPostDetail>(`${BASE}/${slug}`);
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
