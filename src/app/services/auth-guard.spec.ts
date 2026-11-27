import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authGuard } from './auth-guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

describe('authGuard', () => {
  let store: Record<string, string>;
  let auth: { refreshFeaturesOnce: ReturnType<typeof vi.fn>; getMe: ReturnType<typeof vi.fn> };

  const run = () =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  beforeEach(() => {
    store = {};
    auth = { refreshFeaturesOnce: vi.fn(() => of(undefined)), getMe: vi.fn(() => of({})) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: SessionService,
          useValue: {
            getToken: () => store['token'] ?? null,
            getItem: (k: string) => store[k] ?? null,
            clear: vi.fn(),
          },
        },
      ],
    });
  });

  it('sends a tab without a token to /login', () => {
    const result = run();
    expect(result instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('refreshes the released features for a session that started before this page load', async () => {
    store = { token: 't', onboardingCompleted: 'true' };
    const result = await firstValueFrom(run() as Observable<boolean>);
    expect(result).toBe(true);
    expect(auth.refreshFeaturesOnce).toHaveBeenCalledTimes(1);
    expect(auth.getMe).not.toHaveBeenCalled();
  });

  it('starts a session with /auth/me when nothing is loaded yet', async () => {
    store = { token: 't' };
    await firstValueFrom(run() as Observable<boolean>);
    expect(auth.getMe).toHaveBeenCalledTimes(1);
    expect(auth.refreshFeaturesOnce).not.toHaveBeenCalled();
  });
});
