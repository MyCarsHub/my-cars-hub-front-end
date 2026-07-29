import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';
import { CompanyFullResponse } from '../types/company-full-response.type';
import { UpdateCompanyRequest } from '../types/company-settings.types';

@Injectable({
    providedIn: 'root',
})
export class CompanyService {
    constructor(
        private httpClient: HttpClient,
        private sessionService: SessionService
    ) { }

    getInfoCompany() {
        return this.httpClient.get<CompanyFullResponse>(
            `${environment.apiUrl}/companies/${this.sessionService.getItem('selectedCompanyId')}`
        );
    }

    /**
     * `PUT /v1/companies/me` — updates the authenticated user's own company.
     * Tenant comes from the access token, so there is no id in the URL or in the body.
     */
    updateCompany(payload: UpdateCompanyRequest) {
        return this.httpClient.put<CompanyFullResponse>(
            `${environment.apiUrl}/companies/me`,
            payload
        );
    }
}