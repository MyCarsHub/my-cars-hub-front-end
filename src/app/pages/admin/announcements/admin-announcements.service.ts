import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import { AdminAnnouncement, AnnouncementRequest } from '../../../types/announcement.types';

const BASE = `${environment.apiUrl}/admin/announcements`;

/**
 * Novidades no admin (`novidades.gerir`, só o Dono). As telas traduzem cada falha, então
 * nada aqui passa pelo toast genérico.
 */
@Injectable({ providedIn: 'root' })
export class AdminAnnouncementsService {
  private readonly http = inject(HttpClient);
  private readonly context = (): HttpContext => new HttpContext().set(OWNED_HTTP_ERRORS, true);

  list(): Observable<AdminAnnouncement[]> {
    return this.http.get<AdminAnnouncement[]>(BASE, { context: this.context() });
  }

  get(id: string): Observable<AdminAnnouncement> {
    return this.http.get<AdminAnnouncement>(`${BASE}/${encodeURIComponent(id)}`, { context: this.context() });
  }

  create(request: AnnouncementRequest): Observable<AdminAnnouncement> {
    return this.http.post<AdminAnnouncement>(BASE, request, { context: this.context() });
  }

  update(id: string, request: AnnouncementRequest): Observable<AdminAnnouncement> {
    return this.http.put<AdminAnnouncement>(`${BASE}/${encodeURIComponent(id)}`, request, {
      context: this.context(),
    });
  }

  publish(id: string): Observable<AdminAnnouncement> {
    return this.http.post<AdminAnnouncement>(`${BASE}/${encodeURIComponent(id)}/publish`, {}, {
      context: this.context(),
    });
  }

  unpublish(id: string): Observable<AdminAnnouncement> {
    return this.http.post<AdminAnnouncement>(`${BASE}/${encodeURIComponent(id)}/unpublish`, {}, {
      context: this.context(),
    });
  }

  /** Só rascunho. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/${encodeURIComponent(id)}`, { context: this.context() });
  }
}
