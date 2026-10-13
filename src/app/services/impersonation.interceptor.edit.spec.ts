import {
  HttpContext,
  HttpErrorResponse,
  HttpHandlerFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { EMPTY, catchError, lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../environments/environment';
import { USE_ADMIN_TOKEN } from './impersonation.context';
import { impersonationInterceptor } from './impersonation.interceptor';
import { ImpersonationService } from './impersonation.service';
import { NotificationService } from './notification.service';

const API = environment.apiUrl;

describe('impersonationInterceptor — sessão de EDIÇÃO', () => {
  let editMode: boolean;
  let warning: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    editMode = true;
    warning = vi.fn();
    next = vi.fn(() => of(new HttpResponse({ status: 200 })));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ImpersonationService,
          useValue: { active: () => true, editMode: () => editMode, reconcile: vi.fn() },
        },
        { provide: NotificationService, useValue: { warning } },
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

  it.each([
    ['PUT', '/rentals/r-1'],
    ['POST', '/rentals/r-1/charges/c-1/cancel'],
    ['POST', '/rentals/r-1/caucao-charge'],
  ])('deixa passar %s %s', (method, path) => {
    run(new HttpRequest(method as 'PUT', `${API}${path}`, {})).subscribe();

    expect(next).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('ignora a query ao casar o caminho', () => {
    run(new HttpRequest('PUT', `${API}/rentals/r-1?x=1`, {})).subscribe();

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['POST', '/rentals'],
    ['DELETE', '/rentals/r-1'],
    ['PATCH', '/rentals/r-1'],
    ['PUT', '/rentals/r-1/charges/c-1/cancel'],
    ['POST', '/rentals/r-1/charges/c-1/mark-paid'],
    ['POST', '/rentals/r-1/caucao-charge/mark-paid'],
    ['POST', '/rentals/r-1/charges/c-1/cancel/extra'],
    ['PUT', '/rentals/r-1/../vehicles/v-1'],
    ['PUT', '/vehicles/v-1'],
    ['POST', '/drivers'],
  ])('recusa %s %s sem chamar a API e avisa', async (method, path) => {
    const error = await runAndCatch(new HttpRequest(method as 'PUT', `${API}${path}`, {}));

    expect(next).not.toHaveBeenCalled();
    expect(error?.status).toBe(403);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it('leitura continua passando', () => {
    run(new HttpRequest('GET', `${API}/vehicles`)).subscribe();

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('o encerramento (credencial administrativa) continua passando', () => {
    run(
      new HttpRequest('DELETE', `${API}/admin/impersonation/s1`, {
        context: new HttpContext().set(USE_ADMIN_TOKEN, true),
      }),
    ).subscribe();

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('a mesma escrita é barrada quando a sessão é de LEITURA', async () => {
    editMode = false;

    const error = await runAndCatch(new HttpRequest('PUT', `${API}/rentals/r-1`, {}));

    expect(next).not.toHaveBeenCalled();
    expect(error?.status).toBe(403);
  });
});
