import { HttpContext } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OWNED_HTTP_ERRORS } from '../../../services/http-errors.context';
import { environment } from '../../../../environments/environment';
import { AdminCouponRequest } from '../../../types/admin-coupon.types';
import { AdminCouponsService } from './admin-coupons.service';

const BASE = `${environment.apiUrl}/admin/billing/coupons`;
const REQUEST: AdminCouponRequest = {
  companyId: 'co-1',
  planCode: 'PRO_MONTHLY_STRIPE',
  amountOffCents: 4990,
  percentOff: null,
  durationMonths: 2,
  reason: 'Negociação',
};

describe('AdminCouponsService', () => {
  let http: HttpTestingController;
  let service: AdminCouponsService;
  const owned = (context: HttpContext): boolean => context.get(OWNED_HTTP_ERRORS);

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(AdminCouponsService);
  });

  afterEach(() => http.verify());

  it('lista os cupons', () => {
    service.list().subscribe();
    const req = http.expectOne(BASE);
    expect(req.request.method).toBe('GET');
    expect(owned(req.request.context)).toBe(true);
    req.flush([]);
  });

  it('pede a prévia com o corpo do contrato', () => {
    service.preview(REQUEST).subscribe();
    const req = http.expectOne(`${BASE}/preview`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(REQUEST);
    expect(owned(req.request.context)).toBe(true);
    req.flush({});
  });

  it('cria e desativa, e a tela é dona dos erros', () => {
    service.create(REQUEST).subscribe();
    const created = http.expectOne(BASE);
    expect(created.request.method).toBe('POST');
    expect(created.request.body).toEqual(REQUEST);
    expect(owned(created.request.context)).toBe(true);
    created.flush({});

    service.deactivate('abc/1').subscribe();
    const off = http.expectOne(`${BASE}/abc%2F1/deactivate`);
    expect(off.request.method).toBe('POST');
    expect(owned(off.request.context)).toBe(true);
    off.flush({});
  });

  it('resolve a empresa pelo detalhe, com o plano da assinatura', () => {
    let name: string | undefined;
    let planCode: string | null | undefined;
    service.company('co-1').subscribe((c) => {
      name = c.name;
      planCode = c.planCode;
    });
    http
      .expectOne(`${environment.apiUrl}/admin/companies/co-1`)
      .flush({ id: 'co-1', name: 'Locadora', documentMasked: null, subscription: { planCode: 'PRO_MONTHLY_STRIPE', planName: 'PRO' } });
    expect(name).toBe('Locadora');
    expect(planCode).toBe('PRO_MONTHLY_STRIPE');
  });

  it('empresa sem assinatura vira plano nulo', () => {
    let planCode: string | null | undefined = 'x';
    service.company('co-1').subscribe((c) => (planCode = c.planCode));
    http
      .expectOne(`${environment.apiUrl}/admin/companies/co-1`)
      .flush({ id: 'co-1', name: 'Locadora', documentMasked: null, subscription: null });
    expect(planCode).toBeNull();
  });

  it('busca empresas sem tocar no cache da página Empresas', () => {
    let found = 0;
    service.searchCompanies(' loca ').subscribe((list) => (found = list.length));
    const req = http.expectOne((r) => r.url === `${environment.apiUrl}/admin/companies`);
    expect(req.request.params.get('search')).toBe('loca');
    expect(req.request.params.get('size')).toBe('6');
    req.flush({ content: [{ id: 'co-1', name: 'Locadora', documentMasked: null, planCode: null, planName: null }], total: 1 });
    expect(found).toBe(1);
  });

  it('lê o catálogo de planos sem passar pelo cache da assinatura do tenant', () => {
    service.plans().subscribe();
    http.expectOne(`${environment.apiUrl}/billing/plans`).flush([]);
  });
});
