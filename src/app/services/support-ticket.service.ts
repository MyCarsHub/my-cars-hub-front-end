import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { PagedResponse } from '../types/paged.types';
import { AdminCompanyListItem } from '../types/admin-company.types';
import { AdminUserListItem } from '../types/admin-user.types';
import {
  AssignSupportTicketRequest,
  CreateSupportTicketReplyRequest,
  CreateSupportTicketRequest,
  SupportAssigneeOption,
  SupportCompanyOption,
  SupportTicketAdminDetail,
  SupportTicketAdminItem,
  SupportTicketDto,
  SupportTicketStatus,
  UpdateSupportTicketStatusRequest,
} from '../types/support.types';

const BASE = `${environment.apiUrl}/support/tickets`;
const ADMIN_BASE = `${environment.apiUrl}/admin/support/tickets`;
const ADMIN_USERS_BASE = `${environment.apiUrl}/admin/users`;
const ADMIN_COMPANIES_BASE = `${environment.apiUrl}/admin/companies`;

/** Teto do backend é 100; os dois seletores pedem uma página só. */
const OPTIONS_PAGE_SIZE = 100;

export interface AdminSupportListQuery {
  status?: SupportTicketStatus | '' | null;
  companyId?: string | null;
  page?: number;
  size?: number;
}

/**
 * Porta HTTP dos tickets de suporte — sem estado. Quem guarda listagem,
 * filtros e thread aberta é a tela.
 *
 * As três mutações admin (status, resposta, atribuição) devolvem
 * `SupportTicketAdminDetailDto`, não a linha crua: o backend já manda o card
 * atualizado + a thread, então a tela nunca precisa de um GET de volta.
 */
@Injectable({ providedIn: 'root' })
export class SupportTicketService {
  private readonly http = inject(HttpClient);

  create(payload: CreateSupportTicketRequest): Observable<SupportTicketDto> {
    return this.http.post<SupportTicketDto>(BASE, payload);
  }

  adminList(query: AdminSupportListQuery = {}): Observable<PagedResponse<SupportTicketAdminItem>> {
    let params = new HttpParams()
      .set('page', String(query.page ?? 0))
      .set('size', String(query.size ?? 20));
    if (query.status) params = params.set('status', query.status);
    if (query.companyId) params = params.set('companyId', query.companyId);
    return this.http.get<PagedResponse<SupportTicketAdminItem>>(ADMIN_BASE, { params });
  }

  adminGet(id: string): Observable<SupportTicketAdminDetail> {
    return this.http.get<SupportTicketAdminDetail>(`${ADMIN_BASE}/${id}`);
  }

  adminUpdateStatus(
    id: string,
    payload: UpdateSupportTicketStatusRequest,
  ): Observable<SupportTicketAdminDetail> {
    return this.http.patch<SupportTicketAdminDetail>(`${ADMIN_BASE}/${id}`, payload);
  }

  /**
   * Responde o autor. 201 no sucesso.
   *
   * `emailStatus` na resposta é o DESPACHO pretendido, não o resultado do
   * envio: o backend monta o DTO antes do commit e só despacha depois dele.
   */
  adminReply(
    id: string,
    payload: CreateSupportTicketReplyRequest,
  ): Observable<SupportTicketAdminDetail> {
    return this.http.post<SupportTicketAdminDetail>(`${ADMIN_BASE}/${id}/replies`, payload);
  }

  /**
   * Define o responsável. `assigneeId` é obrigatório — corpo sem ele responde
   * 400, não desatribuição. UUID que não seja PLATFORM_ADMIN ativo → 400.
   */
  adminAssign(
    id: string,
    payload: AssignSupportTicketRequest,
  ): Observable<SupportTicketAdminDetail> {
    return this.http.put<SupportTicketAdminDetail>(`${ADMIN_BASE}/${id}/assignee`, payload);
  }

  /**
   * Devolve o ticket à fila. Rota própria porque "sem responsável" é uma
   * intenção explícita, e não um campo omitido no PUT. Devolve o mesmo
   * `SupportTicketAdminDetail` do `adminAssign`.
   */
  adminUnassign(id: string): Observable<SupportTicketAdminDetail> {
    return this.http.delete<SupportTicketAdminDetail>(`${ADMIN_BASE}/${id}/assignee`);
  }

  /** Candidatos a responsável: os PLATFORM_ADMIN atuais. */
  adminAssignees(): Observable<SupportAssigneeOption[]> {
    const params = new HttpParams()
      .set('systemRole', 'PLATFORM_ADMIN')
      .set('page', '0')
      .set('size', String(OPTIONS_PAGE_SIZE));
    return this.http
      .get<PagedResponse<AdminUserListItem>>(ADMIN_USERS_BASE, { params })
      .pipe(
        map((res) =>
          (res.content ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email })),
        ),
      );
  }

  /** Empresas do filtro. Cap de uma página — acima disso o filtro fica parcial. */
  adminCompanies(): Observable<SupportCompanyOption[]> {
    const params = new HttpParams().set('page', '0').set('size', String(OPTIONS_PAGE_SIZE));
    return this.http
      .get<PagedResponse<AdminCompanyListItem>>(ADMIN_COMPANIES_BASE, { params })
      .pipe(map((res) => (res.content ?? []).map((c) => ({ id: c.id, name: c.name }))));
  }
}
