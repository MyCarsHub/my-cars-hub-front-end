import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
            // FIX-0456 — a barra lateral renderiza dentro do shell e decide o
            // menu pelo papel do TOKEN. Sem esta entrada o stub quebra com
            // TypeError, e o teste do sino morreria por um motivo que não é o
            // dele. `null` = sem papel, que é o menu mínimo.
            getCompanyRoleFromToken: () => null,
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

/**
 * O paywall do shell: o MESMO bloqueio é mostrado a todos, mas só o dono tem o que fazer a
 * respeito. O papel vem do TOKEN (`getCompanyRoleFromToken`), a fonte do `roleGuard` e do
 * `billingAccessGuard`, então a tela nunca manda para `/billing` quem esses guards recusam.
 */
describe('AppShell — paywall por papel', () => {
  function configure(role: string | null, blocked = true): void {
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
            isOnboardingCompleted: () => true,
            isPlatformAdmin: () => false,
            getCompanyRoleFromToken: () => role,
          },
        },
        { provide: ImpersonationService, useValue: { active: signal(false) } },
        {
          provide: BillingAccessService,
          useValue: {
            load: () => of(null),
            isBlocked: signal(blocked),
            reason: signal<string | null>('TRIAL_EXPIRED'),
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
  }

  function render() {
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    return fixture;
  }

  const dialog = (el: HTMLElement): HTMLElement | null =>
    el.querySelector<HTMLElement>('app-paywall-dialog [role="dialog"]');
  const cta = (el: HTMLElement): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-paywall-cta]');

  beforeEach(() => TestBed.resetTestingModule());

  it('dono: ve "Ver planos" e o CTA leva ao billing com o motivo', () => {
    configure('OWNER');
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(el.querySelector('#paywall-title')?.textContent).toContain(
      'Seu período de teste terminou',
    );
    expect(cta(el)?.textContent).toContain('Ver planos');
    cta(el)?.click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/billing'], {
      queryParams: { reason: 'TRIAL_EXPIRED' },
    });
  });

  it.each(['MANAGER', 'DRIVER', null])(
    'papel %s: o dialogo diz que so o dono regulariza, sem "Ver planos" e sem ir ao billing',
    (role) => {
      configure(role);
      const fixture = render();
      const el = fixture.nativeElement as HTMLElement;
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      expect(dialog(el)).not.toBeNull();
      expect(el.querySelector('#paywall-title')?.textContent).toContain(
        'Esta empresa está sem plano ativo',
      );
      expect(el.querySelector('#paywall-body')?.textContent).toContain(
        'Só o dono da empresa pode regularizar o plano.',
      );
      expect(dialog(el)?.textContent).not.toContain('Ver planos');

      // The one button only closes the dialog; it navigates nowhere.
      cta(el)?.click();
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled();
      expect(dialog(el)).toBeNull();
    },
  );

  it('sem bloqueio nenhum papel ve o dialogo', () => {
    configure('MANAGER', false);
    const fixture = render();
    expect(dialog(fixture.nativeElement as HTMLElement)).toBeNull();
  });
});
