import {
  HttpContext,
  HttpErrorResponse,
  HttpEvent,
  HttpEventType,
  HttpRequest,
  HttpResponse,
  HttpXhrBackend,
  provideHttpClient,
} from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { API_INTERCEPTORS } from './api-interceptors';
import { ApiErrorService } from './api-error.service';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';
import { OWNED_HTTP_ERRORS } from './http-errors.context';
import { impersonationInterceptor } from './impersonation.interceptor';
import { NotificationService } from './notification.service';
import { platformMaintenanceInterceptor } from './platform-maintenance.interceptor';
import { prerenderApiBaseInterceptor } from './prerender-api-base.interceptor';
import { XhrHttpClient } from './xhr-http-client';

const API = `${environment.apiUrl}/admin/announcements/a1/media`;

describe('XhrHttpClient (envio com progresso, mesma cadeia de interceptors)', () => {
  let sent: HttpRequest<unknown>[];
  let responses: Subject<HttpEvent<unknown>>;
  let aborted: number;
  let navigate: ReturnType<typeof vi.fn>;
  let warning: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    sent = [];
    aborted = 0;
    responses = new Subject();
    navigate = vi.fn(() => Promise.resolve(true));
    warning = vi.fn();
    error = vi.fn();
    sessionStorage.setItem('token', 'tok-123');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate, url: '/admin/novidades' } },
        { provide: NotificationService, useValue: { warning, error, success: vi.fn(), push: vi.fn() } },
        {
          // O XHR de verdade fica de fora: o stub registra a requisição e o "abort".
          provide: HttpXhrBackend,
          useValue: {
            handle: (req: HttpRequest<unknown>) =>
              new Observable<HttpEvent<unknown>>((sub) => {
                sent.push(req);
                const inner = responses.subscribe(sub);
                return () => {
                  inner.unsubscribe();
                  aborted++;
                };
              }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('usa a MESMA lista, na mesma ordem, que o provideHttpClient do app', () => {
    expect(API_INTERCEPTORS).toEqual([
      impersonationInterceptor,
      authInterceptor,
      errorInterceptor,
      prerenderApiBaseInterceptor,
      platformMaintenanceInterceptor,
    ]);
  });

  it('API: leva o token e o ngsw-bypass; fora da API: nada', () => {
    const client = TestBed.inject(XhrHttpClient);
    client.post(API, new FormData()).subscribe();
    client.get('https://abc.supabase.co/storage/v1/object/sign/x').subscribe();
    expect(sent).toHaveLength(2);
    expect(sent[0].headers.get('Authorization')).toBe('Bearer tok-123');
    expect(sent[0].params.get('ngsw-bypass')).toBe('1');
    expect(sent[1].headers.has('Authorization')).toBe(false);
    expect(sent[1].params.has('ngsw-bypass')).toBe(false);
  });

  it('entrega os eventos de progresso e a resposta', () => {
    const client = TestBed.inject(XhrHttpClient);
    const seen: HttpEvent<unknown>[] = [];
    client.post(API, new FormData(), { observe: 'events', reportProgress: true }).subscribe((e) => seen.push(e));
    expect(sent[0].reportProgress).toBe(true);
    responses.next({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    responses.next(new HttpResponse({ status: 200, body: { id: 'a1' } }));
    expect(seen.map((e) => e.type)).toEqual([HttpEventType.UploadProgress, HttpEventType.Response]);
  });

  it('desinscrever aborta o envio', () => {
    const client = TestBed.inject(XhrHttpClient);
    const sub = client.post(API, new FormData(), { observe: 'events', reportProgress: true }).subscribe();
    expect(aborted).toBe(0);
    sub.unsubscribe();
    expect(aborted).toBe(1);
  });

  it('401 passa pelo errorInterceptor: limpa a sessão e vai para o /login', () => {
    const client = TestBed.inject(XhrHttpClient);
    let failed: unknown = null;
    client.post(API, new FormData()).subscribe({ error: (e) => (failed = e) });
    responses.error(new HttpErrorResponse({ status: 401, url: API }));
    expect((failed as HttpErrorResponse).status).toBe(401);
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  it('erro de negócio com OWNED_HTTP_ERRORS chega à tela sem toast e com a mensagem do servidor', () => {
    const client = TestBed.inject(XhrHttpClient);
    let failed: unknown = null;
    client
      .post(API, new FormData(), { context: new HttpContext().set(OWNED_HTTP_ERRORS, true) })
      .subscribe({ error: (e) => (failed = e) });
    responses.error(
      new HttpErrorResponse({
        status: 400,
        url: API,
        error: { code: 'ANNOUNCEMENT_MEDIA_TOO_LARGE', message: 'A imagem passa de 5MB.' },
      }),
    );
    expect((failed as HttpErrorResponse).status).toBe(400);
    expect(TestBed.inject(ApiErrorService).messageFor(failed, 'fallback')).toBe('A imagem passa de 5MB.');
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
