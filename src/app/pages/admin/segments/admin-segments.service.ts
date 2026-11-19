import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { PagedResponse } from '../../../types/paged.types';
import type {
  ActivityFilter,
  ActivityItem,
  CompanyContact,
  CompanyEngagement,
  RegisterContactRequest,
  RegisterContactResponse,
  TodayList,
} from '../../../types/admin-segments.types';

const API_BASE = `${environment.apiUrl}/admin/companies`;

/**
 * Segmentos, "Hoje, para agir", atividade e registro de contato (contrato de 18/11/2026, §3.2
 * a §3.7). A lista e o detalhe continuam em `AdminCompaniesService`: os dois só ganharam blocos.
 */
@Injectable({ providedIn: 'root' })
export class AdminSegmentsService {
  private readonly http = inject(HttpClient);

  today(): Observable<TodayList> {
    return this.http.get<TodayList>(`${API_BASE}/today`);
  }

  engagement(companyId: string): Observable<CompanyEngagement> {
    return this.http.get<CompanyEngagement>(`${API_BASE}/${companyId}/engagement`);
  }

  activity(
    companyId: string,
    category: ActivityFilter = 'ALL',
    page = 0,
    size = 20,
  ): Observable<PagedResponse<ActivityItem>> {
    const params = new HttpParams()
      .set('category', category)
      .set('page', String(page))
      .set('size', String(size));
    return this.http.get<PagedResponse<ActivityItem>>(`${API_BASE}/${companyId}/activity`, { params });
  }

  contacts(companyId: string, page = 0, size = 20): Observable<PagedResponse<CompanyContact>> {
    const params = new HttpParams().set('page', String(page)).set('size', String(size));
    return this.http.get<PagedResponse<CompanyContact>>(`${API_BASE}/${companyId}/contacts`, { params });
  }

  registerContact(companyId: string, body: RegisterContactRequest): Observable<RegisterContactResponse> {
    return this.http.post<RegisterContactResponse>(`${API_BASE}/${companyId}/contacts`, body);
  }
}
