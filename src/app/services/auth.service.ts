import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap, tap } from 'rxjs';
import { MeResponse } from '../types/me-response.type';
import { UserCompanies } from '../types/user-companies';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';
import { LoggerService } from './logger.service';
import { ImpersonationService } from './impersonation.service';
import { TenantCachesService } from './tenant-caches.service';

interface TokenResponse {
    token: string;
}

/**
 * Shape of POST /onboarding/finish success response. Duplicated here to avoid
 * a circular import with the onboarding feature module — the actual interface
 * lives in `pages/onboarding/onboarding.service.ts`.
 */
export interface OnboardingFinishSessionPayload {
    token?: string;
    companyId?: string;
    companyName?: string;
    role?: string;
}

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private sessionService = inject(SessionService);
    private tenantCaches = inject(TenantCachesService);
    private logger = inject(LoggerService);
    private impersonation = inject(ImpersonationService);

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

    /**
     * Persist session state directly from the /onboarding/finish response,
     * skipping the /auth/me round trip. Called BEFORE hydrateSession() so
     * that the layout store can read a populated `userCompanies` even if
     * /auth/me later returns companies=[] due to Supabase session-pooler
     * read-your-writes lag (the finish commit may not be visible to the
     * connection that serves /me). Idempotent, synchronous, no HTTP.
     */
    applyFinishResponse(response: OnboardingFinishSessionPayload | null | undefined): void {
        if (!response) return;

        if (response.token) {
            this.sessionService.setToken(response.token);
        }

        if (response.companyId) {
            const role = (response.role as UserCompanies['role']) ?? 'OWNER';
            const company: UserCompanies = {
                companyId: response.companyId,
                companyName: response.companyName ?? '',
                role,
            };
            this.sessionService.setItem('userCompanies', JSON.stringify([company]));
            this.sessionService.setItem('selectedCompanyId', company.companyId);
            this.sessionService.setItem('selectedCompanyName', company.companyName);
            this.sessionService.setItem('selectedRole', company.role);
            this.sessionService.setOnboardingCompleted(true);
        }
    }

    private writeSession(user: MeResponse): void {
        const companiesFromMe: UserCompanies[] = user.companies ?? [];

        this.sessionService.setItem('id', user.id ?? '');
        this.sessionService.setItem('name', user.name ?? '');
        this.sessionService.setItem('email', user.email ?? '');
        this.sessionService.setItem('systemRole', user.systemRole ?? 'USER');

        // Defensive: if /auth/me returns companies=[] but session already has
        // entries (typically written by applyFinishResponse right after
        // /onboarding/finish), preserve them. This guards against Supabase
        // session-pooler read-your-writes lag where /me is served from a
        // connection that hasn't yet observed the finish transaction.
        const existingRaw = this.sessionService.getItem('userCompanies');
        let existing: UserCompanies[] = [];
        if (existingRaw) {
            try {
                const parsed = JSON.parse(existingRaw) as unknown;
                if (Array.isArray(parsed)) existing = parsed as UserCompanies[];
            } catch {
                existing = [];
            }
        }
        const companies =
            companiesFromMe.length === 0 && existing.length > 0 ? existing : companiesFromMe;

        // PLATFORM_ADMIN never goes through onboarding — they operate above
        // the tenant model. Force the flag true regardless of companies list
        // so guards / oauth-success never bounce them to /onboarding.
        //
        // BUG-15 resolved by BE PR #30: /auth/me now exposes the explicit
        // `hasCompletedOnboarding` flag. We use it as source of truth when
        // present. The legacy `companies.length > 0` derivation is kept as a
        // defensive fallback so a deploy skew (FE ahead of BE) doesn't loop
        // returning users into onboarding. Remove the fallback once BE #30
        // is guaranteed live in every environment.
        const isPlatformAdmin = user.systemRole === 'PLATFORM_ADMIN';
        const explicitFlag = user.hasCompletedOnboarding;
        const derivedFlag = companies.length > 0;
        if (explicitFlag === undefined || explicitFlag === null) {
            this.logger.warn(
                '[auth] /auth/me did not return `hasCompletedOnboarding`; falling back to companies-length derivation. Likely FE/BE deploy skew.',
            );
        }
        const isCompleted = isPlatformAdmin || (explicitFlag ?? derivedFlag);
        this.sessionService.setOnboardingCompleted(isCompleted);

        // Tour guiado — mesma mecânica do flag acima, com uma diferença que
        // importa: quando o backend NÃO envia o campo (deploy skew, o endpoint
        // ainda não está em produção), não escrevemos `false` por cima de um
        // `true` que a própria sessão gravou ao concluir o tour. Sobrescrever
        // reabriria o balão na cara de quem acabou de fechá-lo em qualquer
        // re-hidratação de sessão.
        const seenTour = user.hasSeenTour;
        if (seenTour === undefined || seenTour === null) {
            if (this.sessionService.getItem('tourSeen') === null) {
                this.sessionService.setTourSeen(false);
            }
        } else {
            this.sessionService.setTourSeen(seenTour);
        }

        this.sessionService.setItem('userCompanies', JSON.stringify(companies));
        // Do NOT persist `user.document` — CPF/CNPJ is PII. Any consumer that
        // needs it must fetch /auth/me on demand and hold it in component memory.

        const defaultCompany =
            companies.find((company) => company.role === 'OWNER') ??
            companies[0];

        // Preserve any selection already made by applyFinishResponse if /me
        // couldn't offer a fresh default.
        const hasExistingSelection = !!this.sessionService.getItem('selectedCompanyId');
        if (defaultCompany && (!hasExistingSelection || companiesFromMe.length > 0)) {
            this.sessionService.setItem('selectedCompanyId', defaultCompany.companyId);
            this.sessionService.setItem('selectedCompanyName', defaultCompany.companyName);
            this.sessionService.setItem('selectedRole', defaultCompany.role);
        }
    }

    /**
     * Logout NÃO recarrega a página, então os serviços `providedIn: 'root'`
     * sobrevivem na mesma aba com o cache do usuário anterior. O polling para
     * primeiro (um tick em voo repopularia o contador); em seguida os caches
     * por empresa e a sessão de impersonação caem; o armazenamento vai por
     * último, e o gancho registrado nele repassa a mesma limpeza — de novo, e
     * agora também para as outras cinco quedas de sessão do app.
     */
    logout() {
        // As duas primeiras linhas são as MESMAS que `SessionService.clear()`
        // dispara via `SessionResetRegistry` — chamá-las aqui é redundante de
        // propósito (ambas idempotentes) para que o logout não dependa de um
        // gancho ter sido registrado. O que mudou é que os outros cinco
        // caminhos que zeram a sessão agora limpam o mesmo tanto, em vez de
        // deixarem impersonação e caches para trás.
        this.tenantCaches.dropForSessionEnd();
        this.impersonation.reset();
        this.sessionService.clear();
    }
}