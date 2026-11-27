import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, FEATURES_REFRESH_TIMEOUT_MS } from './auth.service';
import { SessionService } from './session.service';
import { ImpersonationService } from './impersonation.service';
import { featuresSessionVersion } from './features-session';

/**
 * FEAT-0573 — a release opens a feature server-side while a tab stays logged in. Once per page
 * load the app re-reads ONLY `features` from /auth/me, never the company selection.
 */
describe('AuthService.refreshFeaturesOnce', () => {
  let store: Record<string, string>;
  let httpGet: ReturnType<typeof vi.fn>;
  let impersonating: boolean;
  let service: AuthService;

  beforeEach(() => {
    store = { features: '[]', selectedCompanyId: 'c-2', selectedRole: 'MANAGER' };
    impersonating = false;
    httpGet = vi.fn(() =>
      of({ id: 'u1', features: ['CHARGES_FLEX'], companies: [{ companyId: 'c-1', role: 'OWNER' }] }),
    );
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        {
          provide: SessionService,
          useValue: {
            setItem: vi.fn((k: string, v: string) => (store[k] = v)),
            getItem: vi.fn((k: string) => store[k] ?? null),
          },
        },
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn() } },
        { provide: ImpersonationService, useValue: { active: () => impersonating, reset: vi.fn() } },
      ],
    });
    service = TestBed.inject(AuthService);
  });

  afterEach(() => vi.useRealTimers());

  it('writes the fresh features and signals the change, leaving the company selection alone', async () => {
    const before = featuresSessionVersion();
    await firstValueFrom(service.refreshFeaturesOnce());
    expect(JSON.parse(store['features'])).toEqual(['CHARGES_FLEX']);
    expect(featuresSessionVersion()).toBe(before + 1);
    expect(store['selectedCompanyId']).toBe('c-2');
    expect(store['selectedRole']).toBe('MANAGER');
  });

  it('asks the server only once per page load', async () => {
    await firstValueFrom(service.refreshFeaturesOnce());
    await firstValueFrom(service.refreshFeaturesOnce());
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a support session', async () => {
    impersonating = true;
    await firstValueFrom(service.refreshFeaturesOnce());
    expect(httpGet).not.toHaveBeenCalled();
    expect(store['features']).toBe('[]');
  });

  it('keeps the stored features and completes when /auth/me fails', async () => {
    httpGet.mockReturnValue(throwError(() => new Error('offline')));
    await expect(firstValueFrom(service.refreshFeaturesOnce())).resolves.toBeUndefined();
    expect(store['features']).toBe('[]');
  });

  it('gives up after the timeout so navigation is never stuck', async () => {
    vi.useFakeTimers();
    httpGet.mockReturnValue(NEVER);
    const done = firstValueFrom(service.refreshFeaturesOnce());
    await vi.advanceTimersByTimeAsync(FEATURES_REFRESH_TIMEOUT_MS + 1);
    await expect(done).resolves.toBeUndefined();
    expect(store['features']).toBe('[]');
  });
});
