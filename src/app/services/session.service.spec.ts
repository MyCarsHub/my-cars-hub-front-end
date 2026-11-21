import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SessionService, safeReturnUrl } from './session.service';
import { SessionResetRegistry } from './session-reset.registry';
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

/**
 * VÃO DE COBERTURA — limpeza de sessão fora do `logout()`.
 *
 * Zerar o `sessionStorage` não zera o estado em memória dos serviços
 * `providedIn: 'root'`. Enquanto essa segunda metade dependeu de cada chamador
 * lembrar, cinco dos seis `clear()` do app deixavam a sessão de impersonação
 * viva e os caches por empresa cheios. Os ganchos são o que torna a limpeza
 * completa em TODO caminho — 401 do interceptor, `authGuard`, `oauth-success`.
 */
describe('SessionService.clear dispara os ganchos de reset', () => {
  let service: SessionService;
  let registry: SessionResetRegistry;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService, SessionResetRegistry] });
    service = TestBed.inject(SessionService);
    registry = TestBed.inject(SessionResetRegistry);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('executa cada gancho registrado', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(first);
    registry.register(second);

    service.clear();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('roda os ganchos DEPOIS do wipe — quem relê o armazenamento vê a sessão vazia', () => {
    sessionStorage.setItem('selectedCompanyId', 'company-a');
    let seen: string | null = 'não rodou';
    registry.register(() => {
      seen = sessionStorage.getItem('selectedCompanyId');
    });

    service.clear();

    expect(seen).toBeNull();
  });

  it('um gancho que lança não impede os seguintes nem escapa para o chamador', () => {
    const survivor = vi.fn();
    registry.register(() => {
      throw new Error('gancho quebrado');
    });
    registry.register(survivor);

    expect(() => service.clear()).not.toThrow();
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('não reentra quando um gancho acaba chamando clear() de novo', () => {
    const inner = vi.fn();
    registry.register(() => service.clear());
    registry.register(inner);

    service.clear();

    expect(inner).toHaveBeenCalledTimes(1);
  });
});


/**
 * FIX-0363 — o papel de EMPRESA sai do token, irmao do eixo de plataforma acima.
 *
 * O `sessionStorage.selectedRole` continua existindo para exibicao, mas deixou
 * de governar rota: e editavel pelo DevTools e fica stale quando o token e
 * reemitido (troca de empresa, recuperacao silenciosa do FEAT-0106).
 */
describe('SessionService.getCompanyRoleFromToken', () => {
  let service: SessionService;

  const encodePayload = (payload: Record<string, unknown>): string => {
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const buildToken = (payload: Record<string, unknown>): string => {
    const header = encodePayload({ alg: 'HS256', typ: 'JWT' });
    return `${header}.${encodePayload(payload)}.signature-not-verified-client-side`;
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

  it('le o claim `role` do token', () => {
    sessionStorage.setItem('token', buildToken({ role: 'MANAGER' }));
    expect(service.getCompanyRoleFromToken()).toBe('MANAGER');
  });

  /** O ponto do no: o espelho deixou de mandar. */
  it('IGNORA o selectedRole do sessionStorage', () => {
    sessionStorage.setItem('token', buildToken({ role: 'DRIVER' }));
    sessionStorage.setItem('selectedRole', 'OWNER');

    expect(service.getCompanyRoleFromToken()).toBe('DRIVER');
  });

  it('nega quando nao ha token', () => {
    expect(service.getCompanyRoleFromToken()).toBeNull();
  });

  it('nega quando o token nao tem o claim `role`', () => {
    sessionStorage.setItem('token', buildToken({ companyId: 'c-1' }));
    expect(service.getCompanyRoleFromToken()).toBeNull();
  });

  it('nega quando o token esta expirado', () => {
    sessionStorage.setItem(
      'token',
      buildToken({ role: 'OWNER', exp: Math.floor(Date.now() / 1000) - 60 }),
    );
    expect(service.getCompanyRoleFromToken()).toBeNull();
  });

  it('nega quando o token esta malformado', () => {
    sessionStorage.setItem('token', 'nao-e-um-jwt');
    expect(service.getCompanyRoleFromToken()).toBeNull();

    sessionStorage.setItem('token', 'a.b.c');
    expect(service.getCompanyRoleFromToken()).toBeNull();
  });

  it('aceita um token valido e nao expirado', () => {
    sessionStorage.setItem(
      'token',
      buildToken({ role: 'OWNER', exp: Math.floor(Date.now() / 1000) + 3600 }),
    );
    expect(service.getCompanyRoleFromToken()).toBe('OWNER');
  });

  /**
   * O token de impersonacao NAO tem claim `role` (o backend o omite e ainda
   * rebaixa system_role para USER) — ele se identifica pelo claim
   * `impersonation`. Sem este ramo, "ver como empresa" pararia de abrir
   * qualquer rota no instante em que o guard deixou de ler o selectedRole.
   */
  it('resolve o papel da sessao de impersonacao pelo claim `impersonation`', () => {
    sessionStorage.setItem(
      'token',
      buildToken({ impersonation: true, system_role: 'USER', companyId: 'c-9' }),
    );

    expect(service.getCompanyRoleFromToken()).toBe('OWNER');
  });

  it('nao confunde impersonation:false com sessao de suporte', () => {
    sessionStorage.setItem('token', buildToken({ impersonation: false, role: 'DRIVER' }));
    expect(service.getCompanyRoleFromToken()).toBe('DRIVER');
  });
});

describe('SessionService: sessão que CAIU guarda o rascunho; "Sair" limpa tudo', () => {
  let service: SessionService;
  const DRAFT = 'rentalCreateDraft:u-1:c-1';

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService, SessionResetRegistry] });
    service = TestBed.inject(SessionService);
    sessionStorage.setItem('id', 'u-1');
    sessionStorage.setItem('token', 'jwt');
    sessionStorage.setItem('selectedCompanyId', 'c-1');
    sessionStorage.setItem(DRAFT, '{"v":1}');
  });

  afterEach(() => sessionStorage.clear());

  it('expiração/401: derruba a sessão, mantém o rascunho e lembra a tela para o mesmo usuário', () => {
    service.clearForExpiry('/alugueis/novo');
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('selectedCompanyId')).toBeNull();
    expect(sessionStorage.getItem(DRAFT)).toBe('{"v":1}');
    expect(service.takeReturnUrl('u-2')).toBeNull(); // outro usuário: não volta, e o aviso some
    service.clearForExpiry('/alugueis/novo');
    expect(service.takeReturnUrl('u-1')).toBeNull(); // o id já tinha caído no 1º clear
  });

  it('o "voltar para" vale só para o mesmo usuário, uma vez', () => {
    service.clearForExpiry('/alugueis/novo');
    expect(service.takeReturnUrl('u-1')).toBe('/alugueis/novo');
    expect(service.takeReturnUrl('u-1')).toBeNull();
  });

  it('"Sair" (clear) apaga o rascunho também', () => {
    service.clear();
    expect(sessionStorage.getItem(DRAFT)).toBeNull();
  });

  it('o relogin (wipe + recolocar) mantém o rascunho', () => {
    service.clearForExpiry('/alugueis/novo');
    const restore = service.preserveAcrossRelogin();
    service.clear();
    service.setToken('novo');
    restore();
    expect(sessionStorage.getItem(DRAFT)).toBe('{"v":1}');
    expect(sessionStorage.getItem('returnAfterLogin')).toContain('/alugueis/novo');
  });

  it('só volta para caminho de dentro do app, nunca para outro site ou para o /login', () => {
    expect(safeReturnUrl('/alugueis/novo?vehicleId=1')).toBe('/alugueis/novo?vehicleId=1');
    expect(safeReturnUrl('//evil.com')).toBeNull();
    expect(safeReturnUrl('https://evil.com')).toBeNull();
    expect(safeReturnUrl('/login')).toBeNull();
  });
});

