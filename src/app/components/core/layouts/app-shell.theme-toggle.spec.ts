import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';

import { AppShell } from './app-shell';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';
import { ImpersonationService } from '../../../services/impersonation.service';

/**
 * O botão de tema mora no header do shell, ao lado do sino, e aparece SEMPRE: para os três
 * papéis, no celular e no desktop, e até no onboarding (quando o sino ainda não monta).
 */
describe('AppShell — botão de tema ao lado do sino', () => {
  function render(role: 'OWNER' | 'MANAGER' | 'DRIVER', onboardingCompleted = true, width = 1280) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: SessionService,
          useValue: {
            getItem: () => null,
            setItem: () => void 0,
            isOnboardingCompleted: () => onboardingCompleted,
            isPlatformAdmin: () => false,
            getCompanyRoleFromToken: () => role,
          },
        },
        { provide: ImpersonationService, useValue: { active: signal(false) } },
        {
          provide: BillingAccessService,
          useValue: { load: () => of(null), isBlocked: signal(false), status: signal(null), reason: signal<string | null>(null) },
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
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  for (const role of ['OWNER', 'MANAGER', 'DRIVER'] as const) {
    for (const width of [375, 1280]) {
      it(`${role} a ${width}px: botão de tema no header, ao lado do sino`, () => {
        const host = render(role, true, width);
        const row = host.querySelector('header [data-bell-row]');
        const toggle = row?.querySelector('[data-theme-toggle]');
        const bell = row?.querySelector('app-notification-bell');
        expect(toggle).not.toBeNull();
        expect(bell).not.toBeNull();
        // Mesmo grupo, tema antes do sino.
        const toggleHost = toggle!.closest('app-theme-toggle')!;
        expect(toggleHost.parentElement).toBe(bell!.parentElement);
        expect(toggleHost.compareDocumentPosition(bell!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
    }
  }

  it('no onboarding (sem sino) o botão de tema continua lá', () => {
    const host = render('OWNER', false);
    expect(host.querySelector('app-notification-bell')).toBeNull();
    expect(host.querySelector('header [data-theme-toggle]')).not.toBeNull();
  });
});
