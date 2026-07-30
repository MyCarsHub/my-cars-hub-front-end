import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutStore } from './layout.store';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';

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

    TestBed.configureTestingModule({
      providers: [
        LayoutStore,
        NotificationFeedService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: Router, useValue: { navigate } },
        { provide: HttpClient, useValue: { get: httpGet, patch: vi.fn() } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
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

  it('reselecionar a mesma empresa não descarta o cache', () => {
    feed.startPolling();
    feed.list().subscribe();
    const ticksBefore = unreadCountCalls();

    layout.selectTenant({ id: 'company-a', name: 'Alpha', role: 'OWNER', initial: 'A' });

    expect(unreadCountCalls()).toBe(ticksBefore);
    expect(feed.items()).toHaveLength(1);
  });
});
