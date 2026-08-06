import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutStore } from './layout.store';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';
import { NotificationService } from '../../../services/notification.service';
import { IMPERSONATION_STATE_KEY } from '../../../services/impersonation.context';
import { environment } from '../../../../environments/environment';

/**
 * CRÍTICO: a troca de empresa só navega para `/dashboard` — o AppShell (e o
 * sino dentro dele) NÃO é destruído, e `startPolling` é idempotente. Sem o
 * `syncTenant()` o contador e os títulos da empresa A sobreviveriam sob a
 * empresa B por até 60s.
 */
describe('LayoutStore — troca de tenant', () => {
  const companies = [
    { companyId: 'company-a', companyName: 'Alpha', role: 'OWNER' },
    { companyId: 'company-b', companyName: 'Beta', role: 'MANAGER' },
  ];

  let store: Record<string, string>;
  let httpGet: ReturnType<typeof vi.fn>;
  let httpPost: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let unreadCountResponse: number;
  let layout: LayoutStore;
  let feed: NotificationFeedService;

  function unreadCountCalls(): number {
    return httpGet.mock.calls.filter((c) => String(c[0]).endsWith('/unread-count')).length;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();

    unreadCountResponse = 7;
    store = {
      token: 'jwt',
      userCompanies: JSON.stringify(companies),
      selectedCompanyId: 'company-a',
    };
    navigate = vi.fn();
    httpGet = vi.fn((url: string) =>
      String(url).endsWith('/unread-count')
        ? of({ count: unreadCountResponse })
        : of({
            content: [{ id: 'n-1', title: 'IPVA do ABC1D23 vence' }],
            page: 0,
            size: 10,
            total: 1,
          }),
    );
    httpPost = vi.fn(() => of({ token: 'jwt-da-company-b' }));

    TestBed.configureTestingModule({
      providers: [
        LayoutStore,
        NotificationFeedService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: Router, useValue: { navigate } },
        { provide: HttpClient, useValue: { get: httpGet, post: httpPost, patch: vi.fn() } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            setToken: (token: string) => {
              store['token'] = token;
            },
            getToken: () => store['token'] ?? null,
          },
        },
      ],
    });

    layout = TestBed.inject(LayoutStore);
    feed = TestBed.inject(NotificationFeedService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('zera o contador da empresa anterior e refaz o fetch na hora', () => {
    feed.startPolling();
    feed.list().subscribe();
    expect(feed.unreadCount()).toBe(7);
    expect(feed.items()).toHaveLength(1);
    const ticksBefore = unreadCountCalls();

    unreadCountResponse = 2;
    layout.selectTenant({ id: 'company-b', name: 'Beta', role: 'MANAGER', initial: 'B' });

    // Refetch imediato — nada de esperar os 60s do próximo poll.
    expect(unreadCountCalls()).toBe(ticksBefore + 1);
    expect(feed.items()).toEqual([]);
    expect(feed.unreadCount()).toBe(2);
  });

  it('persiste a seleção e navega para o dashboard', () => {
    layout.selectTenant({ id: 'company-b', name: 'Beta', role: 'MANAGER', initial: 'B' });

    expect(store['selectedCompanyId']).toBe('company-b');
    expect(store['selectedCompanyName']).toBe('Beta');
    expect(store['selectedRole']).toBe('MANAGER');
    expect(layout.selectedTenant().id).toBe('company-b');
    expect(layout.isTenantOpen()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  /**
   * O backend resolve o tenant pelo claim do TOKEN, não pelo `selectedCompanyId` do
   * armazenamento. Gravar a escolha e navegar sem pedir `/auth/select-company/{id}`
   * deixava a barra lateral anunciando a empresa B enquanto TODA chamada seguinte
   * respondia dados da empresa A.
   */
  it('pede o token da nova empresa e só navega depois de persistir', () => {
    let tokenAoNavegar: string | undefined;
    navigate.mockImplementation(() => {
      tokenAoNavegar = store['token'];
    });

    layout.selectTenant({ id: 'company-b', name: 'Beta', role: 'MANAGER', initial: 'B' });

    expect(httpPost).toHaveBeenCalledWith(
      `${environment.apiUrl}/auth/select-company/company-b`,
      {},
    );
    expect(store['token']).toBe('jwt-da-company-b');
    expect(tokenAoNavegar).toBe('jwt-da-company-b');
  });

  it('troca recusada não muda o estado local, não navega e avisa quem clicou', () => {
    httpPost.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const toasts = TestBed.inject(NotificationService);
    layout.toggleTenant();

    layout.selectTenant({ id: 'company-b', name: 'Beta', role: 'MANAGER', initial: 'B' });

    expect(store['token']).toBe('jwt');
    expect(store['selectedCompanyId']).toBe('company-a');
    expect(store['selectedCompanyName']).toBeUndefined();
    expect(store['selectedRole']).toBeUndefined();
    expect(layout.selectedTenant().id).toBe('company-a');
    expect(navigate).not.toHaveBeenCalled();
    // O seletor continua aberto: a troca não aconteceu, então tentar de novo é um clique.
    expect(layout.isTenantOpen()).toBe(true);
    expect(layout.switchingTenantId()).toBeNull();
    expect(toasts.notifications().some((n) => n.kind === 'error')).toBe(true);
  });

  it('um segundo clique enquanto a troca está em voo não dispara outra chamada', () => {
    let emit: ((value: { token: string }) => void) | null = null;
    httpPost.mockReturnValue(
      new Observable<{ token: string }>((subscriber) => {
        emit = (value) => {
          subscriber.next(value);
          subscriber.complete();
        };
      }),
    );

    const beta = { id: 'company-b', name: 'Beta', role: 'MANAGER', initial: 'B' };
    layout.selectTenant(beta);
    layout.selectTenant(beta);

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(layout.switchingTenantId()).toBe('company-b');

    emit!({ token: 'jwt-da-company-b' });

    expect(layout.switchingTenantId()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('reselecionar a mesma empresa não descarta o cache', () => {
    feed.startPolling();
    feed.list().subscribe();
    const ticksBefore = unreadCountCalls();

    layout.selectTenant({ id: 'company-a', name: 'Alpha', role: 'OWNER', initial: 'A' });

    expect(unreadCountCalls()).toBe(ticksBefore);
    expect(feed.items()).toHaveLength(1);
  });
});

/**
 * O store é singleton de raiz e lê `userCompanies` UMA vez, na construção.
 * Como o shell do admin já está montado quando a impersonação começa, sem uma
 * releitura explícita a barra lateral seguiria oferecendo as empresas dele — e
 * um clique gravaria id/nome/papel de OUTRA empresa por cima da sessão ativa,
 * deixando o banner afirmando uma empresa e o resto da interface outra.
 */
describe('LayoutStore durante uma sessão de impersonação', () => {
  const adminCompanies = [
    { companyId: 'admin-co', companyName: 'Empresa do admin', role: 'OWNER' },
    { companyId: 'admin-co-2', companyName: 'Outra do admin', role: 'MANAGER' },
  ];

  let store: Record<string, string>;
  let navigate: ReturnType<typeof vi.fn>;
  let httpPost: ReturnType<typeof vi.fn>;
  let layout: LayoutStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    store = {
      token: 'jwt',
      userCompanies: JSON.stringify(adminCompanies),
      selectedCompanyId: 'admin-co',
    };
    navigate = vi.fn();
    httpPost = vi.fn(() => of({ token: 'jwt-da-admin-co-2' }));

    TestBed.configureTestingModule({
      providers: [
        LayoutStore,
        NotificationFeedService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: Router, useValue: { navigate } },
        {
          provide: HttpClient,
          useValue: { get: vi.fn(() => of({ count: 0 })), post: httpPost, patch: vi.fn() },
        },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            setToken: (token: string) => {
              store['token'] = token;
            },
            getToken: () => store['token'] ?? null,
          },
        },
      ],
    });

    layout = TestBed.inject(LayoutStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('refreshTenants() troca a lista pelas empresas observadas', () => {
    expect(layout.tenants()).toHaveLength(2);

    // É o que `ImpersonationService.begin()` grava.
    store['userCompanies'] = JSON.stringify([
      { companyId: 'co-1', companyName: 'Locadora Alfa', role: 'OWNER' },
    ]);
    store['selectedCompanyId'] = 'co-1';
    store[IMPERSONATION_STATE_KEY] = JSON.stringify({ sessionId: 's1', companyId: 'co-1' });

    layout.refreshTenants();

    expect(layout.tenants()).toHaveLength(1);
    expect(layout.tenants()[0].id).toBe('co-1');
    expect(layout.selectedTenant().id).toBe('co-1');
  });

  it('um clique numa empresa do admin NÃO sobrescreve a sessão de impersonação', () => {
    store[IMPERSONATION_STATE_KEY] = JSON.stringify({ sessionId: 's1', companyId: 'co-1' });
    store['selectedCompanyId'] = 'co-1';
    store['selectedCompanyName'] = 'Locadora Alfa';
    store['selectedRole'] = 'OWNER';
    layout.toggleTenant();

    layout.selectTenant({ id: 'admin-co-2', name: 'Outra do admin', role: 'MANAGER', initial: 'O' });

    expect(store['selectedCompanyId']).toBe('co-1');
    expect(store['selectedCompanyName']).toBe('Locadora Alfa');
    expect(store['selectedRole']).toBe('OWNER');
    expect(navigate).not.toHaveBeenCalled();
    // Nem chega no servidor: o `impersonationInterceptor` barra `/auth/select-company`
    // de propósito, e a saída antecipada evita até a tentativa.
    expect(httpPost).not.toHaveBeenCalled();
    // Ainda assim o seletor fecha — nada de dropdown preso aberto.
    expect(layout.isTenantOpen()).toBe(false);
  });

  it('sem sessão de impersonação a troca de empresa continua normal', () => {
    layout.selectTenant({ id: 'admin-co-2', name: 'Outra do admin', role: 'MANAGER', initial: 'O' });

    expect(store['selectedCompanyId']).toBe('admin-co-2');
    expect(store['token']).toBe('jwt-da-admin-co-2');
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
