import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { NotificationFeedService } from './notification-feed.service';
import { InsurancesService } from './insurances.service';
import { AlertsService } from './alerts.service';
import { LoggerService } from './logger.service';
import { ImpersonationService } from './impersonation.service';
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
    setTourSeen: ReturnType<typeof vi.fn>;
    getToken: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
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
      setTourSeen: vi.fn((seen: boolean) => {
        store['tourSeen'] = seen ? 'true' : 'false';
      }),
      getToken: vi.fn(() => store['token'] ?? null),
      clear: vi.fn(() => {
        store = {};
      }),
    };
    httpGet = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        // Serviços de cache reais (com HttpClient mockado) para que o teste de
        // logout prove o estado final dos signals, não só as chamadas.
        NotificationFeedService,
        InsurancesService,
        AlertsService,
        { provide: SessionService, useValue: sessionMock },
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn(), patch: vi.fn() } },
        { provide: ImpersonationService, useValue: { reset: vi.fn() } },
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

  /**
   * O flag do TOUR guiado (`tourSeen`) — não confundir com `onboardingCompleted`,
   * que é o wizard obrigatório de cadastro. O caso que importa é o deploy skew:
   * enquanto `/auth/me` não devolver `hasSeenTour`, uma re-hidratação de sessão
   * não pode apagar o `true` que o próprio tour gravou ao ser concluído.
   */
  describe('writeSession — flag do tour guiado', () => {
    function buildMe(extra: Partial<MeResponse> = {}): MeResponse {
      return {
        id: 'u-1',
        name: 'Lorran',
        email: 'l@x.com',
        document: null,
        onboardingCompleted: true,
        systemRole: 'USER',
        companies: [{ companyId: 'c-1', companyName: 'Alpha', role: 'OWNER' }],
        ...extra,
      };
    }

    it('usa o valor do backend quando ele opina', () => {
      httpGet.mockReturnValue(of(buildMe({ hasSeenTour: true })));
      service.hydrateSession().subscribe();
      expect(store['tourSeen']).toBe('true');
    });

    it('trata a ausência do campo como "ainda não viu" numa sessão nova', () => {
      httpGet.mockReturnValue(of(buildMe()));
      service.hydrateSession().subscribe();
      expect(store['tourSeen']).toBe('false');
    });

    it('NÃO apaga o "já viu" da sessão quando o backend ainda não envia o campo', () => {
      store['tourSeen'] = 'true';
      httpGet.mockReturnValue(of(buildMe()));

      service.hydrateSession().subscribe();

      expect(store['tourSeen']).toBe('true');
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
      // Deploy skew is a degradation, not a failure — it must be recorded as
      // a warning through LoggerService, not as an error.
      const warnSpy = vi.spyOn(TestBed.inject(LoggerService), 'warn').mockImplementation(() => {});
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

  /**
   * CRÍTICO: `logout()` não recarrega a página, então os serviços root
   * sobrevivem na mesma aba. Sem os `reset()` o próximo usuário a logar veria
   * o cache do anterior (títulos de notificação carregam placa/nome) antes do
   * primeiro fetch voltar, e o polling do sino continuaria rodando.
   */
  describe('logout limpa os caches root', () => {
    let feed: NotificationFeedService;
    let insurances: InsurancesService;
    let alerts: AlertsService;

    beforeEach(() => {
      vi.useFakeTimers();
      feed = TestBed.inject(NotificationFeedService);
      insurances = TestBed.inject(InsurancesService);
      alerts = TestBed.inject(AlertsService);

      store['token'] = 'jwt-user-a';
      store['selectedCompanyId'] = 'company-a';

      httpGet.mockImplementation((url: string) => {
        const target = String(url);
        if (target.endsWith('/unread-count')) return of({ count: 4 });
        if (target.includes('/alerts/documents')) {
          return of({ content: [{ title: 'CNH vence' }], page: 0, size: 20, total: 1 });
        }
        if (target.includes('/insurances')) {
          return of({ content: [{ id: 'i-1', plate: 'ABC1D23' }], page: 0, size: 20, total: 1 });
        }
        return of({
          content: [{ id: 'n-1', title: 'IPVA do ABC1D23 vence' }],
          page: 0,
          size: 10,
          total: 1,
        });
      });

      feed.list().subscribe();
      feed.startPolling();
      insurances.list().subscribe();
      alerts.listDocumentAlerts().subscribe();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('zera os signals dos três serviços e limpa a sessão', () => {
      expect(feed.items()).toHaveLength(1);
      expect(feed.unreadCount()).toBe(4);
      expect(insurances.insurances()).toHaveLength(1);
      expect(alerts.documentAlerts()).toHaveLength(1);

      service.logout();

      expect(sessionMock.clear).toHaveBeenCalledTimes(1);
      expect(feed.items()).toEqual([]);
      expect(feed.unreadCount()).toBe(0);
      expect(feed.total()).toBe(0);
      expect(insurances.insurances()).toEqual([]);
      expect(insurances.total()).toBe(0);
      expect(alerts.documentAlerts()).toEqual([]);
    });

    it('derruba a sessão de impersonação junto — o banner não pode sobreviver ao logout', () => {
      service.logout();

      const impersonation = TestBed.inject(ImpersonationService) as unknown as {
        reset: ReturnType<typeof vi.fn>;
      };
      expect(impersonation.reset).toHaveBeenCalledTimes(1);
    });

    it('para o polling do contador — nenhum tick depois do logout', () => {
      const unreadCalls = () =>
        httpGet.mock.calls.filter((c) => String(c[0]).endsWith('/unread-count')).length;
      const before = unreadCalls();
      expect(before).toBeGreaterThan(0);

      service.logout();
      vi.advanceTimersByTime(300_000);

      expect(unreadCalls()).toBe(before);
      expect(feed.unreadCount()).toBe(0);
    });
  });
});
