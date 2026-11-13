import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { FEATURES_SESSION_KEY, FeatureFlagsService } from './feature-flags.service';
import { ImpersonationService } from './impersonation.service';
import { MeResponse } from '../types/me-response.type';

/**
 * FEAT-0573 — a chave `CHARGES_FLEX` vem do `GET /auth/me` (`features`) e é a ÚNICA fonte
 * que a interface usa para mostrar as Cobranças flexíveis. Fail-closed em tudo.
 */
describe('FeatureFlagsService (CHARGES_FLEX)', () => {
  const impersonating = signal(false);

  beforeEach(() => {
    sessionStorage.clear();
    impersonating.set(false);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ImpersonationService, useValue: { active: impersonating, reset: vi.fn() } }],
    });
  });

  afterEach(() => sessionStorage.clear());

  it('desligada sem nada gravado', () => {
    expect(TestBed.inject(FeatureFlagsService).chargesFlex()).toBe(false);
  });

  it('ligada quando o /auth/me trouxe CHARGES_FLEX', () => {
    sessionStorage.setItem(FEATURES_SESSION_KEY, JSON.stringify(['CHARGES_FLEX']));
    expect(TestBed.inject(FeatureFlagsService).chargesFlex()).toBe(true);
  });

  it('desligada com lista vazia, outro recurso ou JSON quebrado', () => {
    for (const raw of ['[]', '["OTHER"]', '{nope', 'null']) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: ImpersonationService, useValue: { active: impersonating, reset: vi.fn() } }],
      });
      sessionStorage.setItem(FEATURES_SESSION_KEY, raw);
      expect(TestBed.inject(FeatureFlagsService).chargesFlex()).toBe(false);
    }
  });

  it('desligada na sessão de suporte, mesmo com a chave', () => {
    sessionStorage.setItem(FEATURES_SESSION_KEY, JSON.stringify(['CHARGES_FLEX']));
    const flags = TestBed.inject(FeatureFlagsService);
    expect(flags.chargesFlex()).toBe(true);
    impersonating.set(true);
    expect(flags.chargesFlex()).toBe(false);
  });

  it('setFromMe e refresh atualizam o sinal', () => {
    const flags = TestBed.inject(FeatureFlagsService);
    flags.setFromMe(['CHARGES_FLEX']);
    expect(flags.chargesFlex()).toBe(true);
    sessionStorage.setItem(FEATURES_SESSION_KEY, '[]');
    flags.refresh();
    expect(flags.chargesFlex()).toBe(false);
  });
});

describe('AuthService grava `features` do /auth/me', () => {
  function meWith(features: string[] | null | undefined): MeResponse {
    return {
      id: 'u-1',
      name: 'Lia',
      email: 'lia@example.com',
      document: null,
      companies: [{ companyId: 'c-1', companyName: 'Locadora', role: 'OWNER' }],
      onboardingCompleted: true,
      hasCompletedOnboarding: true,
      systemRole: 'USER',
      ...(features === undefined ? {} : { features }),
    };
  }

  function hydrate(me: MeResponse): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: HttpClient, useValue: { get: vi.fn(() => of(me)), post: vi.fn() } },
        { provide: ImpersonationService, useValue: { active: () => false, reset: vi.fn() } },
      ],
    });
    TestBed.inject(AuthService).hydrateSession().subscribe();
  }

  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('com CHARGES_FLEX', () => {
    hydrate(meWith(['CHARGES_FLEX']));
    expect(sessionStorage.getItem('features')).toBe('["CHARGES_FLEX"]');
  });

  it('nulo ou ausente vira lista vazia (backend anterior)', () => {
    hydrate(meWith(null));
    expect(sessionStorage.getItem('features')).toBe('[]');
    hydrate(meWith(undefined));
    expect(sessionStorage.getItem('features')).toBe('[]');
  });
});

describe('CHARGES_FLEX acompanha logout e login na mesma aba (sem recarregar)', () => {
  let me: MeResponse;

  function meWith(features: string[] | null): MeResponse {
    return {
      id: 'u-1',
      name: 'Lia',
      email: 'lia@example.com',
      document: null,
      companies: [{ companyId: 'c-1', companyName: 'Locadora', role: 'OWNER' }],
      onboardingCompleted: true,
      hasCompletedOnboarding: true,
      systemRole: 'USER',
      features,
    };
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: HttpClient, useValue: { get: vi.fn(() => of(me)), post: vi.fn() } },
        { provide: ImpersonationService, useValue: { active: () => false, reset: vi.fn() } },
      ],
    });
  });

  afterEach(() => sessionStorage.clear());

  it('liberado → logout → outra conta sem a chave → mesma conta de novo', () => {
    const auth = TestBed.inject(AuthService);
    const flags = TestBed.inject(FeatureFlagsService);

    me = meWith(['CHARGES_FLEX']);
    auth.hydrateSession().subscribe();
    expect(flags.chargesFlex()).toBe(true);

    auth.logout();
    expect(flags.chargesFlex()).toBe(false);

    me = meWith([]);
    auth.hydrateSession().subscribe();
    expect(flags.chargesFlex()).toBe(false);

    auth.logout();
    me = meWith(['CHARGES_FLEX']);
    auth.hydrateSession().subscribe();
    expect(flags.chargesFlex()).toBe(true);
  });
});
