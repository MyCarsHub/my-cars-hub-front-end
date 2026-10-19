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
    // FEAT-0347: as 5 rotas novas (espelho do FEAT-0345).
    ['POST', '/rentals/r-1/cancel'],
    ['DELETE', '/rentals/r-1'],
    ['POST', '/rentals'],
    ['POST', '/rentals/preflight'],
    ['POST', '/rentals/charge-preview'],
    // Contrato, documentos, fotos e vistoria.
    ['POST', '/rentals/r-1/contract'],
    ['POST', '/rentals/r-1/contract/mark-signed'],
    ['POST', '/rentals/r-1/contract/signature'],
    ['DELETE', '/rentals/r-1/documents/d-1'],
    ['POST', '/rentals/r-1/photos'],
    ['DELETE', '/rentals/r-1/photos/p-1'],
    ['POST', '/inspections'],
    ['POST', '/inspections/i-1/photos/FRONT'],
    ['POST', '/inspections/i-1/submit'],
    ['POST', '/inspections/i-1/approve'],
    ['POST', '/inspections/i-1/reject'],
    ['POST', '/inspections/i-1/recapture'],
    ['POST', '/rentals/r-1/activate'],
    ['POST', '/rentals/r-1/inspections/CHECKIN/generate-pdf'],
    ['POST', '/rentals/r-1/inspections/CHECKOUT/upload-pdf'],
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
    ['PATCH', '/rentals/r-1'],
    ['PUT', '/rentals'],
    ['DELETE', '/rentals'],
    ['PUT', '/rentals/r-1/cancel'],
    ['POST', '/rentals/r-1/cancel/extra'],
    ['POST', '/rentals/preflight/extra'],
    ['POST', '/rentals/r-1/complete'],
    ['POST', '/rentals/r-1/activate/extra'],
    ['POST', '/rentals/r-1/inspections/CHECKIN/other-pdf'],
    ['POST', '/rentals/r-1/inspections/generate-pdf'],
    ['PUT', '/rentals/r-1/charges/c-1/cancel'],
    ['POST', '/rentals/r-1/charges/c-1/mark-paid'],
    ['POST', '/rentals/r-1/caucao-charge/mark-paid'],
    ['POST', '/rentals/r-1/charges/c-1/cancel/extra'],
    ['PUT', '/rentals/r-1/../vehicles/v-1'],
    ['PUT', '/vehicles/v-1'],
    ['POST', '/drivers'],
    // Fora da lista de propósito: checklist e agendamentos de vistoria.
    ['PATCH', '/inspections/checklist/c-1/FRONT'],
    ['POST', '/inspection-schedules'],
    ['PUT', '/inspection-schedules/s-1'],
    ['DELETE', '/inspection-schedules/s-1'],
    ['POST', '/inspections/i-1/submit/extra'],
    ['POST', '/inspections/i-1/pdf'],
    ['POST', '/rentals/r-1/contract/extra'],
    ['DELETE', '/rentals/r-1/documents'],
    ['POST', '/inspections/i-1/photos'],
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

  it.each([
    ['POST', '/rentals/r-1/contract'],
    ['POST', '/rentals/r-1/contract/mark-signed'],
    ['POST', '/rentals/r-1/contract/signature'],
    ['DELETE', '/rentals/r-1/documents/d-1'],
    ['POST', '/rentals/r-1/photos'],
    ['DELETE', '/rentals/r-1/photos/p-1'],
    ['POST', '/inspections'],
    ['POST', '/inspections/i-1/photos/FRONT'],
    ['POST', '/inspections/i-1/submit'],
    ['POST', '/inspections/i-1/approve'],
    ['POST', '/inspections/i-1/reject'],
    ['POST', '/inspections/i-1/recapture'],
    ['POST', '/rentals/r-1/activate'],
    ['POST', '/rentals/r-1/inspections/CHECKIN/generate-pdf'],
    ['POST', '/rentals/r-1/inspections/CHECKOUT/upload-pdf'],
  ])('barra %s %s na sessão de LEITURA', async (method, path) => {
    editMode = false;

    const error = await runAndCatch(new HttpRequest(method as 'POST', `${API}${path}`, {}));

    expect(next).not.toHaveBeenCalled();
    expect(error?.status).toBe(403);
  });

  it('a mesma escrita é barrada quando a sessão é de LEITURA', async () => {
    editMode = false;

    const error = await runAndCatch(new HttpRequest('PUT', `${API}/rentals/r-1`, {}));

    expect(next).not.toHaveBeenCalled();
    expect(error?.status).toBe(403);
  });
});
