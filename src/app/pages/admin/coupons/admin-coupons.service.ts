import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import { PagedResponse } from '../../../types/paged.types';
import { AdminCompanyDetail, AdminCompanyListItem } from '../../../types/admin-company.types';
import { PlanResponse } from '../../../types/billing.types';
import {
  AdminCoupon,
  AdminCouponPreview,
  AdminCouponRequest,
  CouponCompany,
} from '../../../types/admin-coupon.types';

const BASE = `${environment.apiUrl}/admin/billing/coupons`;
const COMPANIES = `${environment.apiUrl}/admin/companies`;

/** Basta para achar uma empresa pelo nome; a folha não é uma listagem. */
const SEARCH_SIZE = 6;

/**
 * Cupons de assinatura. A lista mora na Stripe. O servidor confere a capacidade
 * em toda rota; as telas traduzem cada falha, inclusive 503, então nada aqui
 * passa pelo toast genérico.
 *
 * Empresa e planos vêm direto da API, e não de `AdminCompaniesService` e
 * `BillingService`: aqueles guardam o resultado em sinais que a página Empresas
 * e a Assinatura leem, e uma busca nesta folha trocaria o que elas mostram.
 */
@Injectable({ providedIn: 'root' })
export class AdminCouponsService {
  private readonly http = inject(HttpClient);
  private readonly context = (): HttpContext => new HttpContext().set(OWNED_HTTP_ERRORS, true);

  list(): Observable<AdminCoupon[]> {
    return this.http.get<AdminCoupon[]>(BASE, { context: this.context() });
  }

  preview(request: AdminCouponRequest): Observable<AdminCouponPreview> {
    return this.http.post<AdminCouponPreview>(`${BASE}/preview`, request, { context: this.context() });
  }

  create(request: AdminCouponRequest): Observable<AdminCoupon> {
    return this.http.post<AdminCoupon>(BASE, request, { context: this.context() });
  }

  deactivate(couponId: string): Observable<AdminCoupon> {
    return this.http.post<AdminCoupon>(
      `${BASE}/${encodeURIComponent(couponId)}/deactivate`,
      {},
      { context: this.context() },
    );
  }

  /** O item da lista só traz o id: é daqui que sai o nome da empresa. */
  company(id: string): Observable<CouponCompany> {
    return this.http.get<AdminCompanyDetail>(`${COMPANIES}/${id}`, { context: this.context() }).pipe(
      map((detail) => ({
        id: detail.id,
        name: detail.name,
        documentMasked: detail.documentMasked,
        planCode: detail.subscription?.planCode ?? null,
        planName: detail.subscription?.planName ?? null,
      })),
    );
  }

  searchCompanies(term: string): Observable<CouponCompany[]> {
    const params = new HttpParams().set('search', term.trim()).set('size', String(SEARCH_SIZE));
    return this.http
      .get<PagedResponse<AdminCompanyListItem>>(COMPANIES, { params, context: this.context() })
      .pipe(
        map((page) =>
          (page.content ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            documentMasked: item.documentMasked,
            planCode: item.planCode,
            planName: item.planName,
          })),
        ),
      );
  }

  plans(): Observable<PlanResponse[]> {
    return this.http.get<PlanResponse[]>(`${environment.apiUrl}/billing/plans`, { context: this.context() });
  }
}
