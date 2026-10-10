import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { OWNED_HTTP_ERRORS } from './http-errors.context';
import { SupportTicketService } from './support-ticket.service';

describe('SupportTicketService — tickets do próprio usuário', () => {
  let service: SupportTicketService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SupportTicketService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista com GET na rota PÚBLICA de tickets (não na do backoffice), paginada', () => {
    service.listMine(1, 5).subscribe();

    const req = http.expectOne((r) => r.url === `${environment.apiUrl}/support/tickets`);
    expect(req.request.method).toBe('GET');
    expect(req.request.url).not.toContain('/admin/');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('size')).toBe('5');
    req.flush({ content: [], page: 1, size: 5, total: 0 });
  });

  it('a tela é dona do erro: sem toast, mas a sessão vencida segue com o interceptor', () => {
    service.listMine().subscribe();

    const req = http.expectOne((r) => r.url === `${environment.apiUrl}/support/tickets`);
    expect(req.request.context.get(OWNED_HTTP_ERRORS)).toBe(true);
    req.flush({ content: [], page: 0, size: 5, total: 0 });
  });

  it('abrir um ticket continua sendo o POST de sempre', () => {
    service.create({ message: 'Ajuda com o aluguel.', channel: 'EMAIL' }).subscribe();

    const req = http.expectOne(`${environment.apiUrl}/support/tickets`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });
});
