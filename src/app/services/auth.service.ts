import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { tap } from 'rxjs';
import { MeResponse } from '../types/me-response.type';
import { UserCompanies } from '../types/user-companies';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private sessionService = inject(SessionService);

    constructor(private httpClient: HttpClient) { }

    getMe() {
        return this.httpClient
            .get<MeResponse>(`${environment.apiUrl}/auth/me`)
            .pipe(
                tap((user) => {
                    const companies: UserCompanies[] = user.companies ?? [];

                    this.sessionService.setItem('name', user.name ?? '');
                    this.sessionService.setItem('email', user.email ?? '');
                    this.sessionService.setOnboardingCompleted(companies.length > 0);
                    this.sessionService.setItem('userCompanies', JSON.stringify(companies));

                    const defaultCompany =
                        companies.find((company) => company.role === 'OWNER') ??
                        companies[0];

                    if (defaultCompany) {
                        this.sessionService.setItem('selectedCompanyId', defaultCompany.companyId);
                        this.sessionService.setItem('selectedCompanyName', defaultCompany.companyName);
                        this.sessionService.setItem('selectedRole', defaultCompany.role);
                    }
                })
            );
    }

    logout() {
        this.sessionService.clear();
    }
}