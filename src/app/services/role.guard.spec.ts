import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { roleGuard } from './role.guard';
import { SessionService } from './session.service';

/**
 * FIX-0363 — o papel que governa a rota vem do TOKEN, nao do espelho
 * `selectedRole` do sessionStorage.
 *
 * Isto NAO e a defesa real: quem adulterar o espelho ve a rota abrir e leva 403
 * do servidor, que nunca confiou nele. O ganho e coerencia (mesma fonte que o
 * backend) e fim do papel STALE depois de trocar de empresa.
 */
describe('roleGuard — papel vindo do token', () => {
  const encodePayload = (payload: Record<string, unknown>): string => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const buildToken = (payload: Record<string, unknown>): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload(payload)}.sig`;

  function run(allowed: string[]): boolean | UrlTree {
    return TestBed.runInInjectionContext(
      () => roleGuard(allowed)(null as never, null as never) as boolean | UrlTree,
    );
  }

  function denied(result: boolean | UrlTree): boolean {
    return result !== true;
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService] });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('deixa passar quando o TOKEN traz um papel permitido', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));
    expect(run(['OWNER', 'MANAGER'])).toBe(true);
  });

  it('nega quando o TOKEN traz um papel nao permitido', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    expect(denied(run(['OWNER', 'MANAGER']))).toBe(true);
  });

  /**
   * O DONE WHEN em uma linha: adulterar o espelho no DevTools nao muda mais o
   * acesso. Antes do FIX-0363 estes dois testes eram o contrario um do outro.
   */
  it('adulterar selectedRole NAO abre uma rota que o token nega', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    sessionStorage.setItem('selectedRole', 'OWNER');

    expect(denied(run(['OWNER']))).toBe(true);
  });

  it('adulterar selectedRole NAO fecha uma rota que o token permite', () => {
    sessionStorage.setItem('token', buildToken({ role: 'OWNER' }));
    sessionStorage.setItem('selectedRole', 'DRIVER');

    expect(run(['OWNER'])).toBe(true);
  });

  /** Fail-closed declarado: ausencia de papel NEGA, nao concede por omissao. */
  it('nega quando nao ha token', () => {
    expect(denied(run(['OWNER', 'MANAGER', 'DRIVER']))).toBe(true);
  });

  it('nega quando o token expirou, mesmo com o espelho intacto', () => {
    sessionStorage.setItem(
      'token',
      buildToken({ role: 'OWNER', exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    sessionStorage.setItem('selectedRole', 'OWNER');

    expect(denied(run(['OWNER']))).toBe(true);
  });

  /**
   * Regressao de "ver como empresa": o token de impersonacao nao tem claim
   * `role`. Sem o ramo do claim `impersonation`, o admin em sessao de suporte
   * pararia de abrir as telas que foi ver.
   */
  it('mantem a sessao de impersonacao abrindo as rotas do cliente', () => {
    sessionStorage.setItem('token', buildToken({ impersonation: true, system_role: 'USER' }));

    expect(run(['OWNER'])).toBe(true);
    expect(run(['OWNER', 'MANAGER'])).toBe(true);
  });

  /**
   * FEAT-0106: a reemissao silenciosa grava um token NOVO. Como o papel e lido
   * do token a cada chamada, o guard enxerga o papel novo sem ninguem
   * reescrever o espelho — que era exatamente o que ficava stale antes.
   */
  it('enxerga o papel novo assim que o token e reemitido', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    expect(denied(run(['OWNER']))).toBe(true);

    sessionStorage.setItem('token', buildToken({ role: 'OWNER' }));
    expect(run(['OWNER'])).toBe(true);
  });
});
