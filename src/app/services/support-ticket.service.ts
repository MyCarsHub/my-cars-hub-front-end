import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import {
  CreateSupportTicketRequest,
  SupportTicketDto,
  SupportTicketStatus,
  UpdateSupportTicketStatusRequest,
} from '../types/support.types';

const BASE = `${environment.apiUrl}/support/tickets`;
const ADMIN_BASE = `${environment.apiUrl}/admin/support/tickets`;

@Injectable({ providedIn: 'root' })
export class SupportTicketService {
  private readonly http = inject(HttpClient);

  create(payload: CreateSupportTicketRequest): Observable<SupportTicketDto> {
    return this.http.post<SupportTicketDto>(BASE, payload);
  }

  adminList(
    status: SupportTicketStatus | '' | null | undefined,
    page: number,
    size: number,
  ): Observable<PagedResponse<SupportTicketDto>> {
    let params = new HttpParams()
      .set('page', String(page))
      .set('size', String(size));
    if (status) params = params.set('status', status);
    return this.http.get<PagedResponse<SupportTicketDto>>(ADMIN_BASE, { params });
  }

  adminGet(id: string): Observable<SupportTicketDto> {
    return this.http.get<SupportTicketDto>(`${ADMIN_BASE}/${id}`);
  }

  adminUpdateStatus(
    id: string,
    payload: UpdateSupportTicketStatusRequest,
  ): Observable<SupportTicketDto> {
    return this.http.patch<SupportTicketDto>(`${ADMIN_BASE}/${id}`, payload);
  }
}
