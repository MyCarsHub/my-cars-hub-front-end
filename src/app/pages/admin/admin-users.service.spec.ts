import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { AdminUserListItem } from '../../types/admin-user.types';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService — FEAT-0482', () => {
  const ITEM: AdminUserListItem = {
    id: 'u1',
    name: 'Ana',
    email: 'a@x.com',
    systemRole: 'USER',
    active: true,
    createdDate: null,
    lastCompanyName: null,
    companyCount: 1,
    companies: [{ companyId: 'c1', companyName: 'Alfa', role: 'OWNER' }],
  };

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return { svc: TestBed.inject(AdminUsersService), http: TestBed.inject(HttpTestingController) };
  }

  it('a resposta do PATCH (sem companies) não apaga as empresas da linha', () => {
    const { svc, http } = setup();
    svc.load().subscribe();
    http
      .expectOne((r) => r.url.endsWith('/admin/users'))
      .flush({ content: [ITEM], page: 0, size: 20, total: 1 });

    svc.updateStatus('u1', false).subscribe();
    const patched = {
      id: 'u1',
      name: 'Ana',
      email: 'a@x.com',
      systemRole: 'USER',
      active: false,
      createdDate: null,
      lastCompanyName: null,
    };
    http.expectOne((r) => r.url.endsWith('/admin/users/u1/status')).flush(patched);

    const row = svc.items()[0];
    expect(row.active).toBe(false);
    expect(row.companyCount).toBe(1);
    expect(row.companies).toHaveLength(1);
  });

  it('resendInvite faz POST em /resend-invite', () => {
    const { svc, http } = setup();
    let out: unknown;
    svc.resendInvite('u1').subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url.endsWith('/admin/users/u1/resend-invite'));
    expect(req.request.method).toBe('POST');
    req.flush({ resent: 2 });
    expect(out).toEqual({ resent: 2 });
  });
});
