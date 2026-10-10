import { TestBed } from '@angular/core/testing';
import { Route, UrlSegment } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { driverRoleMatch } from './driver-role.match';
import { SessionService } from './session.service';

describe('driverRoleMatch', () => {
  const encode = (payload: Record<string, unknown>): string =>
    btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = (payload: Record<string, unknown>) => `h.${encode(payload)}.s`;

  const run = (): boolean =>
    TestBed.runInInjectionContext(
      () => driverRoleMatch({} as Route, [] as UrlSegment[]) as boolean,
    );

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [SessionService] });
  });

  afterEach(() => sessionStorage.clear());

  it('é verdadeiro só para o papel DRIVER do token', () => {
    sessionStorage.setItem('token', token({ role: 'DRIVER' }));
    expect(run()).toBe(true);
  });

  it('é falso para dono e gerente', () => {
    sessionStorage.setItem('token', token({ role: 'OWNER' }));
    expect(run()).toBe(false);
    sessionStorage.setItem('token', token({ role: 'MANAGER' }));
    expect(run()).toBe(false);
  });

  it('é falso sem token, com token vencido e com o espelho adulterado', () => {
    expect(run()).toBe(false);

    sessionStorage.setItem('token', token({ role: 'DRIVER', exp: 1 }));
    expect(run()).toBe(false);

    sessionStorage.setItem('token', token({ role: 'OWNER' }));
    sessionStorage.setItem('selectedRole', 'DRIVER');
    expect(run()).toBe(false);
  });
});
