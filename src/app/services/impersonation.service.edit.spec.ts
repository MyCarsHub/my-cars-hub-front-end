import { HttpClient, HttpContext } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IMPERSONATION_ADMIN_TOKEN_KEY,
  IMPERSONATION_STATE_KEY,
  USE_ADMIN_TOKEN,
} from './impersonation.context';
import { ImpersonationService } from './impersonation.service';
import { NotificationService } from './notification.service';
import { SessionResetRegistry } from './session-reset.registry';
import { SessionService } from './session.service';
import { ImpersonationStartResponse } from '../types/impersonation.types';

const ADMIN_TOKEN = 'admin.jwt';

class FakeSession {
  readonly store = new Map<string, string>();
  registry: SessionResetRegistry | null = null;
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
    this.registry?.run();
  }
  setToken(t: string): void {
    this.setItem('token', t);
  }
  getToken(): string | null {
    return this.getItem('token');
  }
}

function iso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function response(extra: Partial<ImpersonationStartResponse> = {}): ImpersonationStartResponse {
  return {
    sessionId: 'sess-1',
    token: 'imp.jwt',
    impersonation: true,
    readOnly: true,
    companyId: 'co-1',
    companyName: 'Locadora Alfa',
    startedAt: new Date().toISOString(),
    expiresAt: iso(15),
    ...extra,
  };
}

describe('ImpersonationService — sessão de EDIÇÃO', () => {
  let session: FakeSession;
  let post: ReturnType<typeof vi.fn>;
  let built: ImpersonationService | null = null;

  function build(): ImpersonationService {
    TestBed.configureTestingModule({
      providers: [
        ImpersonationService,
        { provide: SessionService, useValue: session },
        { provide: HttpClient, useValue: { get: vi.fn(() => of([])), post, delete: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
        },
      ],
    });
    session.registry = TestBed.inject(SessionResetRegistry);
    built = TestBed.inject(ImpersonationService);
    return built;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    session = new FakeSession();
    session.setToken(ADMIN_TOKEN);
    post = vi.fn();
  });

  afterEach(() => {
    built?.reset();
    built = null;
  });

  it('LEITURA continua espelhando o OWNER, sem modo de edição', () => {
    post.mockReturnValue(of(response()));
    const service = build();

    service.start('co-1').subscribe();

    expect(service.mode()).toBe('READ');
    expect(service.editMode()).toBe(false);
    expect(service.readOnly()).toBe(true);
    expect(session.getItem('selectedRole')).toBe('OWNER');
  });

  it('EDIÇÃO: o modo vem da resposta do servidor, não de constante do cliente', () => {
    post.mockReturnValue(
      of(response({ mode: 'EDIT', readOnly: false, absoluteExpiresAt: iso(60), extensionCount: 0 })),
    );
    const service = build();

    service.startEdit('co-1').subscribe();

    const [url] = post.mock.calls[0] as [string];
    expect(url).toMatch(/\/admin\/impersonation\/edit$/);
    expect(service.mode()).toBe('EDIT');
    expect(service.editMode()).toBe(true);
    expect(service.readOnly()).toBe(false);
    expect(session.getItem('selectedRole')).toBe('OWNER');
    expect(session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY)).toBe(ADMIN_TOKEN);
    expect(JSON.parse(session.getItem(IMPERSONATION_STATE_KEY) ?? '{}').mode).toBe('EDIT');
  });

  it('uma resposta sem mode=EDIT nunca vira edição, mesmo vindo de startEdit', () => {
    post.mockReturnValue(of(response()));
    const service = build();

    service.startEdit('co-1').subscribe();

    expect(service.editMode()).toBe(false);
  });

  it('o estado de EDIÇÃO sobrevive ao reload e é limpo no reset do tenant/sessão', () => {
    post.mockReturnValue(
      of(response({ mode: 'EDIT', absoluteExpiresAt: iso(60), extensionCount: 1 })),
    );
    build().startEdit('co-1').subscribe();
    built?.reset();
    TestBed.resetTestingModule();
    // Reconstrói do storage: o estado persistido ainda diz EDIT.
    session.setItem(
      IMPERSONATION_STATE_KEY,
      JSON.stringify({
        sessionId: 'sess-1',
        companyId: 'co-1',
        companyName: 'Locadora Alfa',
        startedAt: new Date().toISOString(),
        expiresAt: iso(10),
        clockOffsetMs: 0,
        mode: 'EDIT',
        absoluteExpiresAt: iso(60),
        extensionCount: 1,
      }),
    );
    session.setItem(IMPERSONATION_ADMIN_TOKEN_KEY, ADMIN_TOKEN);
    const service = build();

    expect(service.editMode()).toBe(true);
    expect(service.state()?.extensionCount).toBe(1);

    session.clear();

    expect(service.active()).toBe(false);
    expect(session.getItem(IMPERSONATION_STATE_KEY)).toBeNull();
  });

  it('estender troca o token, regrava o estado e viaja com a credencial administrativa', () => {
    post.mockReturnValueOnce(
      of(response({ mode: 'EDIT', absoluteExpiresAt: iso(60), extensionCount: 0 })),
    );
    const service = build();
    service.startEdit('co-1').subscribe();
    const newExpiry = iso(25);
    post.mockReturnValueOnce(
      of(
        response({
          token: 'imp.jwt.v2',
          mode: 'EDIT',
          expiresAt: newExpiry,
          absoluteExpiresAt: iso(60),
          extensionCount: 1,
        }),
      ),
    );

    service.extendEdit().subscribe();

    const [url, , options] = post.mock.calls[1] as [string, unknown, { context: HttpContext }];
    expect(url).toMatch(/\/admin\/impersonation\/edit\/sess-1\/extend$/);
    expect(options.context.get(USE_ADMIN_TOKEN)).toBe(true);
    expect(session.getToken()).toBe('imp.jwt.v2');
    expect(service.state()?.expiresAt).toBe(newExpiry);
    expect(service.state()?.extensionCount).toBe(1);
  });

  it('sessão que mudou durante o voo da extensão vira erro, não sucesso', () => {
    post.mockReturnValueOnce(
      of(response({ mode: 'EDIT', absoluteExpiresAt: iso(60), extensionCount: 0 })),
    );
    const service = build();
    service.startEdit('co-1').subscribe();
    post.mockImplementationOnce(() => {
      service.reset();
      return of(response({ token: 'imp.jwt.v2', mode: 'EDIT', expiresAt: iso(25) }));
    });

    let failed = false;
    service.extendEdit().subscribe({ error: () => (failed = true) });

    expect(failed).toBe(true);
    expect(session.getToken()).not.toBe('imp.jwt.v2');
  });

  it('não estende uma sessão de leitura', () => {
    post.mockReturnValue(of(response()));
    const service = build();
    service.start('co-1').subscribe();

    let failed = false;
    service.extendEdit().subscribe({ error: () => (failed = true) });

    expect(failed).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
