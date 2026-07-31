import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SessionService } from './session.service';
import { TelemetryService } from './telemetry.service';

/**
 * Security regression: `sessionStorage.systemRole` is user-editable via DevTools.
 * Admin UI surface (menus, guards, feature flags) MUST derive `systemRole` from
 * the signed JWT payload — not from the plain sessionStorage cache.
 */
describe('SessionService.getSystemRoleFromToken / isPlatformAdmin', () => {
  let service: SessionService;

  const encodePayload = (payload: Record<string, unknown>): string => {
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const buildToken = (payload: Record<string, unknown>): string => {
    const header = encodePayload({ alg: 'HS256', typ: 'JWT' });
    const body = encodePayload(payload);
    return `${header}.${body}.signature-not-verified-client-side`;
  };

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [SessionService] });
    service = TestBed.inject(SessionService);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('returns USER when no token is present', () => {
    expect(service.getSystemRoleFromToken()).toBe('USER');
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('returns PLATFORM_ADMIN when JWT payload has system_role=PLATFORM_ADMIN', () => {
    sessionStorage.setItem('token', buildToken({ system_role: 'PLATFORM_ADMIN' }));
    expect(service.getSystemRoleFromToken()).toBe('PLATFORM_ADMIN');
    expect(service.isPlatformAdmin()).toBe(true);
  });

  it('returns USER when JWT payload has system_role=USER', () => {
    sessionStorage.setItem('token', buildToken({ system_role: 'USER' }));
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('does NOT trust sessionStorage.systemRole when JWT says USER (tamper-resistance)', () => {
    // Attacker scenario: DevTools edits sessionStorage.systemRole to escalate.
    sessionStorage.setItem('token', buildToken({ system_role: 'USER' }));
    sessionStorage.setItem('systemRole', 'PLATFORM_ADMIN');

    expect(service.getSystemRole()).toBe('USER');
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('returns USER for a malformed token (not three segments)', () => {
    sessionStorage.setItem('token', 'not-a-jwt');
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('returns USER for a token with non-JSON payload', () => {
    sessionStorage.setItem('token', 'aaa.!!!not-base64-json!!!.zzz');
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('returns USER for an expired token (fail-closed)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
    const expiredExp = Math.floor(Date.now() / 1000) - 60;
    sessionStorage.setItem(
      'token',
      buildToken({ system_role: 'PLATFORM_ADMIN', exp: expiredExp }),
    );
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('returns PLATFORM_ADMIN for a non-expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem(
      'token',
      buildToken({ system_role: 'PLATFORM_ADMIN', exp: futureExp }),
    );
    expect(service.isPlatformAdmin()).toBe(true);
  });
});

/**
 * Identity tagging reaches Sentry through `TelemetryService`, never through a
 * direct `@sentry/angular` import — that seam is what lets this be asserted
 * with a DI override instead of an ESM module mock (see `telemetry.service.ts`).
 */
describe('SessionService telemetry identity', () => {
  let service: SessionService;
  let setUser: ReturnType<typeof vi.fn<TelemetryService['setUser']>>;

  beforeEach(() => {
    sessionStorage.clear();
    setUser = vi.fn<TelemetryService['setUser']>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SessionService, { provide: TelemetryService, useValue: { setUser } }],
    });
    service = TestBed.inject(SessionService);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('tags the user when the id key is written', () => {
    service.setItem('email', 'a@b.com');
    setUser.mockClear();

    service.setItem('id', 'u-1');

    expect(setUser).toHaveBeenCalledWith({ id: 'u-1', email: 'a@b.com' });
  });

  it('goes anonymous when the id key is removed', () => {
    service.setItem('id', 'u-1');
    setUser.mockClear();

    service.removeItem('id');

    expect(setUser).toHaveBeenCalledWith(null);
  });

  it('goes anonymous on clear (logout)', () => {
    service.setItem('id', 'u-1');
    setUser.mockClear();

    service.clear();

    expect(setUser).toHaveBeenCalledWith(null);
  });

  it('never lets a telemetry failure escape into the caller', () => {
    setUser.mockImplementation(() => {
      throw new Error('Sentry not initialized');
    });

    expect(() => service.setItem('id', 'u-1')).not.toThrow();
    expect(() => service.clear()).not.toThrow();
  });
});
