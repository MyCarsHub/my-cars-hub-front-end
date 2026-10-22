import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service';
import { MembershipsService } from './memberships.service';
import { InviteOnboardingTokenStore } from './invite-onboarding-token.store';
import { environment } from '../../environments/environment';

/**
 * Which company a login opens. Today's rule is "OWNER first, else the first one"; a backend
 * that sends `defaultCompanyId` (the company used last) overrides it, but only when that id
 * is one of the companies in the same response. Single-company people are unaffected.
 */
describe('AuthService — initial company after login', () => {
  let service: AuthService;
  let http: HttpTestingController;

  const owner = { companyId: 'co-owner', companyName: 'Minha', role: 'OWNER' };
  const manager = { companyId: 'co-mgr', companyName: 'Outra', role: 'MANAGER' };
  const driver = { companyId: 'co-drv', companyName: 'Frota', role: 'DRIVER' };

  function login(me: Record<string, unknown>) {
    service.getMe().subscribe();
    http.expectOne(`${environment.apiUrl}/auth/me`).flush({
      id: 'u1',
      name: 'Pessoa',
      email: 'p@x.com',
      systemRole: 'USER',
      hasCompletedOnboarding: true,
      ...me,
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('keeps the old rule when defaultCompanyId is absent: OWNER first', () => {
    login({ companies: [manager, owner, driver] });
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-owner`).flush({ token: 't' });
    expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-owner');
    expect(sessionStorage.getItem('selectedRole')).toBe('OWNER');
  });

  it('a defaultCompanyId of a lower role does not pull an owner out of their company', () => {
    login({ companies: [owner, manager, driver], defaultCompanyId: 'co-drv' });
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-owner`).flush({ token: 't' });
    expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-owner');
    expect(sessionStorage.getItem('selectedRole')).toBe('OWNER');
  });

  it('uses defaultCompanyId when it names a company of the top role', () => {
    const owner2 = { ...owner, companyId: 'co-owner-2', companyName: 'Segunda' };
    login({ companies: [owner, owner2, driver], defaultCompanyId: 'co-owner-2' });
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-owner-2`).flush({ token: 't' });
    expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-owner-2');
    expect(sessionStorage.getItem('selectedRole')).toBe('OWNER');
  });

  it('ignores a defaultCompanyId that is not in the list and falls back to OWNER first', () => {
    login({ companies: [manager, owner], defaultCompanyId: 'co-unknown' });
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-owner`).flush({ token: 't' });
    expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-owner');
  });

  it('a single-company person is unchanged, with or without defaultCompanyId', () => {
    login({ companies: [manager], defaultCompanyId: null });
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-mgr`).flush({ token: 't' });
    expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-mgr');
  });

  it('seeds the memberships service from /auth/me, so the switcher needs no second request', () => {
    login({
      companies: [owner],
      memberships: [
        {
          companyId: 'co-owner',
          companyName: 'Minha',
          role: 'OWNER',
          roleLabel: 'Dono',
          status: 'ACTIVE',
          lastSelectedAt: null,
          needsOnboarding: false,
        },
      ],
      pendingInvites: [{ companyName: 'Delta', roleLabel: 'Gerenciador' }],
      defaultCompanyId: 'co-owner',
    });
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-owner`).flush({ token: 't' });
    const memberships = TestBed.inject(MembershipsService);
    expect(memberships.status()).toBe('ready');
    expect(memberships.pendingInvites().length).toBe(1);
  });

  it('never stores an onboarding token as the session token', () => {
    sessionStorage.setItem('token', 'session-token');
    login({ companies: [owner] });
    http
      .expectOne(`${environment.apiUrl}/auth/select-company/co-owner`)
      .flush({ token: 'onboarding-token', kind: 'INVITE_ONBOARDING' });
    expect(sessionStorage.getItem('token')).toBe('session-token');
    expect(TestBed.inject(InviteOnboardingTokenStore).get()).toBeNull();
  });
});
