import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { PagedResponse } from '../../../types/paged.types';
import { AdminUserListItem } from '../../../types/admin-user.types';
import { AdminMember, AdminRole, AdminRoleReason } from '../../../types/admin-roles.types';

const BASE = `${environment.apiUrl}/admin/admins`;

/** Admins e papéis (`/v1/admin/admins`). Só o Dono chama (`admins.gerir`). */
@Injectable({ providedIn: 'root' })
export class AdminRolesService {
  private readonly http = inject(HttpClient);

  list(): Observable<AdminMember[]> {
    return this.http.get<AdminMember[]>(BASE);
  }

  grant(userId: string, role: AdminRole, reason: AdminRoleReason): Observable<AdminMember> {
    return this.http.post<AdminMember>(BASE, { userId, role, reason });
  }

  changeRole(id: string, role: AdminRole, reason: AdminRoleReason): Observable<AdminMember> {
    return this.http.patch<AdminMember>(`${BASE}/${id}`, { role, reason });
  }

  revoke(id: string, reason: AdminRoleReason): Observable<void> {
    return this.http.post<void>(`${BASE}/${id}/revoke`, { reason });
  }

  /** Candidatos: contas ativas que ainda não são admin. */
  searchCandidates(term: string): Observable<AdminUserListItem[]> {
    const params = new HttpParams()
      .set('search', term.trim())
      .set('status', 'ACTIVE')
      .set('systemRole', 'USER')
      .set('page', '0')
      .set('size', '6');
    return this.http
      .get<PagedResponse<AdminUserListItem>>(`${environment.apiUrl}/admin/users`, { params })
      .pipe(map((res) => res.content ?? []));
  }
}
