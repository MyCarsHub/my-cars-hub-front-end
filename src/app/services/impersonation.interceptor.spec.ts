import {
  HttpContext,
  HttpErrorResponse,
  HttpHandlerFn,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { EMPTY, catchError, lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../environments/environment';
import { impersonationInterceptor } from './impersonation.interceptor';
import { ImpersonationService } from './impersonation.service';
import { NotificationService } from './notification.service';
import {
  IMPERSONATION_ERROR_CODES,
  IMPERSONATION_READ_ONLY_MESSAGE,
  USE_ADMIN_TOKEN,
} from './impersonation.context';

const API = `${environment.apiUrl}/vehicles`;

describe('impersonationInterceptor', () => {
  let active: boolean;
  let reconcile: ReturnType<typeof vi.fn>;
  let warning: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    active = true;
    reconcile = vi.fn();
    warning = vi.fn();
    next = vi.fn(() => of(new HttpResponse({ status: 200 })));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ImpersonationService,
          useValue: { active: () => active, reconcile },
        },
        {
          provide: NotificationService,
          useValue: { warning, error: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    });
  });

  function run(req: HttpRequest<unknown>) {
    return TestBed.runInInjectionContext(() =>
      impersonationInterceptor(req, next as unknown as HttpHandlerFn),
    );
  }

  async function runAndCatch(req: HttpRequest<unknown>) {
    let caught: unknown;
    await lastValueFrom(
      run(req).pipe(
        catchError((err) => {
          caught = err;
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );
    return caught as HttpErrorResponse | undefined;
  }

  it('bloqueia a escrita ANTES de sair do browser e explica que é a sessão somente leitura', async () => {
    const error = await runAndCatch(new HttpRequest('POST', API, {}));

    expect(next).not.toHaveBeenCalled();
    expect(error?.status).toBe(403);
    expect((error?.error as { code?: string }).code).toBe(IMPERSONATION_ERROR_CODES.readOnly);
    expect(warning).toHaveBeenCalledWith(IMPERSONATION_READ_ONLY_MESSAGE);
  });

  it.each(['PUT', 'PATCH', 'DELETE'] as const)('bloqueia %s também', async (method) => {
    await runAndCatch(new HttpRequest('POST', API, {}).clone({ method }));
    expect(next).not.toHaveBeenCalled();
  });

  it('deixa a leitura passar', () => {
    run(new HttpRequest('GET', API)).subscribe();
    expect(next).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('deixa passar o encerramento da sessão, que é mutação por definição', () => {
    const req = new HttpRequest('DELETE', `${environment.apiUrl}/admin/impersonation/s1`, {
      context: new HttpContext().set(USE_ADMIN_TOKEN, true),
    });

    run(req).subscribe();

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('não interfere em requisição de terceiro (fora da API)', async () => {
    run(new HttpRequest('POST', 'https://storage.example.com/upload', {})).subscribe();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('não interfere quando não há sessão de impersonação', () => {
    active = false;
    run(new HttpRequest('POST', API, {})).subscribe();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reconcilia o banner com os cabeçalhos que o servidor expõe', () => {
    next = vi.fn(() =>
      of(
        new HttpResponse({
          status: 200,
          headers: new HttpHeaders({
            'X-Impersonation': 'true',
            'X-Impersonated-Company-Id': 'co-9',
          }),
        }),
      ),
    );

    run(new HttpRequest('GET', API)).subscribe();

    expect(reconcile).toHaveBeenCalledWith('co-9');
  });

  it('ignora resposta sem o cabeçalho — ausência é ambígua, não é prova', () => {
    run(new HttpRequest('GET', API)).subscribe();
    expect(reconcile).not.toHaveBeenCalled();
  });

  /**
   * VÃO DE COBERTURA — login DEPOIS de a sessão morrer.
   *
   * O bloqueio por método não tinha exceção para `/auth/**`. Com um estado de
   * impersonação órfão (o que acontecia sempre que a sessão era zerada por um
   * caminho que não o `logout()`), o admin era mandado para a tela de login,
   * digitava a senha e o próprio interceptor devolvia 403 "Sessão somente
   * leitura" — sem nenhuma saída na aba. Recuperar acesso não pode depender de
   * a limpeza ter sido feita direito.
   */
  describe('operações de credencial nunca são barradas', () => {
    it.each([
      ['/auth/login'],
      ['/auth/signup'],
      ['/auth/oauth-exchange'],
      ['/auth/forgot-password'],
    ])('deixa passar POST %s mesmo com sessão ativa', (path) => {
      run(new HttpRequest('POST', `${environment.apiUrl}${path}`, {})).subscribe();

      expect(next).toHaveBeenCalledTimes(1);
      expect(warning).not.toHaveBeenCalled();
    });

    /**
     * A única exceção da exceção: trocar de empresa reescreveria o token da
     * sessão ativa e faria o banner apontar uma empresa enquanto o resto da
     * interface aponta outra.
     */
    it('continua barrando POST /auth/select-company — não é credencial, é troca de tenant', async () => {
      const error = await runAndCatch(
        new HttpRequest('POST', `${environment.apiUrl}/auth/select-company/co-9`, {}),
      );

      expect(next).not.toHaveBeenCalled();
      expect(error?.status).toBe(403);
    });
  });

  /**
   * `USE_ADMIN_TOKEN` é um booleano de contexto sem amarração de URL. Sem a
   * checagem de caminho, uma requisição futura marcada por engano viraria um
   * escape genérico do bloqueio de escrita — em qualquer rota.
   */
  it('USE_ADMIN_TOKEN fora de /admin/** NÃO isenta do bloqueio', async () => {
    const req = new HttpRequest('POST', API, {}, {
      context: new HttpContext().set(USE_ADMIN_TOKEN, true),
    });

    const error = await runAndCatch(req);

    expect(next).not.toHaveBeenCalled();
    expect(error?.status).toBe(403);
  });
});