describe('SessionService: aba compartilhada — o que outro usuário deixou não fica', () => {
  let service: SessionService;
  const A_DRAFT = 'rentalCreateDraft:u-a:c-1';
  const B_DRAFT = 'rentalCreateDraft:u-b:c-9';

  /** O relogin do OAuth: guarda, limpa, entra, recoloca; o `/auth/me` grava o id e limpa. */
  function relogin(userId: string): void {
    const restore = service.preserveAcrossRelogin();
    service.clear();
    service.setToken(`jwt-${userId}`);
    restore();
    service.setItem('id', userId);
    service.dropOtherUsersLeftovers(userId);
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [SessionService, SessionResetRegistry] });
    service = TestBed.inject(SessionService);
    sessionStorage.setItem('id', 'u-a');
    sessionStorage.setItem('token', 'jwt-a');
    sessionStorage.setItem(A_DRAFT, '{"v":1,"who":"a"}');
    sessionStorage.setItem(B_DRAFT, '{"v":1,"who":"b"}');
  });

  afterEach(() => sessionStorage.clear());

  it('A expira, B entra: os rascunhos e o "voltar para" de A somem; os de B ficam', () => {
    service.clearForExpiry('/alugueis/novo');
    expect(sessionStorage.getItem(A_DRAFT)).not.toBeNull();
    relogin('u-b');
    expect(sessionStorage.getItem(A_DRAFT)).toBeNull();
    expect(sessionStorage.getItem('returnAfterLogin')).toBeNull();
    expect(sessionStorage.getItem(B_DRAFT)).toBe('{"v":1,"who":"b"}');
    expect(service.takeReturnUrl('u-b')).toBeNull();
  });

  it('A expira e A entra de novo: o rascunho de A volta, e a tela também', () => {
    service.clearForExpiry('/alugueis/novo');
    relogin('u-a');
    expect(sessionStorage.getItem(A_DRAFT)).toBe('{"v":1,"who":"a"}');
    expect(sessionStorage.getItem(B_DRAFT)).toBeNull();
    expect(service.takeReturnUrl('u-a')).toBe('/alugueis/novo');
  });

  it('login por senha (sem wipe): o /auth/me de B também apaga o que A deixou', () => {
    service.clearForExpiry('/alugueis/novo');
    service.setItem('id', 'u-b');
    service.dropOtherUsersLeftovers('u-b');
    expect(sessionStorage.getItem(A_DRAFT)).toBeNull();
    expect(sessionStorage.getItem('returnAfterLogin')).toBeNull();
  });

  it('não volta para tela de passagem ou de fluxo: cai na casa de sempre', () => {
    expect(safeReturnUrl('/trocando-empresa')).toBeNull();
    expect(safeReturnUrl('/onboarding')).toBeNull();
    expect(safeReturnUrl('/convite/cadastro')).toBeNull();
    expect(safeReturnUrl('/invite/accept?token=x')).toBeNull();
    expect(safeReturnUrl('/alugueis/novo')).toBe('/alugueis/novo');
  });
});
