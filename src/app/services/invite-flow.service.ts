import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  InviteAcceptAsMemberResponse,
  InviteAcceptResponse,
  InviteOnboardingContext,
  InviteValidateResponse,
  DriverOnboardingRequest,
  DriverOnboardingResponse,
  ManagerOnboardingRequest,
  ManagerOnboardingResponse,
} from '../types/invite-flow.types';
import { AuthService } from './auth.service';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { SessionService } from './session.service';

const INVITES = `${environment.apiUrl}/invites`;
const ONBOARDING = `${environment.apiUrl}/invite-onboarding`;

/**
 * Every call here is `SILENT_HTTP_ERRORS`: the invite screens own their errors (by `code`),
 * and the global interceptor's 401 branch would otherwise run `session.clear()` (wiping a
 * normal session the same tab may hold) for what is only a rejected invite credential.
 */
const owned = () => new HttpContext().set(SILENT_HTTP_ERRORS, true);

/** HTTP client of the new invite flow plus the one place that turns an ACCESS token into a session. */
@Injectable({ providedIn: 'root' })
export class InviteFlowService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);

  /** `POST /v1/invites/validate` - public. */
  validate(token: string): Observable<InviteValidateResponse> {
    return this.http.post<InviteValidateResponse>(
      `${INVITES}/validate`,
      { token },
      { context: owned() },
    );
  }

  /** `POST /v1/invites/accept` - public; never returns an access token. */
  accept(token: string, cpf: string): Observable<InviteAcceptResponse> {
    return this.http.post<InviteAcceptResponse>(
      `${INVITES}/accept`,
      { token, cpf },
      { context: owned() },
    );
  }

  /** `POST /v1/invites/accept-as-member` - needs the Google session (normal token). */
  acceptAsMember(token: string): Observable<InviteAcceptAsMemberResponse> {
    return this.http.post<InviteAcceptAsMemberResponse>(
      `${INVITES}/accept-as-member`,
      { token },
      { context: owned() },
    );
  }

  /** `GET /v1/invite-onboarding` - the interceptor attaches the onboarding token. */
  loadOnboarding(): Observable<InviteOnboardingContext> {
    return this.http.get<InviteOnboardingContext>(ONBOARDING, { context: owned() });
  }

  /** `POST /v1/invite-onboarding/manager`. */
  submitManager(payload: ManagerOnboardingRequest): Observable<ManagerOnboardingResponse> {
    return this.http.post<ManagerOnboardingResponse>(`${ONBOARDING}/manager`, payload, {
      context: owned(),
    });
  }

  /** `POST /v1/invite-onboarding/driver` - the interceptor attaches the onboarding token. */
  submitDriver(payload: DriverOnboardingRequest): Observable<DriverOnboardingResponse> {
    return this.http.post<DriverOnboardingResponse>(`${ONBOARDING}/driver`, payload, {
      context: owned(),
    });
  }

  /**
   * The app's normal login path for an ACCESS token that is already company-scoped (same
   * writes as the old accept: no `/auth/me`, whose OWNER-first default could drop the member
   * into another tenant).
   *
   * Whatever session this tab held belongs to somebody else by now, so it is dropped first
   * through `logout()` (caches, impersonation, storage). That also deletes the onboarding
   * token and the stashed invite token, which is exactly what should happen on success.
   */
  signIn(accessToken: string, company: { name: string; role: string }, userName?: string): void {
    this.auth.logout();
    this.session.setToken(accessToken);
    this.auth.applyFinishResponse({
      token: accessToken,
      companyId: this.session.getCompanyIdFromToken() ?? undefined,
      companyName: company.name,
      role: company.role,
    });
    // `/auth/me` is skipped on this path, so the identity keys it would have written come from
    // the token's own claims; without them the shell and the profile render an empty person.
    const identity = this.session.getIdentityFromToken();
    if (identity?.id) this.session.setItem('id', identity.id);
    if (identity?.email) this.session.setItem('email', identity.email);
    const name = userName ?? identity?.name;
    if (name) this.session.setItem('name', name);
  }
}
