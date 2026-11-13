import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationBell } from './notification-bell';
import { BellPanel } from './bell-panel';
import { DUE_ALERTS_ROLES, NotificationBellStore } from './notification-bell.store';
import { openDueAlertsGuard } from './open-due-alerts.guard';
import { NotificationFeedService } from '../../services/notification-feed.service';
import { AlertsService } from '../../services/alerts.service';
import { AlertSettingsService } from '../../services/alert-settings.service';
import { ApiErrorService } from '../../services/api-error.service';
import { routes } from '../../app.routes';
import { isRoleGuard } from '../../services/role.guard';

/** JWT com o claim `role`, como o backend emite (o sino lê o papel do token). */
function signInAs(role: string): void {
  const b64 = btoa(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  sessionStorage.setItem('token', `header.${b64}.signature`);
}


/** O painel é baixado na primeira abertura (`import()`): clica no sino e espera ele aparecer. */
async function openPanel(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
  nativeElement: HTMLElement;
}): Promise<void> {
  fixture.nativeElement.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click();
  await waitFor(fixture, '[role="dialog"]');
}

/** Espera um seletor existir (chunks baixados com `import()`), sem relógio fixo. */
async function waitFor(
  fixture: { detectChanges(): void; whenStable(): Promise<unknown>; nativeElement: HTMLElement },
  selector: string,
): Promise<void> {
  fixture.detectChanges();
  for (let i = 0; i < 200 && !fixture.nativeElement.querySelector(selector); i++) {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 5));
    fixture.detectChanges();
  }
}

/**
 * Sino com duas abas (menu novo, prancha 3): dono e gerente veem Notificações e Vencimentos;
 * o motorista, que recebe 403 em `/v1/alerts/documents`, vê só Notificações, sem abas.
 */
describe('NotificationBell — abas Notificações e Vencimentos', () => {
  let listDocumentAlerts: ReturnType<typeof vi.fn>;

  function configure(): void {
    listDocumentAlerts = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    TestBed.configureTestingModule({
      imports: [NotificationBell],
      providers: [
        provideRouter([]),
        {
          provide: NotificationFeedService,
          useValue: {
            items: signal([]),
            loading: signal(false),
            error: signal<string | null>(null),
            unreadCount: signal(2),
            list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 10, total: 0 })),
            markRead: vi.fn().mockReturnValue(of(void 0)),
            markAllRead: vi.fn().mockReturnValue(of({ count: 0 })),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
        {
          provide: AlertsService,
          useValue: {
            documentAlerts: signal([]),
            page: signal(0),
            total: signal(0),
            loading: signal(false),
            error: signal<string | null>(null),
            listDocumentAlerts,
          },
        },
        {
          provide: AlertSettingsService,
          useValue: { settings: signal(null), load: vi.fn().mockReturnValue(of({ windows: [30] })) },
        },
        { provide: ApiErrorService, useValue: { claim: vi.fn() } },
      ],
    });
  }

  function render() {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const trigger = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  const tabs = (host: HTMLElement) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

  /** A aba Vencimentos é baixada com `import()`: espera a promessa e redesenha. */
  async function settle(fixture: {
    detectChanges(): void;
    whenStable(): Promise<unknown>;
    nativeElement: HTMLElement;
  }) {
    for (let i = 0; i < 100 && !fixture.nativeElement.querySelector('app-due-alerts-panel'); i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 10));
      fixture.detectChanges();
    }
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    configure();
  });
  afterEach(() => sessionStorage.clear());

  for (const role of ['OWNER', 'MANAGER'] as const) {
    it(`${role}: o painel tem as abas Notificações e Vencimentos, abrindo em Notificações`, async () => {
      signInAs(role);
      const { fixture, host } = render();
        await openPanel(fixture);

      expect(tabs(host).map((t) => t.textContent!.trim())).toEqual(['Notificações', 'Vencimentos']);
      expect(tabs(host)[0].getAttribute('aria-selected')).toBe('true');
      expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
        'Notificações e vencimentos',
      );
      expect(host.textContent).toContain('Marcar todas como lidas');
    });
  }

  it('DRIVER: só Notificações, sem abas (Vencimentos é da frota e 403 para ele)', async () => {
    signInAs('DRIVER');
    const { fixture, host } = render();
    await openPanel(fixture);

    expect(tabs(host)).toHaveLength(0);
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Notificações recentes',
    );
    expect(host.textContent).not.toContain('Vencimentos');
  });

  it('tocar em Vencimentos troca de aba e carrega os vencimentos sob demanda', async () => {
    signInAs('OWNER');
    const { fixture, host } = render();
    await openPanel(fixture);

    tabs(host)[1].click();
    fixture.detectChanges();
    expect(tabs(host)[1].getAttribute('aria-selected')).toBe('true');
    const panel = host.querySelector('[data-bell-due]')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(host.textContent).not.toContain('Marcar todas como lidas');

    await settle(fixture);
    expect(host.querySelector('app-due-alerts-panel')).not.toBeNull();
    expect(listDocumentAlerts).toHaveBeenCalled();
  });

  it('setas movem entre as abas', async () => {
    signInAs('MANAGER');
    const { fixture, host } = render();
    await openPanel(fixture);

    tabs(host)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(tabs(host)[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs(host)[1]);
  });

  it('aberto de fora (chip do Dashboard, link antigo) já entra na aba Vencimentos', async () => {
    signInAs('OWNER');
    const { fixture, host } = render();
    TestBed.inject(NotificationBellStore).openOn('vencimentos');
    await waitFor(fixture, '[role="dialog"]');

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(tabs(host)[1].getAttribute('aria-selected')).toBe('true');
    await settle(fixture);
    expect(host.querySelector('app-due-alerts-panel')).not.toBeNull();
  });

  it('se a aba Vencimentos não baixar, mostra o erro com "Tentar de novo" (nunca esqueleto eterno)', async () => {
    signInAs('OWNER');
    TestBed.inject(NotificationBellStore).selectTab('vencimentos');
    const fixture = TestBed.createComponent(BellPanel);
    const panel = fixture.componentInstance as unknown as {
      duePanel: { set(v: null): void };
      duePanelFailed: { set(v: boolean): void };
    };
    fixture.detectChanges();
    // Simula a falha do `import()` (arquivo trocado por um deploy): o estado é o que o
    // `catch` grava.
    panel.duePanel.set(null);
    panel.duePanelFailed.set(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const error = host.querySelector('[data-due-chunk-error]')!;
    expect(error.getAttribute('role')).toBe('alert');
    error.querySelector('button')!.click();
    await waitFor(fixture, 'app-due-alerts-panel');
    expect(host.querySelector('[data-due-chunk-error]')).toBeNull();
    expect(host.querySelector('app-due-alerts-panel')).not.toBeNull();
  });

  it('o contador é número em fundo tingido, sem bolinha vermelha', async () => {
    signInAs('OWNER');
    const { host } = render();
    const count = trigger(host).querySelector('[data-bell-count]')!;
    expect(count.textContent!.trim()).toBe('2');
    expect(count.className).toContain('bg-primary-500/15');
    expect(count.className).not.toContain('rounded-full');
    expect(trigger(host).innerHTML).not.toContain('bg-rose-600');
  });

  it('variant="bar" (barra de topo do celular) tira a caixa do gatilho', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.componentRef.setInput('variant', 'bar');
    fixture.detectChanges();
    const button = trigger(fixture.nativeElement as HTMLElement);
    expect(button.className).not.toContain('shadow-md');
    expect(button.className).not.toContain('border');
  });
});

