import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, Routes, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Sidebar } from './sidebar';
import { LayoutStore } from '../core/layouts/layout.store';
import { MembershipsService } from '../../services/memberships.service';
import { InviteOnboardingTokenStore } from '../../services/invite-onboarding-token.store';
import { SessionService } from '../../services/session.service';
import { Membership } from '../../types/membership.type';
import { environment } from '../../../environments/environment';

/**
 * The company switcher, end to end on the real DOM: real `Sidebar`, real `LayoutStore`,
 * real `MembershipsService` / `CompanySelectionService` / `SessionService`, a real router
 * with stub pages, and only the network replaced (HttpTestingController).
 */
@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class StubPage {}

const ROUTES: Routes = [
  { path: 'dashboard', component: StubPage },
  { path: 'alugueis', component: StubPage },
  { path: 'trocando-empresa', component: StubPage },
  { path: 'convite/cadastro', component: StubPage },
];

function fakeJwt(role: string, companyId: string): string {
  const payload = { role, companyId, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${b64}.signature`;
}

const alfa: Membership = {
  companyId: 'co-alfa',
  companyName: 'Locadora Alfa',
  role: 'OWNER',
  roleLabel: 'Dono',
  status: 'ACTIVE',
  lastSelectedAt: '2026-10-01T10:00:00Z',
  needsOnboarding: false,
};
const beta: Membership = {
  companyId: 'co-beta',
  companyName: 'Locadora Beta',
  role: 'MANAGER',
  roleLabel: 'Gerenciador',
  status: 'ACTIVE',
  lastSelectedAt: null,
  needsOnboarding: false,
};
const gama: Membership = {
  companyId: 'co-gama',
  companyName: 'Gama Rent a Car',
  role: 'DRIVER',
  roleLabel: 'Motorista',
  status: 'ONBOARDING',
  lastSelectedAt: null,
  needsOnboarding: true,
};
const delta: Membership = {
  companyId: 'co-delta',
  companyName: 'Delta Veiculos',
  role: 'DRIVER',
  roleLabel: 'Motorista',
  status: 'ACTIVE',
  lastSelectedAt: null,
  needsOnboarding: false,
};

describe('Company switcher', () => {
  let fixture: ComponentFixture<Sidebar>;
  let layout: LayoutStore;
  let http: HttpTestingController;
  let router: Router;
  const host = () => fixture.nativeElement as HTMLElement;
  const membershipsUrl = `${environment.apiUrl}/auth/memberships`;

  function startAs(companyId: string, role: string, companies: Membership[]): void {
    sessionStorage.clear();
    sessionStorage.setItem('token', fakeJwt(role, companyId));
    sessionStorage.setItem('selectedCompanyId', companyId);
    sessionStorage.setItem('selectedCompanyName', 'x');
    sessionStorage.setItem('selectedRole', role);
    sessionStorage.setItem(
      'userCompanies',
      JSON.stringify(
        companies
          .filter((c) => c.status === 'ACTIVE')
          .map((c) => ({ companyId: c.companyId, companyName: c.companyName, role: c.role })),
      ),
    );
  }

  async function mount(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideRouter(ROUTES),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Sidebar);
    layout = TestBed.inject(LayoutStore);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  }

  function answerMemberships(
    memberships: Membership[],
    pendingInvites: { companyName: string; roleLabel: string }[] = [],
  ): void {
    http.expectOne(membershipsUrl).flush({ memberships, pendingInvites, defaultCompanyId: null });
    fixture.detectChanges();
  }

  /** The switch also restarts the notification bell and re-reads /auth/me (best effort). */
  function settleBackground(): void {
    http
      .match((r) => r.url.endsWith('/auth/me'))
      .forEach((r) => r.flush({ companies: [] }));
    http
      .match((r) => r.url.includes('/notifications'))
      .forEach((r) => r.flush({ count: 0, content: [], page: 0, size: 10, total: 0 }));
  }

  function openSwitcher(): void {
    layout.toggleTenant();
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => {
    http?.verify();
    sessionStorage.clear();
  });

  it('is hidden with one membership and no invites: the header is not a button', async () => {
    startAs('co-alfa', 'OWNER', [alfa]);
    await mount();
    layout.ensureMembershipsLoaded();
    answerMemberships([alfa]);

    expect(host().querySelector('[aria-haspopup="dialog"]')).toBeNull();
    expect(host().textContent).toContain('Locadora Alfa');
    expect(host().textContent).not.toContain('Suas empresas');
  });

  it('is shown with two or more memberships and lists name plus role label', async () => {
    startAs('co-alfa', 'OWNER', [alfa, beta]);
    await mount();
    expect(host().querySelector('[aria-haspopup="dialog"]')).not.toBeNull();

    openSwitcher();
    answerMemberships([alfa, beta]);

    const rows = Array.from(host().querySelectorAll('[data-testid="switcher-active"]'));
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Locadora Alfa'),
      expect.stringContaining('Locadora Beta'),
    ]);
    expect(rows[0].textContent).toContain('Dono');
    expect(rows[1].textContent).toContain('Gerenciador');
    expect(host().textContent).toContain('Suas empresas');
  });

  it('marks the current company from the SESSION, not from the position in the list', async () => {
    // The session is in Beta, but the backend lists Alfa first.
    startAs('co-beta', 'MANAGER', [alfa, beta]);
    await mount();
    openSwitcher();
    answerMemberships([alfa, beta]);

    const rows = Array.from(host().querySelectorAll('[data-testid="switcher-active"]'));
    expect(rows[0].getAttribute('aria-selected')).toBe('false');
    expect(rows[0].querySelector('[data-testid="current-check"]')).toBeNull();
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].querySelector('[data-testid="current-check"]')).not.toBeNull();
    expect(rows[1].textContent).toContain('Empresa atual');
  });

  it('shows the switcher for a single company when an invite is pending, with text and no action', async () => {
    startAs('co-alfa', 'OWNER', [alfa]);
    await mount();
    layout.ensureMembershipsLoaded();
    answerMemberships([alfa], [{ companyName: 'Delta Veiculos', roleLabel: 'Gerenciador' }]);

    expect(host().querySelector('[aria-haspopup="dialog"]')).not.toBeNull();
    openSwitcher();
    http.expectOne(membershipsUrl).flush({
      memberships: [alfa],
      pendingInvites: [{ companyName: 'Delta Veiculos', roleLabel: 'Gerenciador' }],
      defaultCompanyId: null,
    });
    fixture.detectChanges();

    const invite = host().querySelector('[data-testid="switcher-invite"]');
    expect(invite?.textContent).toContain('Delta Veiculos');
    expect(invite?.textContent).toContain('Gerenciador');
    expect(host().textContent).toContain('Convites para você');
    expect(host().textContent).toContain('Abra o link do convite no seu e-mail para aceitar.');
    expect(invite?.querySelector('button, a')).toBeNull();
  });

  it('an ONBOARDING membership shows "Concluir cadastro"; its token goes to its own slot, not the session', async () => {
    startAs('co-alfa', 'OWNER', [alfa]);
    const sessionTokenBefore = sessionStorage.getItem('token');
    await mount();
    openSwitcher();
    answerMemberships([alfa, gama]);

    const chip = Array.from(host().querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Concluir cadastro'),
    );
    expect(chip).toBeDefined();
    chip!.click();

    const req = http.expectOne(`${environment.apiUrl}/auth/select-company/co-gama`);
    req.flush({
      message: 'ok',
      token: 'onboarding-token',
      kind: 'INVITE_ONBOARDING',
      companyId: 'co-gama',
      role: 'DRIVER',
      next: 'DRIVER_ONBOARDING',
    });
    await fixture.whenStable();

    expect(TestBed.inject(InviteOnboardingTokenStore).get()).toBe('onboarding-token');
    expect(sessionStorage.getItem('token')).toBe(sessionTokenBefore);
    expect(router.url).toBe('/convite/cadastro');
  });

  it('MANAGER_ONBOARDING also lands on /convite/cadastro', async () => {
    const managerPending: Membership = { ...gama, role: 'MANAGER', roleLabel: 'Gerenciador' };
    startAs('co-alfa', 'OWNER', [alfa]);
    await mount();
    openSwitcher();
    answerMemberships([alfa, managerPending]);

    Array.from(host().querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Concluir cadastro'))!
      .click();
    http.expectOne(`${environment.apiUrl}/auth/select-company/co-gama`).flush({
      token: 'onb',
      kind: 'INVITE_ONBOARDING',
      next: 'MANAGER_ONBOARDING',
    });
    await fixture.whenStable();

    expect(router.url).toBe('/convite/cadastro');
    expect(TestBed.inject(InviteOnboardingTokenStore).get()).toBe('onb');
  });

  it('switching swaps the session token, clears the previous company state and goes to the dashboard', async () => {
    startAs('co-alfa', 'OWNER', [alfa, beta]);
    await mount();
    sessionStorage.setItem('inviteOnboardingToken', 'stale-onboarding-token-must-stay-untouched');
    openSwitcher();
    answerMemberships([alfa, beta]);

    const resets: string[] = [];
    // Real registry: a cache registers itself exactly like production caches do.
    const { TenantResetRegistry } = await import('../../services/tenant-reset.registry');
    TestBed.inject(TenantResetRegistry).register(() => resets.push('cache-cleared'));

    (host().querySelectorAll('[data-testid="switcher-active"]')[1] as HTMLButtonElement).click();
    const newToken = fakeJwt('MANAGER', 'co-beta');
    http
      .expectOne(`${environment.apiUrl}/auth/select-company/co-beta`)
      .flush({ token: newToken, kind: 'ACCESS', role: 'MANAGER' });
    await fixture.whenStable();
    fixture.detectChanges();
    settleBackground();

    expect(TestBed.inject(SessionService).getToken()).toBe(newToken);
    expect(resets).toEqual(['cache-cleared']);
    expect(sessionStorage.getItem('selectedCompanyId')).toBe('co-beta');
    expect(layout.currentCompanyId()).toBe('co-beta');
    expect(host().querySelector('aside p.font-semibold')?.textContent).toContain('Locadora Beta');
    expect(router.url).toBe('/dashboard');
  });

  it('switching into a DRIVER company lands on /alugueis, not on the dashboard', async () => {
    startAs('co-alfa', 'OWNER', [alfa, delta]);
    await mount();
    openSwitcher();
    answerMemberships([alfa, delta]);

    (host().querySelectorAll('[data-testid="switcher-active"]')[1] as HTMLButtonElement).click();
    http
      .expectOne(`${environment.apiUrl}/auth/select-company/co-delta`)
      .flush({ token: fakeJwt('DRIVER', 'co-delta'), kind: 'ACCESS' });
    await fixture.whenStable();
    settleBackground();

    expect(router.url).toBe('/alugueis');
  });

  it('a refused switch keeps the session where it was and the sheet open', async () => {
    startAs('co-alfa', 'OWNER', [alfa, beta]);
    const tokenBefore = sessionStorage.getItem('token');
    await mount();
    openSwitcher();
    answerMemberships([alfa, beta]);

    (host().querySelectorAll('[data-testid="switcher-active"]')[1] as HTMLButtonElement).click();
    http
      .expectOne(`${environment.apiUrl}/auth/select-company/co-beta`)
      .flush({ message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sessionStorage.getItem('token')).toBe(tokenBefore);
    expect(layout.currentCompanyId()).toBe('co-alfa');
    expect(layout.isTenantOpen()).toBe(true);
  });

  it('falls back to the /auth/me companies when /auth/memberships answers 404', async () => {
    startAs('co-alfa', 'OWNER', [alfa, beta]);
    await mount();
    openSwitcher();
    http
      .expectOne(membershipsUrl)
      .flush({ message: 'nope' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(TestBed.inject(MembershipsService).status()).toBe('unavailable');
    const rows = Array.from(host().querySelectorAll('[data-testid="switcher-active"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Dono');
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
  });

  it('on a phone the list opens in a bottom sheet titled "Suas empresas"', async () => {
    startAs('co-alfa', 'OWNER', [alfa, beta]);
    await mount();
    layout.setMobile(true);
    layout.openMobile();
    fixture.detectChanges();
    openSwitcher();
    answerMemberships([alfa, beta]);

    const dialog = host().querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('h2')?.textContent).toContain('Suas empresas');
    expect(dialog?.querySelectorAll('[data-testid="switcher-active"]').length).toBe(2);
  });
});
