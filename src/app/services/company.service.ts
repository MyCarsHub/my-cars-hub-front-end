import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { SessionService } from './session.service';
import { CompanyFullResponse } from '../types/company-full-response.type';

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
}