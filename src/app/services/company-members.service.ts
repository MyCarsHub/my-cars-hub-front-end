import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { CompanyMemberResponse } from '../types/company-member.types';
import { SessionService } from './session.service';
import { TenantResetRegistry } from './tenant-reset.registry';

/**
 * `/v1/companies/{companyId}/members` client — the roster of who can reach this company.
 *
 * ## Why `companyId` comes from the TOKEN
 *
 * The backend takes `companyId` from the path and NOT from the token on purpose (a user
 * may belong to several companies, so the selector has to be able to ask for one of them
 * by id). That is the backend's reason, and it is not a licence for the screen to pick the
 * id from anywhere it likes: the active tenant is `getCompanyIdFromToken()`, the same
 * source `roleGuard` reads. The `selectedCompanyId` mirror in `sessionStorage` is editable
 * from DevTools and goes stale on a company switch — sending it here would ask for one
 * company's roster while the rest of the screen believes it is in another.
 *
 * ## Removal is an UPDATE, never a DELETE
 *
 * `DELETE /{userId}` writes `status = 'REMOVED'`; the row keeps existing. That is
 * deliberate on the backend side: dropping the row would let an already-signed token go on
 * being valid. Nothing here may assume the record is gone — in particular, a removed
 * person can be re-invited, and the roster is simply the ACTIVE subset.
 *
 * The cache is company-scoped, so `reset()` is wired into the tenant reset the same way
 * `InvitesService` is: a `providedIn: 'root'` service outlives a logout in the same tab and
 * would otherwise show the previous tenant's member names and e-mails.
 */
@Injectable({ providedIn: 'root' })
export class CompanyMembersService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);

  private readonly _members = signal<CompanyMemberResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);

  readonly members = this._members.asReadonly();
  readonly loading = this._loading.asReadonly();
  /** `true` once a `list()` resolved — lets the screen tell "zero" from "unknown". */
  readonly loaded = this._loaded.asReadonly();
  readonly memberCount = computed(() => this._members().length);

  constructor() {
    inject(TenantResetRegistry).register(() => this.reset());
  }

  /**
   * `GET /v1/companies/{companyId}/members` — OWNER / MANAGER only; DRIVER gets 403.
   *
   * Returns ACTIVE memberships only. A missing tenant in the token is NOT a silent empty
   * list: without a company id there is no URL to call, and answering "no members" would
   * read as an empty company instead of a broken session.
   */
  list(): Observable<CompanyMemberResponse[]> {
    this._loading.set(true);
    return this.http.get<CompanyMemberResponse[]>(this.rosterUrl()).pipe(
      tap({
        next: (members) => {
          this._members.set(members ?? []);
          this._loaded.set(true);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
    );
  }

  /**
   * `DELETE /v1/companies/{companyId}/members/{userId}` — 204 with no body.
   *
   * The response carries no roster, so the cache drops the row locally instead of
   * re-fetching: the only information in a 204 is "it was removed". The backend answers 404
   * rather than 204 when the row stopped being ACTIVE between the read and the write, so a
   * success here really did write.
   */
  remove(userId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.rosterUrl()}/${userId}`)
      .pipe(tap(() => this._members.update((list) => list.filter((m) => m.userId !== userId))));
  }

  reset(): void {
    this._members.set([]);
    this._loading.set(false);
    this._loaded.set(false);
  }

  private rosterUrl(): string {
    const companyId = this.session.getCompanyIdFromToken();
    if (!companyId) {
      // Fail loudly. A URL built with `null` would hit a route that does not exist and come
      // back as a generic 404, which the screen would show as "company not found".
      throw new Error('Sem empresa ativa no token: nao ha roster para pedir.');
    }
    return `${environment.apiUrl}/companies/${companyId}/members`;
  }
}
