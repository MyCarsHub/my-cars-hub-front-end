import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationCancel, Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routes } from '../../app.routes';
import { authInterceptor } from '../../services/auth.interceptor';
import { errorInterceptor } from '../../services/error.interceptor';
import { impersonationInterceptor } from '../../services/impersonation.interceptor';
import { INVITE_ONBOARDING_TOKEN_KEY } from '../../services/invite-onboarding-token.store';
import { environment } from '../../../environments/environment';
import { PENDING_INVITE_TOKEN_KEY } from '../invites/invite-session';

const API = environment.apiUrl;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

interface Reply {
  status?: number;
  body: object;
}

const BLOCKED: Reply = {
  body: { status: 'BLOCKED', blocked: true, reason: 'TRIAL_EXPIRED' },
};

/**
 * The whole return trip of an EXISTING account, on the REAL route table and the REAL guards:
 *
 *   /oauth-success?code= -> oauth-exchange -> /convite (resume flag) -> validate ->
 *   accept-as-member -> sign in -> /dashboard (authGuard, onboarding, billing and role guards).
 *
 * Only the network is faked. This is the arrangement that exposes what the unit spec of the
 * page cannot: that spec routes to an empty `/dashboard`, so a guard that never lets the
 * invitee through was invisible to it.
 */
describe('Google return trip of an invite, through the real guards', () => {
  let redirects = 0;

  beforeEach(() => {
    sessionStorage.clear();
    redirects = 0;
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function configure(interceptors: Parameters<typeof withInterceptors>[0]): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideNoopAnimations(),
        provideHttpClient(withInterceptors(interceptors)),
        provideHttpClientTesting(),
      ],
    });
  }

  /** Answers every request from `table` (longest-prefix wins by order) until the page settles. */
  async function drive(
    start: string,
    table: Record<string, Reply>,
  ): Promise<{ url: string; calls: string[]; text: string }> {
    const router = TestBed.inject(Router);
    const backend = TestBed.inject(HttpTestingController);
    const calls: string[] = [];

    router.events.subscribe((event) => {
      if (event instanceof NavigationCancel) {
        redirects += 1;
        // A guard pair that bounces forever never yields to the browser, so the spec ends the
        // loop itself instead of hanging the runner; `redirects` is what the assertions read.
        if (redirects === 25) sessionStorage.clear();
      }
    });

    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(start);

    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const req of backend.match(() => true)) {
        const path = req.request.url.replace(API, '').split('?')[0];
        calls.push(`${req.request.method} ${path}`);
        const reply = Object.entries(table).find(([prefix]) => path.startsWith(prefix))?.[1];
        if (!reply) {
          req.flush({}, { status: 404, statusText: 'Not Found' });
        } else if (reply.status && reply.status >= 400) {
          req.flush(reply.body, { status: reply.status, statusText: 'Error' });
        } else {
          req.flush(reply.body);
        }
      }
    }

    harness.detectChanges();
    const text = (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
    return { url: router.url, calls, text: text.replace(/\s+/g, ' ') };
  }

  function returnTrip(
    role: 'MANAGER' | 'DRIVER',
    overrides: Record<string, Reply> = {},
  ): Promise<{ url: string; calls: string[]; text: string }> {
    sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, 'tok-123');
    configure([impersonationInterceptor, authInterceptor, errorInterceptor]);

    const companyToken = jwt({ companyId: 'co-9', role, exp: 4_000_000_000, sub: 'u1' });
    return drive('/oauth-success?code=abc', {
      '/auth/oauth-exchange': { body: { token: jwt({ sub: 'u1', exp: 4_000_000_000 }) } },
      '/invites/validate': {
        body: { state: 'PENDING', companyName: 'Alfa', roleLabel: 'X', accountKind: 'EXISTING' },
      },
      '/invites/accept-as-member': {
        body: {
          accessToken: companyToken,
          role,
          roleLabel: 'X',
          companyName: 'Alfa',
          next: 'COMPANY_HOME',
        },
      },
      '/billing/access-status': { body: { status: 'TRIAL_ACTIVE', blocked: false, reason: null } },
      '/vehicles': { body: { total: 1, items: [] } },
      '/auth/memberships': { body: { memberships: [], pendingInvites: [], defaultCompanyId: null } },
      ...overrides,
    });
  }

  it('a MANAGER lands on the dashboard of the company they were just added to', async () => {
    const result = await returnTrip('MANAGER');

    expect(result.url).toBe('/dashboard');
    expect(result.calls).toContain('POST /invites/accept-as-member');
    expect(redirects).toBeLessThanOrEqual(1);
  });

  it('a MANAGER of a company whose subscription lapsed is NOT bounced between /dashboard and /billing', async () => {
    const result = await returnTrip('MANAGER', { '/billing/access-status': BLOCKED });

    // The defect: /billing is OWNER-only, so the billing guard and the role guard sent a
    // non-owner back and forth without end and the "Entrando na empresa" spinner never left.
    expect(redirects).toBeLessThan(3);
    expect(result.url).toBe('/dashboard');
    expect(sessionStorage.getItem('token')).not.toBeNull();
  });

  it('a DRIVER of a company whose subscription lapsed lands on their own home, not in a loop', async () => {
    const result = await returnTrip('DRIVER', { '/billing/access-status': BLOCKED });

    expect(redirects).toBeLessThan(3);
    expect(result.url).toBe('/alugueis');
    expect(sessionStorage.getItem('token')).not.toBeNull();
  });

  it('the OWNER of a lapsed company is still sent to /billing (the paywall is kept for them)', async () => {
    configure([authInterceptor, errorInterceptor]);
    sessionStorage.setItem('token', jwt({ companyId: 'co-1', role: 'OWNER', exp: 4_000_000_000 }));
    sessionStorage.setItem('onboardingCompleted', 'true');

    const result = await drive('/dashboard', { '/billing/access-status': BLOCKED });

    expect(result.url).toContain('/billing');
  });

  it('a DRIVER whose registration is pending gets an onboarding token (no access token) and goes to the driver onboarding, not to /login', async () => {
    const result = await returnTrip('DRIVER', {
      '/invites/accept-as-member': {
        body: {
          onboardingToken: 'onb-token',
          role: 'DRIVER',
          roleLabel: 'Motorista',
          companyName: 'Alfa',
          next: 'DRIVER_ONBOARDING',
        },
      },
      '/invite-onboarding': {
        body: {
          role: 'DRIVER',
          roleLabel: 'Motorista',
          companyName: 'Alfa',
          prefill: { name: 'Ana Souza', phoneMasked: '(11) 9****-4321' },
          identityEditable: false,
          needsLicense: true,
        },
      },
    });

    expect(result.url).toBe('/convite/cadastro');
    expect(sessionStorage.getItem(INVITE_ONBOARDING_TOKEN_KEY)).toBe('onb-token');
    expect(sessionStorage.getItem('token')).not.toBe('undefined');
    expect(result.calls).toContain('GET /invite-onboarding');
    expect(result.calls).not.toContain('GET /auth/me');
  });
});
