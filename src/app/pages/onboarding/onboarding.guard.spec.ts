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

  it('onboardingCompleteGuard redirects PLATFORM_ADMIN to /dashboard', () => {
    session.isPlatformAdmin.mockReturnValue(true);
    const router = TestBed.inject(Router);
    const result = run(onboardingCompleteGuard);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    expect(onboarding.loadState).not.toHaveBeenCalled();
  });
});
