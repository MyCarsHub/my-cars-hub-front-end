import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlogService } from './blog.service';
import { OWNED_HTTP_ERRORS } from '../../services/http-errors.context';
import { errorInterceptor } from '../../services/error.interceptor';
import { ApiErrorService } from '../../services/api-error.service';
import { ImpersonationService } from '../../services/impersonation.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';

/**
 * FIX-0325 — o servico e COMPARTILHADO entre o blog publico e o admin.
 *
 * As duas telas publicas passam a ser donas dos proprios erros, entao as duas
 * chamadas publicas levam `OWNED_HTTP_ERRORS`. As administrativas NAO podem
 * levar: aquelas telas ja migraram para o caminho compartilhado e contam com o
 * toast do interceptor. Marcar o servico inteiro mudaria o comportamento delas
 * em silencio — por isso o escopo do token e o teste que o prende.
 */
describe('BlogService — escopo do OWNED_HTTP_ERRORS (FIX-0325)', () => {
  let http: HttpTestingController;
  let service: BlogService;
  let notifyError: ReturnType<typeof vi.fn>;
  let scheduleSafetyNet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notifyError = vi.fn();
    scheduleSafetyNet = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { clear: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ApiErrorService, useValue: { scheduleSafetyNet, claim: vi.fn() } },
        { provide: ImpersonationService, useValue: { active: () => false, expire: vi.fn() } },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(BlogService);
  });

  /** O contexto que o interceptor le, lido do proprio request emitido. */
  function ownedOf(matcher: (url: string) => boolean): boolean {
    const req = http.expectOne((r) => matcher(r.url));
    const owned = req.request.context.get(OWNED_HTTP_ERRORS);
    req.flush({ content: [], page: 0, size: 12, total: 0 });
    return owned;
  }

  it('marca a listagem publica', () => {
    service.listPublished().subscribe();
    expect(ownedOf((u) => u.endsWith('/blog'))).toBe(true);
  });

  it('marca a busca publica por slug', () => {
    service.findBySlug('um-post').subscribe();
    expect(ownedOf((u) => u.endsWith('/blog/um-post'))).toBe(true);
  });

  it('NAO marca a listagem administrativa', () => {
    service.listAdmin().subscribe();
    expect(ownedOf((u) => u.includes('/admin/blog'))).toBe(false);
  });

  it('NAO marca a busca administrativa por id', () => {
    service.findByIdAdmin('abc').subscribe();
    expect(ownedOf((u) => u.includes('/admin/blog/abc'))).toBe(false);
  });

  /**
   * O efeito que o token existe para produzir: numa falha de rede a chamada
   * publica nao toasta, e a administrativa continua toastando.
   */
  it('falha de rede: a publica nao toasta, a administrativa toasta', () => {
    service.listPublished().subscribe({ error: () => undefined });
    http.expectOne((r) => r.url.endsWith('/blog')).error(new ProgressEvent('error'), { status: 0 });
    expect(notifyError).not.toHaveBeenCalled();

    service.listAdmin().subscribe({ error: () => undefined });
    http.expectOne((r) => r.url.includes('/admin/blog')).error(new ProgressEvent('error'), { status: 0 });
    expect(notifyError).toHaveBeenCalledWith('Sem conexão com o servidor.');
  });

  it('4xx na publica nao agenda a rede de seguranca; na administrativa agenda', () => {
    service.findBySlug('sumiu').subscribe({ error: () => undefined });
    http.expectOne((r) => r.url.endsWith('/blog/sumiu')).flush('', { status: 404, statusText: 'Not Found' });
    expect(scheduleSafetyNet).not.toHaveBeenCalled();

    service.findByIdAdmin('xyz').subscribe({ error: () => undefined });
    http.expectOne((r) => r.url.includes('/admin/blog/xyz')).flush('', { status: 404, statusText: 'Not Found' });
    expect(scheduleSafetyNet).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    http.verify();
  });
});
