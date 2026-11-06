import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';

@Component({ template: '' })
class Stub {}

describe('AppShell — menu da administração em /admin/**', () => {
  async function renderAt(url: string) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [
        provideRouter([{ path: '**', component: Stub }]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: SessionService,
          useValue: {
            getItem: () => null,
            setItem: () => void 0,
            isOnboardingCompleted: () => true,
            isPlatformAdmin: () => true,
            getCompanyRoleFromToken: () => 'OWNER',
            getIdentityFromToken: () => ({ id: '1', name: 'Lorran Sarmento', email: null }),
          },
        },
        { provide: ImpersonationService, useValue: { active: signal(false) } },
        {
          provide: AdminCapabilitiesService,
          useValue: {
            can: () => true,
            capabilities: signal(new Set()),
            self: signal(null),
            ensureLoaded: () => of(null),
          },
        },
        {
          provide: BillingAccessService,
          useValue: { load: () => of(null), loaded: () => false, isBlocked: signal(false), status: signal(null), reason: signal<string | null>(null) },
        },
        {
          provide: NotificationFeedService,
          useValue: {
            items: signal([]),
            loading: signal(false),
            error: signal<string | null>(null),
            unreadCount: signal(0),
            list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 10, total: 0 })),
            markRead: vi.fn(),
            markAllRead: vi.fn(),
            refreshUnreadCount: vi.fn().mockReturnValue(of({ count: 0 })),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  for (const url of ['/admin', '/admin/users/42', '/admin/feedback', '/admin/blog/novo']) {
    it(`${url}: menu da administração, sem o menu de empresa`, async () => {
      const el = await renderAt(url);
      expect(el.querySelector('app-admin-sidebar')).not.toBeNull();
      // FIX-0864: a mesma `app-sidebar`, uma so, dentro do invólucro da administração.
      expect(el.querySelectorAll('app-sidebar').length).toBe(1);
      expect(el.querySelector('app-admin-sidebar app-sidebar')).not.toBeNull();
      expect(el.querySelector('a[aria-label="Voltar ao app"]')).not.toBeNull();
    });
  }

  it('fora de /admin continua o menu de empresa', async () => {
    const el = await renderAt('/dashboard');
    expect(el.querySelector('app-sidebar')).not.toBeNull();
    expect(el.querySelector('app-admin-sidebar')).toBeNull();
    expect(el.querySelector('a[aria-label="Voltar ao app"]')).toBeNull();
  });
});
