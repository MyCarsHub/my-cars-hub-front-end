import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AppShell } from './app-shell';
import { BillingAccessService } from '../../../services/billing-access.service';
import { SessionService } from '../../../services/session.service';
import { NotificationFeedService } from '../../../services/notification-feed.service';
import { ImpersonationService } from '../../../services/impersonation.service';

/**
 * Cobre o gate do sino no shell: em `/onboarding` (ou com o onboarding ainda
 * incompleto) o sino não monta e o polling do contador nem começa.
 */
describe('AppShell — gate do sino de notificações', () => {
  let startPolling: ReturnType<typeof vi.fn>;

  function configure(onboardingCompleted: boolean): void {
    startPolling = vi.fn();

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
          },
        },
        {
          provide: ImpersonationService,
          useValue: { active: signal(false) },
        },
        {
          provide: BillingAccessService,
          useValue: {
            load: () => of(null),
            isBlocked: signal(false),
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
            startPolling,
            stopPolling: vi.fn(),
          },
        },
      ],
    });
  }

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('não monta o sino nem inicia o polling com o onboarding incompleto', () => {
    configure(false);
    const host = render();

    expect(host.querySelector('app-notification-bell')).toBeNull();
    expect(startPolling).not.toHaveBeenCalled();
  });

  it('monta o sino dentro de um <header> depois do onboarding concluído', () => {
    configure(true);
    const host = render();

    const header = host.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.querySelector('app-notification-bell')).not.toBeNull();
    expect(startPolling).toHaveBeenCalled();
  });
});