@Component({ template: '' })
class Stub {}

describe('/alertas abre o sino na aba Vencimentos', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'dashboard', component: Stub }])],
    });
  });
  afterEach(() => sessionStorage.clear());

  const run = () =>
    TestBed.runInInjectionContext(() =>
      openDueAlertsGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;

  it('primeira carga (link de fora): cai no Dashboard com o sino aberto em Vencimentos', async () => {
    signInAs('OWNER');
    const result = run();
    expect(result instanceof UrlTree && result.toString()).toBe('/dashboard');
    const store = TestBed.inject(NotificationBellStore);
    expect(store.open()).toBe(true);
    expect(store.tab()).toBe('vencimentos');
  });

  it('dentro do app: a página atual fica e o sino abre por cima', async () => {
    signInAs('MANAGER');
    await TestBed.inject(Router).navigateByUrl('/dashboard');
    expect(run()).toBe(false);
    expect(TestBed.inject(NotificationBellStore).open()).toBe(true);
  });

  it('motorista: não abre o sino (o roleGuard da rota o manda embora)', async () => {
    signInAs('DRIVER');
    run();
    expect(TestBed.inject(NotificationBellStore).open()).toBe(false);
  });

  function findAlertas(list: readonly Route[]): Route | undefined {
    for (const route of list) {
      if (route.path === 'alertas') return route;
      const inner = findAlertas(route.children ?? []);
      if (inner) return inner;
    }
    return undefined;
  }

  it('a rota /alertas continua existindo (URL de sempre), com o roleGuard e este guard', async () => {
    const alertas = findAlertas(routes)!;
    expect(alertas).toBeDefined();
    expect(alertas.canActivate).toContain(openDueAlertsGuard);
    expect(alertas.canActivate!.filter(isRoleGuard)).toHaveLength(1);
    expect(alertas.loadComponent).toBeUndefined();
  });

  it('a aba Vencimentos é exatamente dos papéis que o roleGuard de /alertas deixa entrar', async () => {
    const guard = findAlertas(routes)!.canActivate!.find(isRoleGuard) as CanActivateFn;
    for (const role of ['OWNER', 'MANAGER', 'DRIVER']) {
      signInAs(role);
      const allowed =
        TestBed.runInInjectionContext(() =>
          guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
        ) === true;
      expect(allowed, role).toBe(DUE_ALERTS_ROLES.includes(role));
    }
  });
});
