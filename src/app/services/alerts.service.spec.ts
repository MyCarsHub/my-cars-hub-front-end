import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertsService } from './alerts.service';
import type { DocumentAlert } from '../types/notification-feed.types';

/**
 * Cobre `GET /v1/alerts/documents`:
 *  - `withinDays` viaja como query param (round-trip server-side do seletor);
 *  - a resposta alimenta o signal de cache, inclusive quando vem nula;
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

  let httpGet: ReturnType<typeof vi.fn>;
  let service: AlertsService;

  function paramsOfLastCall(): HttpParams {
    const options = httpGet.mock.calls.at(-1)?.[1] as { params: HttpParams };
    return options.params;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    httpGet = vi.fn(() => of([alert]));

    TestBed.configureTestingModule({
      providers: [AlertsService, { provide: HttpClient, useValue: { get: httpGet } }],
    });
    service = TestBed.inject(AlertsService);
  });

  it('envia withinDays como query param e usa o default de 30 dias', () => {
    service.listDocumentAlerts().subscribe();
    expect(String(httpGet.mock.calls[0][0])).toContain('/alerts/documents');
    expect(paramsOfLastCall().get('withinDays')).toBe('30');

    service.listDocumentAlerts(1).subscribe();
    expect(paramsOfLastCall().get('withinDays')).toBe('1');
  });

  it('publica a resposta no signal de cache e limpa o erro anterior', () => {
    service.listDocumentAlerts(7).subscribe();

    expect(service.documentAlerts()).toEqual([alert]);
    expect(service.error()).toBeNull();
    expect(service.loading()).toBe(false);
  });

  it('trata uma resposta nula como lista vazia', () => {
    httpGet.mockReturnValue(of(null));
    service.listDocumentAlerts().subscribe();

    expect(service.documentAlerts()).toEqual([]);
  });

  it('marca loading enquanto a requisição está em voo', () => {
    let loadingDuringRequest = false;
    httpGet.mockImplementation(() => {
      loadingDuringRequest = service.loading();
      return of([alert]);
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

    httpGet.mockReturnValue(of([alert]));
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
    service.listDocumentAlerts().subscribe();
    expect(service.documentAlerts()).toEqual([alert]);

    service.reset();

    expect(service.documentAlerts()).toEqual([]);
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
