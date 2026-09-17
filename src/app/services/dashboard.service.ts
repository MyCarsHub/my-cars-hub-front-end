import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { DashboardSummaryDto } from '../types/dashboard.types';
import { CashAccumulationResponse } from '../types/cash-accumulation.types';

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

    /**
     * Curva ACUMULADA do dinheiro RECEBIDO no mes (FEAT-0123).
     *
     * `reference` (ISO `yyyy-MM-dd`) e OPCIONAL: ausente, o backend usa hoje.
     * Ele define o mes corrente E ate que dia a curva vai — e o que permite
     * navegar entre meses sem um segundo endpoint.
     *
     * NAO confundir com `loadOverview().finance.revenueDaily`: aquilo distribui
     * o total do aluguel pelos dias (competencia); isto e caixa.
     */
    loadCashAccumulation(reference?: string): Observable<CashAccumulationResponse> {
        let params = new HttpParams();
        if (reference) params = params.set('reference', reference);
        return this.http.get<CashAccumulationResponse>(
            `${environment.apiUrl}/dashboard/cash-accumulation`,
            { params },
        );
    }
}
