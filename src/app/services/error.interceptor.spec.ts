import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHandlerFn,
  HttpRequest,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { Router } from '@angular/router';
import { of, throwError, firstValueFrom, lastValueFrom, catchError, EMPTY } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { errorInterceptor } from './error.interceptor';
import { SessionService } from './session.service';
import { NotificationService } from './notification.service';

function makeError(status: number, body?: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: 'http://localhost/v1/x' });
}

describe('errorInterceptor', () => {
  let sessionClear: ReturnType<typeof vi.fn>;
  let routerNavigate: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifyWarning: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionClear = vi.fn();
    routerNavigate = vi.fn();
    notifyError = vi.fn();
    notifyWarning = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        { provide: SessionService, useValue: { clear: sessionClear } },
        { provide: Router, useValue: { navigate: routerNavigate } },
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
    expect(routerNavigate).toHaveBeenCalledWith(['/login']);
    expect(err?.status).toBe(401);
  });

  it('clears session and redirects to /login when the backend reports TokenExpiredException', async () => {
    const err = await runAndCatch(401, {
      code: 'TOKEN_EXPIRED',
      message: 'Sessão expirada. Faça login novamente.',
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

  it('shows generic message on 500', async () => {
    await runAndCatch(500);
    expect(notifyError).toHaveBeenCalledWith('Erro no servidor, tente novamente');
  });

  it('forwards backend message on 422', async () => {
    await runAndCatch(422, { message: 'CPF inválido' });
    expect(notifyError).toHaveBeenCalledWith('CPF inválido');
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
});
