import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { MeResponse } from '../types/me-response.type';

/**
 * Covers the race-fix (see `applyFinishResponse` + `writeSession` guard):
 * after /onboarding/finish we persist company info directly from the finish
 * response so a subsequent /auth/me returning companies=[] (Supabase pooler
 * read-your-writes lag) does NOT downgrade the session.
 */
describe('AuthService', () => {
  let store: Record<string, string>;
  let sessionMock: {
    setItem: ReturnType<typeof vi.fn>;
    getItem: ReturnType<typeof vi.fn>;
    setToken: ReturnType<typeof vi.fn>;
    setOnboardingCompleted: ReturnType<typeof vi.fn>;
  };
  let httpGet: ReturnType<typeof vi.fn>;
  let service: AuthService;

  beforeEach(() => {
    store = {};
    sessionMock = {
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      getItem: vi.fn((key: string) => store[key] ?? null),
      setToken: vi.fn((token: string) => {
        store['token'] = token;
      }),
      setOnboardingCompleted: vi.fn((completed: boolean) => {
        store['onboardingCompleted'] = completed ? 'true' : 'false';
      }),
    };
    httpGet = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: SessionService, useValue: sessionMock },
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn() } },
      ],
    });
    service = TestBed.inject(AuthService);
  });

  describe('applyFinishResponse', () => {
    it('writes token, userCompanies, selectedCompanyId/Name/Role', () => {
      service.applyFinishResponse({
        token: 'jwt-scoped',
        companyId: 'c-1',
        companyName: 'Oficina Alpha',
        role: 'OWNER',
      });

      expect(store['token']).toBe('jwt-scoped');
      expect(store['selectedCompanyId']).toBe('c-1');
      expect(store['selectedCompanyName']).toBe('Oficina Alpha');
      expect(store['selectedRole']).toBe('OWNER');
      expect(store['onboardingCompleted']).toBe('true');
      expect(JSON.parse(store['userCompanies'])).toEqual([
        { companyId: 'c-1', companyName: 'Oficina Alpha', role: 'OWNER' },
      ]);
    });

    it('is idempotent — calling twice yields the same session state', () => {
      const payload = {
        token: 't',
        companyId: 'c-1',
        companyName: 'A',
        role: 'OWNER',
      };
      service.applyFinishResponse(payload);
      const snapshot = { ...store };
      service.applyFinishResponse(payload);
      expect(store).toEqual(snapshot);
    });

    it('is a no-op for null/undefined', () => {
      service.applyFinishResponse(null);
      service.applyFinishResponse(undefined);
      expect(sessionMock.setItem).not.toHaveBeenCalled();
      expect(sessionMock.setToken).not.toHaveBeenCalled();
    });

    it('defaults role to OWNER when missing', () => {
      service.applyFinishResponse({ companyId: 'c-1', companyName: 'A' });
      expect(store['selectedRole']).toBe('OWNER');
    });
  });

  describe('hydrateSession preserves userCompanies on empty /me', () => {
    function buildMe(companies: MeResponse['companies']): MeResponse {
      return {
        id: 'u-1',
        name: 'Lorran',
        email: 'l@x.com',
        document: null,
        onboardingCompleted: true,
        systemRole: 'USER',
        companies,
      };
    }

    it('does NOT overwrite userCompanies when /auth/me returns companies=[]', () => {
      service.applyFinishResponse({
        token: 't',
        companyId: 'c-1',
        companyName: 'Alpha',
        role: 'OWNER',
      });

      httpGet.mockReturnValue(of(buildMe([])));

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      const persisted = JSON.parse(store['userCompanies']);
      expect(persisted).toEqual([
        { companyId: 'c-1', companyName: 'Alpha', role: 'OWNER' },
      ]);
      expect(store['selectedCompanyId']).toBe('c-1');
      expect(store['selectedRole']).toBe('OWNER');
      // profile enriched from /me
      expect(store['id']).toBe('u-1');
      expect(store['name']).toBe('Lorran');
      expect(store['email']).toBe('l@x.com');
      expect(store['onboardingCompleted']).toBe('true');
    });

    it('forces onboardingCompleted=true when systemRole is PLATFORM_ADMIN, even with companies=[]', () => {
      httpGet.mockReturnValue(
        of({
          id: 'admin-1',
          name: 'Admin',
          email: 'admin@x.com',
          document: null,
          onboardingCompleted: false,
          systemRole: 'PLATFORM_ADMIN',
          companies: [],
        } as MeResponse),
      );

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      expect(store['systemRole']).toBe('PLATFORM_ADMIN');
      expect(store['onboardingCompleted']).toBe('true');
    });

    it('uses explicit hasCompletedOnboarding=true from /me even when companies=[]', () => {
      httpGet.mockReturnValue(
        of({
          ...buildMe([]),
          hasCompletedOnboarding: true,
        } as MeResponse),
      );

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      expect(store['onboardingCompleted']).toBe('true');
    });

    it('uses explicit hasCompletedOnboarding=false from /me even when companies has entries', () => {
      httpGet.mockReturnValue(
        of({
          ...buildMe([{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }]),
          hasCompletedOnboarding: false,
        } as MeResponse),
      );

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      expect(store['onboardingCompleted']).toBe('false');
    });

    it('falls back to companies-length derivation when hasCompletedOnboarding is missing (deploy skew)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      httpGet.mockReturnValue(
        of(buildMe([{ companyId: 'c-1', companyName: 'A', role: 'OWNER' }])),
      );

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      expect(store['onboardingCompleted']).toBe('true');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('PLATFORM_ADMIN bypass wins even when hasCompletedOnboarding=false and companies=[]', () => {
      httpGet.mockReturnValue(
        of({
          id: 'admin-1',
          name: 'Admin',
          email: 'admin@x.com',
          document: null,
          onboardingCompleted: false,
          hasCompletedOnboarding: false,
          systemRole: 'PLATFORM_ADMIN',
          companies: [],
        } as MeResponse),
      );

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      expect(store['onboardingCompleted']).toBe('true');
    });

    it('uses /me companies when non-empty (source of truth)', () => {
      service.applyFinishResponse({
        token: 't',
        companyId: 'c-1',
        companyName: 'Alpha',
        role: 'OWNER',
      });

      httpGet.mockReturnValue(
        of(
          buildMe([
            { companyId: 'c-1', companyName: 'Alpha', role: 'OWNER' },
            { companyId: 'c-2', companyName: 'Beta', role: 'MANAGER' },
          ]),
        ),
      );

      let emitted = false;
      service.hydrateSession().subscribe(() => (emitted = true));

      expect(emitted).toBe(true);
      const persisted = JSON.parse(store['userCompanies']);
      expect(persisted).toHaveLength(2);
      // OWNER-first default: still c-1
      expect(store['selectedCompanyId']).toBe('c-1');
    });
  });
});
