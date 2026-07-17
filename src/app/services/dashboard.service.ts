import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { DashboardSummaryDto } from '../types/dashboard.types';

/**
 * Client for the tenant dashboard aggregate endpoint.
 * Stateless — the page component owns the signals; this service only performs I/O.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
    private readonly http = inject(HttpClient);

    /**
     * Load the aggregate dashboard summary for the current tenant.
     *
     * Both `from` and `to` are optional and expected as ISO `yyyy-MM-dd`.
     * When omitted, the backend defaults to `[today-30d, today]`.
     */
    loadOverview(from?: string, to?: string): Observable<DashboardSummaryDto> {
        let params = new HttpParams();
        if (from) params = params.set('from', from);
        if (to) params = params.set('to', to);
        return this.http.get<DashboardSummaryDto>(
            `${environment.apiUrl}/dashboard/summary`,
            { params },
        );
    }
}
