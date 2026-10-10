import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { billingAccessGuard } from './billing-access.guard';
import { BillingAccessService } from './billing-access.service';
import { SessionService } from './session.service';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

/**
 * A blocked company sends people to `/billing`, which only the OWNER can open. Sending any
 * other role there is a redirect loop with `roleGuard(['OWNER'])`, so the guard must not.
 */
describe('billingAccessGuard', () => {
  let blocked: boolean;

  beforeEach(() => {
    sessionStorage.clear();
    blocked = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: BillingAccessService,
          useValue: {
            loaded: () => true,
            load: () => of(null),
            isBlocked: () => blocked,
            reason: () => 'TRIAL_EXPIRED',
          },
        },
      ],
    });
    TestBed.inject(SessionService).setOnboardingCompleted(true);
  });

  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      billingAccessGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  const as = (role: string) =>
    sessionStorage.setItem('token', jwt({ companyId: 'co-1', role, exp: 4_000_000_000 }));

  it('sends the OWNER of a blocked company to /billing with the reason', () => {
    as('OWNER');
    const result = run('/dashboard') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/billing?reason=TRIAL_EXPIRED');
  });

  it.each(['MANAGER', 'DRIVER', 'VIEWER'])(
    'keeps a %s where they are: they cannot open /billing',
    (role) => {
      as(role);
      expect(run('/dashboard')).toBe(true);
    },
  );

  it('keeps a session without a role claim where it is', () => {
    sessionStorage.setItem('token', jwt({ exp: 4_000_000_000 }));
    expect(run('/dashboard')).toBe(true);
  });

  it('lets everybody through when the company is not blocked', () => {
    blocked = false;
    as('OWNER');
    expect(run('/dashboard')).toBe(true);
  });

  it('never redirects the allow-listed routes', () => {
    as('OWNER');
    expect(run('/billing?reason=TRIAL_EXPIRED')).toBe(true);
    expect(run('/perfil')).toBe(true);
  });
});
