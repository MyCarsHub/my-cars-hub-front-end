import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { tap } from 'rxjs';
import { MeResponse } from '../types/me-response.type';
import { UserCompanies } from '../types/user-companies';

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    constructor(private httpClient: HttpClient) { }

    getMe() {
        return this.httpClient
            .get<MeResponse>('http://localhost:8085/v1/auth/me')
            .pipe(
                tap((user) => {
                    const companies: UserCompanies[] = user.companies ?? [];

                    sessionStorage.setItem('name', user.name ?? '');
                    sessionStorage.setItem('email', user.email ?? '');

                    sessionStorage.setItem(
                        'onboardingCompleted',
                        companies.length > 0 ? "true" : "false"
                    );

                    sessionStorage.setItem(
                        'userCompanies',
                        JSON.stringify(companies)
                    );

                    const defaultCompany =
                        companies.find(company => company.role === 'OWNER') ??
                        companies[0];

                    if (defaultCompany) {
                        sessionStorage.setItem(
                            'selectedCompanyId',
                            defaultCompany.companyId
                        );

                        sessionStorage.setItem(
                            'selectedCompanyName',
                            defaultCompany.companyName
                        );

                        sessionStorage.setItem(
                            'selectedRole',
                            defaultCompany.role
                        );
                    }
                })
            );
    }

    logout() {
        sessionStorage.clear();
    }
}