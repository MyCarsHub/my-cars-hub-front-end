import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertsService } from './alerts.service';
import type { DocumentAlert } from '../types/notification-feed.types';

/**
 * Cobre `GET /v1/alerts/documents`:
 *  - `withinDays`, `page` e `size` viajam como query params;
 *  - o ENVELOPE paginado (`content`/`page`/`size`/`total`) alimenta os signals,
 *    inclusive quando a resposta vem nula;
 *  - `loading` sobe na chamada e desce no finalize (sucesso E erro);
 *  - o erro grava a mensagem no signal E é reemitido para quem assinou.
 */
describe('AlertsService', () => {
  const alert: DocumentAlert = {
    type: 'CNH_DUE_SOON',
    typeLabel: 'CNH',
    severity: 'DANGER',
    title: 'CNH de João vence em 3 dias',
    subtitle: 'Motorista',
    entityType: 'DRIVER',
    entityId: 'd-1',
    dueDate: '2026-08-01',
    daysRemaining: 3,
    actionUrl: '/motoristas/d-1',
  };

  const ipvaAlert: DocumentAlert = {
    type: 'IPVA_DUE_SOON',
    typeLabel: 'IPVA a vencer',
    severity: 'DANGER',
    title: 'IPVA do ABC1D23 vence em 2 dias',
    subtitle: 'IPVA — R$ 1.240,00',
    entityType: 'VEHICLE',
    entityId: 'v-9',
    dueDate: '2026-08-07',
    daysRemaining: 2,
    actionUrl: '/veiculos/v-9',
  };

  const envelope = (content: DocumentAlert[], page = 0, size = 20, total = content.length) => ({
    content,
    page,
    size,
    total,
  });

  let httpGet: ReturnType<typeof vi.fn>;
  let service: AlertsService;

  function paramsOfLastCall(): HttpParams {
    const options = httpGet.mock.calls.at(-1)?.[1] as { params: HttpParams };
    return options.params;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    httpGet = vi.fn(() => of(envelope([alert])));

    TestBed.configureTestingModule({
      providers: [AlertsService, { provide: HttpClient, useValue: { get: httpGet } }],
    });
    service = TestBed.inject(AlertsService);
  });

  /**
   * O default deixou de ser 30 fixo: sem `withinDays` o backend usa a MAIOR
   * janela configurada pela empresa. Mandar 30 por conta própria passaria por
   * cima da configuração de quem escolheu outra coisa.
   */
  it('omite withinDays quando não informado, deixando a janela por conta do backend', () => {
    service.listDocumentAlerts().subscribe();
    expect(String(httpGet.mock.calls[0][0])).toContain('/alerts/documents');
    expect(paramsOfLastCall().has('withinDays')).toBe(false);
  });

  it('envia withinDays como query param quando a página escolhe a janela', () => {
    service.listDocumentAlerts(1).subscribe();
    expect(paramsOfLastCall().get('withinDays')).toBe('1');

    service.listDocumentAlerts(90).subscribe();
    expect(paramsOfLastCall().get('withinDays')).toBe('90');
  });

  it('envia page e size, com o default de 20 por página', () => {
    service.listDocumentAlerts().subscribe();
    expect(paramsOfLastCall().get('page')).toBe('0');
    expect(paramsOfLastCall().get('size')).toBe('20');

    service.listDocumentAlerts(7, 3, 50).subscribe();
    expect(paramsOfLastCall().get('page')).toBe('3');
    expect(paramsOfLastCall().get('size')).toBe('50');
  });

  it('lê o envelope paginado — content vira a lista, page/size/total viram signals', () => {
    httpGet.mockReturnValue(of(envelope([alert, ipvaAlert], 2, 20, 47)));

    service.listDocumentAlerts(30, 2).subscribe();

    expect(service.documentAlerts()).toEqual([alert, ipvaAlert]);
    expect(service.page()).toBe(2);
    expect(service.size()).toBe(20);
    expect(service.total()).toBe(47);
    expect(service.error()).toBeNull();
    expect(service.loading()).toBe(false);
  });

  it('preserva o alerta de IPVA com typeLabel, valor no subtitle e rota do veículo', () => {
    httpGet.mockReturnValue(of(envelope([ipvaAlert])));

    service.listDocumentAlerts().subscribe();

    const [received] = service.documentAlerts();
    expect(received.type).toBe('IPVA_DUE_SOON');
    expect(received.typeLabel).toBe('IPVA a vencer');
    expect(received.subtitle).toContain('R$ 1.240,00');
    expect(received.actionUrl).toBe('/veiculos/v-9');
  });

  it('trata uma resposta nula como lista vazia', () => {
    httpGet.mockReturnValue(of(null));
    service.listDocumentAlerts().subscribe();

    expect(service.documentAlerts()).toEqual([]);
    expect(service.total()).toBe(0);
  });

  it('trata um envelope sem content como lista vazia', () => {
    httpGet.mockReturnValue(of({ page: 0, size: 20, total: 0 }));
    service.listDocumentAlerts().subscribe();

    expect(service.documentAlerts()).toEqual([]);
  });

  it('marca loading enquanto a requisição está em voo', () => {
    let loadingDuringRequest = false;
    httpGet.mockImplementation(() => {
      loadingDuringRequest = service.loading();
      return of(envelope([alert]));
    });

    service.listDocumentAlerts().subscribe();

    expect(loadingDuringRequest).toBe(true);
    expect(service.loading()).toBe(false);
  });

  it('grava a mensagem de erro, reemite a falha e ainda assim baixa o loading', () => {
    httpGet.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );

    const onError = vi.fn();
    service.listDocumentAlerts(15).subscribe({ error: onError });

    expect(service.error()).toBe('Não foi possível carregar os alertas de vencimento.');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(HttpErrorResponse);
    expect(service.loading()).toBe(false);
  });

  it('limpa o erro de uma tentativa anterior ao recarregar com sucesso', () => {
    httpGet.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    service.listDocumentAlerts().subscribe({ error: () => void 0 });
    expect(service.error()).not.toBeNull();

    httpGet.mockReturnValue(of(envelope([alert])));
    service.listDocumentAlerts().subscribe();

    expect(service.error()).toBeNull();
    expect(service.documentAlerts()).toEqual([alert]);
  });

  /**
   * Serviço root sobrevive ao `sessionStorage.clear()` do logout (que não
   * recarrega a página): sem `reset()` o próximo usuário da mesma aba veria os
   * alertas do anterior.
   */
  it('reset devolve o cache ao estado inicial', () => {
    httpGet.mockReturnValue(of(envelope([alert], 2, 20, 47)));
    service.listDocumentAlerts(30, 2).subscribe();
    expect(service.documentAlerts()).toEqual([alert]);

    service.reset();

    expect(service.documentAlerts()).toEqual([]);
    expect(service.page()).toBe(0);
    expect(service.size()).toBe(20);
    expect(service.total()).toBe(0);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('reset limpa também a mensagem de erro herdada', () => {
    httpGet.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    service.listDocumentAlerts().subscribe({ error: () => void 0 });
    expect(service.error()).not.toBeNull();

    service.reset();

    expect(service.error()).toBeNull();
  });
});
