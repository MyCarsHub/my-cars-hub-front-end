import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  HttpHandlerFn,
  HttpRequest,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { Router } from '@angular/router';
import {
  of,
  throwError,
  firstValueFrom,
  lastValueFrom,
  catchError,
  EMPTY,
  type Observable,
} from 'rxjs';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { errorInterceptor } from './error.interceptor';
import { OWNED_HTTP_ERRORS, SILENT_HTTP_ERRORS } from './http-errors.context';
import { SessionService } from './session.service';
import { NotificationService } from './notification.service';
import { ApiErrorService } from './api-error.service';
import { ImpersonationService } from './impersonation.service';
import {
  IMPERSONATION_ERROR_CODES,
  IMPERSONATION_READ_ONLY_MESSAGE,
} from './impersonation.context';
import {
  DRIVER_IDENTITY_ERROR_CODE,
  DRIVER_IDENTITY_REAUTH_MESSAGE,
  DRIVER_IDENTITY_RETRIED,
} from './driver-identity.context';
import { DriverIdentityRecoveryService } from './driver-identity-recovery.service';

function makeError(status: number, body?: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: 'http://localhost/v1/x' });
}

describe('errorInterceptor', () => {
  let sessionClear: ReturnType<typeof vi.fn>;
  let routerNavigate: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifyWarning: ReturnType<typeof vi.fn>;
  let scheduleSafetyNet: ReturnType<typeof vi.fn>;
  let impersonating: boolean;
  let impersonationExpire: ReturnType<typeof vi.fn>;
  let reissueToken: Mock<() => Observable<string>>;

  beforeEach(() => {
    sessionClear = vi.fn();
    routerNavigate = vi.fn();
    notifyError = vi.fn();
    notifyWarning = vi.fn();
    scheduleSafetyNet = vi.fn();
    impersonating = false;
    impersonationExpire = vi.fn();
    // Padrao: a reemissao devolve um token novo. Cada teste que precisa de
    // fracasso troca a implementacao.
    reissueToken = vi.fn(() => of('token-novo'));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        { provide: SessionService, useValue: { clear: sessionClear } },
        { provide: Router, useValue: { navigate: routerNavigate } },
        { provide: ApiErrorService, useValue: { scheduleSafetyNet, claim: vi.fn() } },
        {
          provide: ImpersonationService,
          useValue: { active: () => impersonating, expire: impersonationExpire },
        },
        {
          provide: DriverIdentityRecoveryService,
          useValue: { reissueToken: () => reissueToken() },
        },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: notifyWarning,
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  });

  async function runAndCatch(status: number, body?: unknown, url = 'http://localhost/v1/x') {
    const req = new HttpRequest('GET', url);
    const next: HttpHandlerFn = () => throwError(() => makeError(status, body));
    const result$ = TestBed.runInInjectionContext(() => errorInterceptor(req, next));

    let caught: unknown;
    await lastValueFrom(
      result$.pipe(
        catchError((err) => {
          caught = err;
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );
    return caught as HttpErrorResponse | undefined;
  }

  it('clears session and redirects to /login on 401', async () => {
    const err = await runAndCatch(401);
    expect(sessionClear).toHaveBeenCalledTimes(1);
    expect(routerNavigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    expect(notifyWarning).toHaveBeenCalledWith('Sessão inválida. Faça login novamente.');
    expect(err?.status).toBe(401);
  });

  it('clears session and redirects to /login when the backend reports TokenExpiredException', async () => {
    const err = await runAndCatch(401, {
      message: 'TokenExpiredException: JWT expired',
    });

    expect(sessionClear).toHaveBeenCalledTimes(1);
    expect(routerNavigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    expect(err?.status).toBe(401);
    expect(notifyWarning).toHaveBeenCalledWith('Sua sessão expirou. Faça login novamente.');
  });

  it('does NOT clear session or redirect on 401 when request is /auth/login', async () => {
    const err = await runAndCatch(401, undefined, 'http://localhost/v1/auth/login');
    expect(sessionClear).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalled();
    expect(err?.status).toBe(401);
  });

  it('shows "Acesso negado" on 403', async () => {
    await runAndCatch(403);
    expect(notifyWarning).toHaveBeenCalledWith('Acesso negado');
  });

  it('shows generic message on 500 without clearing session or redirecting', async () => {
    await runAndCatch(500);
    expect(notifyError).toHaveBeenCalledWith('Erro no servidor. Tente novamente.');
    expect(sessionClear).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('forwards backend message on 500 when present', async () => {
    await runAndCatch(500, { message: 'Falha ao registrar pagamento.' });
    expect(notifyError).toHaveBeenCalledWith('Falha ao registrar pagamento.');
    expect(sessionClear).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  it('shows offline toast on status 0 without clearing session or redirecting', async () => {
    await runAndCatch(0);
    expect(notifyError).toHaveBeenCalledWith('Sem conexão com o servidor.');
    expect(sessionClear).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalled();
  });

  // 4xx belongs to the screen (inline). The interceptor only arms the safety net.
  it.each([400, 404, 409, 422, 429])('does not toast on %i, arms the safety net', async (status) => {
    await runAndCatch(status, { message: 'Placa já cadastrada.' });
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(scheduleSafetyNet).toHaveBeenCalledTimes(1);
  });

  it('does not arm the safety net for 401/403 (already toasted here)', async () => {
    await runAndCatch(403);
    expect(scheduleSafetyNet).not.toHaveBeenCalled();
  });

  it('does not arm the safety net for 5xx (already toasted here)', async () => {
    await runAndCatch(503);
    expect(scheduleSafetyNet).not.toHaveBeenCalled();
  });

  it('re-throws the original error', async () => {
    const err = await runAndCatch(500);
    expect(err).toBeInstanceOf(HttpErrorResponse);
    expect(err?.status).toBe(500);
  });

  it('passes through successful responses without notifications', async () => {
    const req = new HttpRequest('GET', 'http://localhost/v1/x');
    const next: HttpHandlerFn = () => of({ status: 200 } as any);
    const result$ = TestBed.runInInjectionContext(() => errorInterceptor(req, next));
    const value = await firstValueFrom(result$);
    expect(value).toBeDefined();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(sessionClear).not.toHaveBeenCalled();
  });

  /**
   * Durante uma sessão de impersonação, os dois desfechos genéricos acima são
   * exatamente os errados: o 401 tiraria do admin o PRÓPRIO acesso, e o 403
   * viraria "Acesso negado" — que não diz que foi a sessão somente-leitura.
   */
  describe('sessão de impersonação', () => {
    it('401 encerra a impersonação e NÃO manda o admin para o login', async () => {
      impersonating = true;

      const err = await runAndCatch(401, { code: IMPERSONATION_ERROR_CODES.invalidToken });

      expect(impersonationExpire).toHaveBeenCalledTimes(1);
      expect(sessionClear).not.toHaveBeenCalled();
      expect(routerNavigate).not.toHaveBeenCalled();
      expect(err?.status).toBe(401);
    });

    it('401 fora de impersonação segue caindo no login', async () => {
      await runAndCatch(401);

      expect(impersonationExpire).not.toHaveBeenCalled();
      expect(routerNavigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    });

    it('403 do filtro (code) explica a sessão somente leitura', async () => {
      await runAndCatch(403, {
        code: IMPERSONATION_ERROR_CODES.readOnly,
        message: 'Sessão de impersonação é somente leitura: nenhuma alteração é permitida.',
      });

      expect(notifyWarning).toHaveBeenCalledWith(IMPERSONATION_READ_ONLY_MESSAGE);
      expect(notifyWarning).not.toHaveBeenCalledWith('Acesso negado');
    });

    it('403 da transação READ ONLY (só mensagem, sem code) também é reconhecido', async () => {
      impersonating = true;

      await runAndCatch(403, {
        message: 'Sessão somente leitura: nenhuma alteração é permitida.',
      });

      expect(notifyWarning).toHaveBeenCalledWith(IMPERSONATION_READ_ONLY_MESSAGE);
    });

    /**
     * A frase não é contrato: a transação READ ONLY do Postgres é só uma das
     * origens possíveis para "somente leitura" numa mensagem de 403. Sem sessão
     * ativa, casar a expressão avisaria sobre uma impersonação inexistente e
     * esconderia o motivo real da recusa.
     */
    it('403 com "somente leitura" na mensagem SEM sessão ativa cai no aviso genérico', async () => {
      impersonating = false;

      await runAndCatch(403, {
        message: 'Este recurso é somente leitura no seu plano.',
      });

      expect(notifyWarning).toHaveBeenCalledWith('Acesso negado');
      expect(notifyWarning).not.toHaveBeenCalledWith(IMPERSONATION_READ_ONLY_MESSAGE);
    });

    it('403 comum continua sendo "Acesso negado"', async () => {
      await runAndCatch(403, { message: 'Apenas OWNER e MANAGER podem executar esta ação.' });

      expect(notifyWarning).toHaveBeenCalledWith('Acesso negado');
    });
  });

  /**
   * `DRIVER_IDENTITY_NOT_RESOLVED` (backend PR #170): 403 que NAO e falta de
   * permissao. O status e o mesmo de um 403 comum de proposito - so o `code`
   * distingue -, entao os dois comportamentos precisam ser provados lado a lado:
   * com o codigo, re-autentica; sem o codigo, nada muda.
   */
  describe('403 DRIVER_IDENTITY_NOT_RESOLVED', () => {
    const driverBody = {
      message: 'Identidade do motorista nao resolvida.',
      code: DRIVER_IDENTITY_ERROR_CODE,
    };

    /**
     * Falha a primeira tentativa e deixa a segunda passar - e o formato real do
     * caminho de recuperacao, e a unica forma de observar o reenvio.
     */
    async function runRecovering(
      body: unknown,
      options: { url?: string; context?: HttpContext } = {},
    ) {
      const url = options.url ?? 'http://localhost/v1/x';
      const req = new HttpRequest('GET', url, {
        context: options.context ?? new HttpContext(),
      });

      const sent: HttpRequest<unknown>[] = [];
      const next: HttpHandlerFn = (r) => {
        sent.push(r);
        if (sent.length === 1) return throwError(() => makeError(403, body));
        return of(new HttpResponse({ status: 200, body: { ok: true } }));
      };

      const result$ = TestBed.runInInjectionContext(() => errorInterceptor(req, next));
      let caught: unknown;
      const last = await lastValueFrom(
        result$.pipe(
          catchError((err) => {
            caught = err;
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      return { sent, caught: caught as HttpErrorResponse | undefined, last };
    }

    it('reemite o token e REENVIA a requisicao, em vez de acusar falta de permissao', async () => {
      const { sent, caught, last } = await runRecovering(driverBody);

      expect(reissueToken).toHaveBeenCalledTimes(1);
      expect(sent).toHaveLength(2);
      expect(sent[1].headers.get('Authorization')).toBe('Bearer token-novo');
      expect(last).toBeInstanceOf(HttpResponse);
      expect(caught).toBeUndefined();

      // O que o node existe para impedir: a sessao travada com "Acesso negado".
      expect(notifyWarning).not.toHaveBeenCalled();
      expect(sessionClear).not.toHaveBeenCalled();
      expect(routerNavigate).not.toHaveBeenCalled();
    });

    it('marca o reenvio para que ele nao possa disparar uma segunda reemissao', async () => {
      const { sent } = await runRecovering(driverBody);

      expect(sent[1].context.get(DRIVER_IDENTITY_RETRIED)).toBe(true);
    });

    it('403 SEM o codigo continua sendo "Acesso negado" - comportamento inalterado', async () => {
      const err = await runAndCatch(403, { message: 'Sem permissao para este recurso.' });

      expect(reissueToken).not.toHaveBeenCalled();
      expect(notifyWarning).toHaveBeenCalledWith('Acesso negado');
      expect(sessionClear).not.toHaveBeenCalled();
      expect(routerNavigate).not.toHaveBeenCalled();
      expect(err?.status).toBe(403);
    });

    it('403 com OUTRO codigo tambem segue o caminho antigo', async () => {
      const err = await runAndCatch(403, { message: 'nada a ver', code: 'OUTRA_COISA' });

      expect(reissueToken).not.toHaveBeenCalled();
      expect(notifyWarning).toHaveBeenCalledWith('Acesso negado');
      expect(err?.status).toBe(403);
    });

    it('cai no /login quando a REEMISSAO falha', async () => {
      reissueToken = vi.fn(() => throwError(() => new Error('sem companyId')));

      const { caught, sent } = await runRecovering(driverBody);

      expect(sent).toHaveLength(1);
      expect(sessionClear).toHaveBeenCalledTimes(1);
      expect(notifyWarning).toHaveBeenCalledWith(DRIVER_IDENTITY_REAUTH_MESSAGE);
      expect(routerNavigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
      expect(caught?.status).toBe(403);
    });

    it('nao gira em circulo: requisicao JA reenviada vai direto para o /login', async () => {
      const context = new HttpContext().set(DRIVER_IDENTITY_RETRIED, true);
      const { caught, sent } = await runRecovering(driverBody, { context });

      expect(reissueToken).not.toHaveBeenCalled();
      expect(sent).toHaveLength(1);
      expect(sessionClear).toHaveBeenCalledTimes(1);
      expect(notifyWarning).toHaveBeenCalledWith(DRIVER_IDENTITY_REAUTH_MESSAGE);
      expect(caught?.status).toBe(403);
    });

    it('nao tenta reemitir quando quem falhou foi o PROPRIO select-company', async () => {
      const { caught, sent } = await runRecovering(driverBody, {
        url: 'http://localhost:8085/v1/auth/select-company/c-1',
      });

      expect(reissueToken).not.toHaveBeenCalled();
      expect(sent).toHaveLength(1);
      expect(sessionClear).not.toHaveBeenCalled();
      expect(caught?.status).toBe(403);
    });

    it('durante impersonacao nao reemite nem derruba a sessao do admin', async () => {
      impersonating = true;

      const { caught, sent } = await runRecovering(driverBody);

      expect(reissueToken).not.toHaveBeenCalled();
      expect(sent).toHaveLength(1);
      expect(sessionClear).not.toHaveBeenCalled();
      expect(routerNavigate).not.toHaveBeenCalled();
      expect(caught?.status).toBe(403);
    });

    /**
     * Regressao do desenho: `catchError` vem ANTES do `switchMap` justamente
     * para que um erro do REENVIO nao seja confundido com falha de credencial.
     */
    it('erro do reenvio NAO desloga o motorista', async () => {
      const req = new HttpRequest('GET', 'http://localhost/v1/x');
      let attempt = 0;
      const next: HttpHandlerFn = () => {
        attempt += 1;
        const isFirst = attempt === 1;
        return throwError(() => makeError(isFirst ? 403 : 500, isFirst ? driverBody : { message: 'boom' }));
      };

      const result$ = TestBed.runInInjectionContext(() => errorInterceptor(req, next));
      let caught: HttpErrorResponse | undefined;
      await lastValueFrom(
        result$.pipe(
          catchError((err: HttpErrorResponse) => {
            caught = err;
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      expect(caught?.status).toBe(500);
      expect(sessionClear).not.toHaveBeenCalled();
      expect(routerNavigate).not.toHaveBeenCalled();
    });
  });
});

/**
 * FEAT-0082 — os dois tokens de silêncio, provados NO interceptor (o spec do
 * componente mocka o serviço inteiro e não pode provar nada disto):
 * - `OWNED_HTTP_ERRORS`: sem toast de 0/403/5xx e sem rede de segurança de
 *   4xx, mas 401/token expirado CONTINUAM limpando a sessão e redirecionando;
 * - `SILENT_HTTP_ERRORS` (fire-and-forget) mantém o contrato antigo: TUDO
 *   desligado, inclusive o desvio de sessão.
 */
describe('errorInterceptor — OWNED_HTTP_ERRORS e SILENT_HTTP_ERRORS', () => {
  let sessionClear: ReturnType<typeof vi.fn>;
  let routerNavigate: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifyWarning: ReturnType<typeof vi.fn>;
  let scheduleSafetyNet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionClear = vi.fn();
    routerNavigate = vi.fn();
    notifyError = vi.fn();
    notifyWarning = vi.fn();
    scheduleSafetyNet = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        { provide: SessionService, useValue: { clear: sessionClear } },
        { provide: Router, useValue: { navigate: routerNavigate } },
        { provide: ApiErrorService, useValue: { scheduleSafetyNet, claim: vi.fn() } },
        { provide: ImpersonationService, useValue: { active: () => false, expire: vi.fn() } },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: notifyWarning,
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  });

  type Token = typeof OWNED_HTTP_ERRORS;

  async function runMarked(token: Token, status: number, body?: unknown) {
    const req = new HttpRequest('GET', 'http://localhost/v1/vehicles/plate-lookup', {
      context: new HttpContext().set(token, true),
    });
    const next: HttpHandlerFn = () =>
      throwError(
        () => new HttpErrorResponse({ status, error: body, url: 'http://localhost/v1/x' }),
      );
    const result$ = TestBed.runInInjectionContext(() => errorInterceptor(req, next));

    let caught: unknown;
    await lastValueFrom(
      result$.pipe(
        catchError((err) => {
          caught = err;
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );
    return caught as HttpErrorResponse | undefined;
  }

  it.each([501, 503])('OWNED + %s → NENHUM toast, erro re-lançado para o componente', async (status) => {
    const err = await runMarked(OWNED_HTTP_ERRORS, status, { message: 'off' });

    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(scheduleSafetyNet).not.toHaveBeenCalled();
    expect(err?.status).toBe(status);
  });

  it('OWNED + 401 → sessão CONTINUA sendo limpa e redirecionada (a diferença para o SILENT)', async () => {
    const err = await runMarked(OWNED_HTTP_ERRORS, 401);

    expect(sessionClear).toHaveBeenCalledTimes(1);
    expect(routerNavigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    expect(notifyWarning).toHaveBeenCalledWith('Sessão inválida. Faça login novamente.');
    expect(err?.status).toBe(401);
  });

  it('OWNED + TokenExpiredException → caminho de sessão expirada intacto', async () => {
    await runMarked(OWNED_HTTP_ERRORS, 401, { message: 'TokenExpiredException: JWT expired' });

    expect(sessionClear).toHaveBeenCalledTimes(1);
    expect(routerNavigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    expect(notifyWarning).toHaveBeenCalledWith('Sua sessão expirou. Faça login novamente.');
  });

  it('OWNED + 4xx de negócio → sem rede de segurança (a tela traduz sozinha)', async () => {
    const err = await runMarked(OWNED_HTTP_ERRORS, 402, { message: 'no role' });

    expect(scheduleSafetyNet).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(err?.status).toBe(402);
  });

  it('SILENT (fire-and-forget) mantém o contrato antigo: nem toast NEM desvio de sessão', async () => {
    const err = await runMarked(SILENT_HTTP_ERRORS, 401);
    expect(sessionClear).not.toHaveBeenCalled();
    expect(routerNavigate).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(err?.status).toBe(401);

    await runMarked(SILENT_HTTP_ERRORS, 500);
    expect(notifyError).not.toHaveBeenCalled();
  });
});
