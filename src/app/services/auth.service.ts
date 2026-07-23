import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap, tap } from 'rxjs';
import { MeResponse } from '../types/me-response.type';
import { UserCompanies } from '../types/user-companies';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';

interface TokenResponse {
    token: string;
}

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private sessionService = inject(SessionService);

    constructor(private httpClient: HttpClient) { }

    getMe(): Observable<MeResponse> {
        return this.httpClient
            .get<MeResponse>(`${environment.apiUrl}/auth/me`)
            .pipe(
                tap((user) => this.writeSession(user)),
                switchMap((user) => {
                    const selectedId = this.sessionService.getItem('selectedCompanyId');
                    if (!selectedId) return of(user);
                    return this.httpClient
                        .post<TokenResponse>(
                            `${environment.apiUrl}/auth/select-company/${selectedId}`,
                            {},
                        )
                        .pipe(
                            tap((res) => {
                                if (res?.token) this.sessionService.setToken(res.token);
                            }),
                            switchMap(() => of(user)),
                        );
                }),
            );
    }

    /**
     * Same session writes as getMe() but SKIPS the /auth/select-company/{id}
     * token swap. Use when the caller already holds a company-scoped JWT
     * (e.g. onboarding finish() returns one) and re-swapping would either
     * discard that token or, if the user has multiple companies, silently
     * switch tenant to whatever getMe's OWNER-first default picks.
     */
    hydrateSession(): Observable<MeResponse> {
        return this.httpClient
            .get<MeResponse>(`${environment.apiUrl}/auth/me`)
            .pipe(tap((user) => this.writeSession(user)));
    }

    private writeSession(user: MeResponse): void {
        const companies: UserCompanies[] = user.companies ?? [];

        this.sessionService.setItem('id', user.id ?? '');
        this.sessionService.setItem('name', user.name ?? '');
        this.sessionService.setItem('email', user.email ?? '');
        this.sessionService.setItem('systemRole', user.systemRole ?? 'USER');
        // TODO(BUG-15): backend should expose an explicit `hasCompletedOnboarding`
        // (or `onboardingCompleted`) flag on /auth/me. Deriving it from
        // `companies.length > 0` breaks the "user left every org" case: they'll
        // be looped back into the onboarding flow even though they already
        // completed it once. Waiting on backend contract change.
        this.sessionService.setOnboardingCompleted(companies.length > 0);
        this.sessionService.setItem('userCompanies', JSON.stringify(companies));
        // Do NOT persist `user.document` — CPF/CNPJ is PII. Any consumer that
        // needs it must fetch /auth/me on demand and hold it in component memory.

        const defaultCompany =
            companies.find((company) => company.role === 'OWNER') ??
            companies[0];

        if (defaultCompany) {
            this.sessionService.setItem('selectedCompanyId', defaultCompany.companyId);
            this.sessionService.setItem('selectedCompanyName', defaultCompany.companyName);
            this.sessionService.setItem('selectedRole', defaultCompany.role);
        }
    }

    logout() {
        this.sessionService.clear();
    }
}