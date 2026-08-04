import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from './api-error.service';
import { FeedbackService } from './feedback.service';
import { NotificationService } from './notification.service';
import { environment } from '../../environments/environment';

const BASE = `${environment.apiUrl}/feedback/tasks`;

/** Texto exato da regra no backend (`FeedbackTaskService.MSG_AUTHOR_SELF_VOTE`). */
const RULE = 'Autor não pode remover próprio combustível.';

/**
 * Os DELETE do roadmap usam `responseType: 'text'` porque o backend responde 204 sem
 * corpo. O efeito colateral: no caminho de ERRO o Angular não desserializa o envelope
 * — ele só roda JSON.parse quando o responseType é 'json'. O corpo chega como a string
 * literal `{"message":"..."}` e, sem tratamento, é isso que o usuário lê na tela.
 *
 * O `flush` do `HttpTestingController` reproduz isso fielmente: ele aplica
 * `_maybeConvertBody(responseType, body)`, que para 'text' faz `JSON.stringify`. Ou
 * seja, o objeto natural abaixo vira exatamente a string que a rede entrega — o teste
 * não fabrica a string à mão.
 */
describe('FeedbackService — erro de regra em rota com responseType text', () => {
  let service: FeedbackService;
  let apiErrors: ApiErrorService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        FeedbackService,
        ApiErrorService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(FeedbackService);
    apiErrors = TestBed.inject(ApiErrorService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function failUnfuel(body: Record<string, unknown>, status = 409): HttpErrorResponse {
    const captured = vi.fn();
    service.unfuel('fb-1').subscribe({ next: () => undefined, error: captured });

    const req = http.expectOne(`${BASE}/fb-1/fuel`);
    expect(req.request.method).toBe('DELETE');
    req.flush(body, { status, statusText: 'Conflict' });

    expect(captured).toHaveBeenCalledTimes(1);
    return captured.mock.calls[0][0] as HttpErrorResponse;
  }

  it('caracterização: o corpo de erro chega como string crua, não como objeto', () => {
    const err = failUnfuel({ message: RULE });

    // Se algum dia isto virar 'object', o envelope passou a ser desserializado
    // pelo Angular e a razão de existir do unwrap no parseApiError mudou.
    expect(typeof err.error).toBe('string');
    expect(err.error).toBe(JSON.stringify({ message: RULE }));
  });

  it('o usuário vê o texto da regra, nunca o corpo serializado', () => {
    const err = failUnfuel({ message: RULE });

    const shown = apiErrors.messageFor(
      err,
      'Não foi possível registrar seu voto. Tente novamente.',
    );

    expect(shown).toBe(RULE);
    expect(shown).not.toContain('{');
    expect(shown).not.toContain('"message"');
  });

  it('o fallback só entra quando o backend não mandou message', () => {
    const err = failUnfuel({}, 409);

    expect(apiErrors.messageFor(err, 'fallback da tela')).toBe('fallback da tela');
  });

  it('vale também para a exclusão da sugestão (mesmo caminho de erro)', () => {
    const locked = 'Task não pode ser removida: já saiu do backlog ou recebeu combustível.';
    const captured = vi.fn();
    service.remove('fb-1').subscribe({ next: () => undefined, error: captured });

    const req = http.expectOne(`${BASE}/fb-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: locked }, { status: 409, statusText: 'Conflict' });

    const err = captured.mock.calls[0][0] as HttpErrorResponse;
    expect(apiErrors.messageFor(err, 'Não foi possível excluir a sugestão.')).toBe(locked);
  });

  it('o voto (POST, responseType json) continua legível — sem regressão', () => {
    const captured = vi.fn();
    service.fuel('fb-1').subscribe({ next: () => undefined, error: captured });

    const req = http.expectOne(`${BASE}/fb-1/fuel`);
    expect(req.request.method).toBe('POST');
    req.flush({ message: 'Tarefa de feedback não encontrada.' }, { status: 404, statusText: 'NF' });

    const err = captured.mock.calls[0][0] as HttpErrorResponse;
    expect(apiErrors.messageFor(err, 'fallback')).toBe('Tarefa de feedback não encontrada.');
  });
});
