import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { onboardingGuard, onboardingCompleteGuard } from './onboarding.guard';
import { OnboardingService } from './onboarding.service';
import { SessionService } from '../../services/session.service';

/**
 * Guards run via TestBed.runInInjectionContext so `inject()` inside the
 * CanActivateFn resolves against the configured providers.
 */
describe('onboardingGuard (PLATFORM_ADMIN bypass)', () => {
  let session: { isOnboardingCompleted: ReturnType<typeof vi.fn>; isPlatformAdmin: ReturnType<typeof vi.fn> };
  let onboarding: { isCompleted: ReturnType<typeof vi.fn>; loadState: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    session = {
      isPlatformAdmin: vi.fn().mockReturnValue(false),
      isOnboardingCompleted: vi.fn().mockReturnValue(false),
    };
    onboarding = {
      isCompleted: vi.fn().mockReturnValue(false),
      loadState: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: session },
        { provide: OnboardingService, useValue: onboarding },
      ],
    });
  });

  function run(guard: typeof onboardingGuard) {
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  }

  it('returns true for PLATFORM_ADMIN without touching loadState', () => {
    session.isPlatformAdmin.mockReturnValue(true);
    const result = run(onboardingGuard);
    expect(result).toBe(true);
    expect(onboarding.loadState).not.toHaveBeenCalled();
  });

  /*
   * THIS ASSERTION CHANGED SIDES on 2026-09-25 (FIX-0579). It used to assert
   * '/dashboard', and it named that destination in its own title.
   *
   * Why the destination moved: /dashboard acquired roleGuard(['OWNER','MANAGER']).
   * A PLATFORM_ADMIN has no company role, so sending him there landed him on a
   * route that refuses him and forwards to /admin anyway. It terminated in two
   * hops, so it was never a loop - but the first hop was a refusal, which
   * app.routes.redirect-termination.spec.ts asserts against. One hop now.
   *
   * The other two assertions are untouched: it still returns a UrlTree, and it
   * still must not touch loadState.
   */
  it('onboardingCompleteGuard redirects PLATFORM_ADMIN to /admin', () => {
    session.isPlatformAdmin.mockReturnValue(true);
    const router = TestBed.inject(Router);
    const result = run(onboardingCompleteGuard);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/admin');
    expect(onboarding.loadState).not.toHaveBeenCalled();
  });
});
