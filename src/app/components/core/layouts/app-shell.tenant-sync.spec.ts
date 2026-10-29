import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AppShell } from './app-shell';
import { LayoutStore } from './layout.store';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';
import { ImpersonationService } from '../../../services/impersonation.service';

/**
 * The LayoutStore is a root singleton that used to read `userCompanies` ONCE, at construction.
 * The cookie banner lives in the root component and injects the store, so on a fresh tab the
 * store is built on the LOGIN page, with an empty session — and login does not reload the
 * page. The sidebar then said "Sem Empresa" for someone who owns companies, until a reload.
 *
 * These specs build the store BEFORE the session exists (what the banner does at boot), write
 * the session the way `AuthService.writeSession` does, and only then mount the shell.
 */
describe('AppShell — sidebar company after a login without reload', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => storage[key] ?? null,
            setItem: (key: string, value: string) => {
              storage[key] = value;
            },
            removeItem: (key: string) => {
              delete storage[key];
            },
            isOnboardingCompleted: () => false,
            isPlatformAdmin: () => false,
            getCompanyRoleFromToken: () => null,
          },
        },
        { provide: ImpersonationService, useValue: { active: signal(false) } },
        {
          provide: BillingAccessService,
          useValue: {
            load: () => of(null),
            isBlocked: signal(false),
            status: signal(null),
            reason: signal<string | null>(null),
          },
        },
        {
          provide: NotificationFeedService,
          useValue: {
            items: signal([]),
            loading: signal(false),
            error: signal<string | null>(null),
            unreadCount: signal(0),
            list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 10, total: 0 })),
            markRead: vi.fn().mockReturnValue(of(void 0)),
            markAllRead: vi.fn().mockReturnValue(of({ count: 0 })),
            refreshUnreadCount: vi.fn().mockReturnValue(of({ count: 0 })),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
      ],
    });
  });

  function login(companies: { companyId: string; companyName: string; role: string }[], selected?: string): void {
    storage['userCompanies'] = JSON.stringify(companies);
    if (selected) storage['selectedCompanyId'] = selected;
  }

  function mountShell(): HTMLElement {
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function sidebarText(host: HTMLElement): string {
    return host.querySelector('app-sidebar')?.textContent ?? '';
  }

  it('store built on the login page: the shell shows the selected company, not "Sem Empresa"', () => {
    const store = TestBed.inject(LayoutStore); // the cookie banner, at boot
    expect(store.selectedTenant().name).toBe('Sem Empresa');

    login(
      [
        { companyId: 'c-drv', companyName: 'Frota Alheia', role: 'DRIVER' },
        { companyId: 'c-own', companyName: 'Mycarshub', role: 'OWNER' },
        { companyId: 'c-tst', companyName: 'Teste', role: 'OWNER' },
      ],
      'c-own',
    );
    const host = mountShell();

    expect(store.selectedTenant().name).toBe('Mycarshub');
    expect(store.currentCompanyId()).toBe('c-own');
    expect(sidebarText(host)).toContain('Mycarshub');
    expect(sidebarText(host)).not.toContain('Sem Empresa');
  });

  it('the switcher list is the logged-in user companies, so switching still works', () => {
    const store = TestBed.inject(LayoutStore);
    login(
      [
        { companyId: 'c-own', companyName: 'Mycarshub', role: 'OWNER' },
        { companyId: 'c-tst', companyName: 'Teste', role: 'OWNER' },
      ],
      'c-own',
    );
    mountShell();

    expect(store.tenants().map((t) => t.id)).toEqual(['c-own', 'c-tst']);
    expect(store.showSwitcher()).toBe(true);
  });

  it('logout then login as someone else: the previous user company does not survive', () => {
    login([{ companyId: 'c-old', companyName: 'Empresa Anterior', role: 'OWNER' }], 'c-old');
    const store = TestBed.inject(LayoutStore);
    expect(store.selectedTenant().name).toBe('Empresa Anterior');

    storage = {};
    login([{ companyId: 'c-new', companyName: 'Empresa Nova', role: 'MANAGER' }], 'c-new');
    const host = mountShell();

    expect(store.selectedTenant().name).toBe('Empresa Nova');
    expect(sidebarText(host)).not.toContain('Empresa Anterior');
  });

  it('admin with no company at all: "Sem Empresa" is still the honest answer', () => {
    const store = TestBed.inject(LayoutStore);
    login([]);
    const host = mountShell();

    expect(store.selectedTenant().name).toBe('Sem Empresa');
    expect(sidebarText(host)).toContain('Sem Empresa');
  });
});
