import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertSettingsService } from './alert-settings.service';
import { OWNED_HTTP_ERRORS } from './http-errors.context';
import { SessionService } from './session.service';
import type { AlertSettings } from '../types/alert-settings.types';

/**
 * Cobre `GET`/`PUT /v1/companies/current/alert-settings`:
 *  - a leitura alimenta o signal e é cacheada por empresa;
 *  - trocar de empresa (multi-tenant, mesma aba) invalida o cache — é o que
 *    dispensa um `reset()` no logout, já que `selectedCompanyId` sai junto;
 *  - o PUT é substituição completa e a resposta vira o novo estado;
 *  - a falha é reemitida para a tela decidir a mensagem;
 *  - FIX-0374: a LEITURA virou OWNER-only no backend (PR #170), então um
 *    MANAGER recebe 403 ali. O 403 é contrato, não defeito — a leitura leva
 *    `OWNED_HTTP_ERRORS` (sem toast "Acesso negado") e vira `forbidden`, não
 *    `error`. A ESCRITA continua fora do token.
 */
describe('AlertSettingsService', () => {
  const settings: AlertSettings = {
    windows: [30, 15, 7, 1],
    customized: false,
    defaultWindows: [30, 15, 7, 1],
    minWindowDays: 1,
    maxWindowDays: 365,
    maxWindowCount: 6,
  };

  let httpGet: ReturnType<typeof vi.fn>;
  let httpPut: ReturnType<typeof vi.fn>;
  let companyId: string | null;
  let service: AlertSettingsService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    companyId = 'company-1';
    httpGet = vi.fn(() => of(settings));
    httpPut = vi.fn(() => of({ ...settings, windows: [60, 10], customized: true }));

    TestBed.configureTestingModule({
      providers: [
        AlertSettingsService,
        { provide: HttpClient, useValue: { get: httpGet, put: httpPut } },
        { provide: SessionService, useValue: { getItem: () => companyId } },
      ],
    });
    service = TestBed.inject(AlertSettingsService);
  });

  it('carrega as janelas da empresa e publica no signal', () => {
    service.load().subscribe();

    expect(String(httpGet.mock.calls[0][0])).toContain('/companies/current/alert-settings');
    expect(service.settings()).toEqual(settings);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('reaproveita o cache na segunda leitura da mesma empresa', () => {
    service.load().subscribe();
    service.load().subscribe();

    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('refaz a requisição quando o chamador força', () => {
    service.load().subscribe();
    service.load(true).subscribe();

    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  /**
   * Serviço `providedIn: 'root'` sobrevive ao `sessionStorage.clear()` do
   * logout (que não recarrega a página). Chavear o cache pela empresa
   * selecionada é o que impede o próximo usuário da mesma aba de ver as janelas
   * do anterior.
   */
  it('descarta o cache quando a empresa selecionada muda', () => {
    service.load().subscribe();
    companyId = 'company-2';

    service.load().subscribe();

    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it('salva a lista inteira e adota a resposta como novo estado', () => {
    service.load().subscribe();

    service.save([60, 10]).subscribe();

    expect(httpPut.mock.calls[0][1]).toEqual({ windows: [60, 10] });
    expect(service.settings()?.windows).toEqual([60, 10]);
    expect(service.settings()?.customized).toBe(true);
  });

  it('grava a mensagem de erro da leitura e reemite a falha', () => {
    httpGet.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    const onError = vi.fn();

    service.load().subscribe({ error: onError });

    expect(service.error()).toBe('Não foi possível carregar as janelas de aviso.');
    expect(service.loading()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('não cacheia uma leitura que falhou', () => {
    httpGet.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    service.load().subscribe({ error: () => void 0 });

    service.load().subscribe();

    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(service.settings()).toEqual(settings);
    expect(service.error()).toBeNull();
  });

  it('reemite o 400 do PUT sem sujar o estado carregado', () => {
    service.load().subscribe();
    httpPut.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Janela inválida.', fieldErrors: { windows: 'Janela inválida.' } },
          }),
      ),
    );
    const onError = vi.fn();

    service.save([0]).subscribe({ error: onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(service.settings()).toEqual(settings);
  });

  /**
   * FIX-0374 — sem o token, o `errorInterceptor` dispara "Acesso negado" toda
   * vez que um MANAGER abre `/alertas`, porque o 403 é tratado antes de
   * qualquer `claim()` da tela (o `claim` só cobre a rede de segurança de 4xx).
   */
  it('marca a leitura com OWNED_HTTP_ERRORS para o 403 do MANAGER não virar toast', () => {
    service.load().subscribe();

    const context = httpGet.mock.calls[0][1]?.context;
    expect(context?.get(OWNED_HTTP_ERRORS)).toBe(true);
  });

  /** A escrita fica FORA do token: um 403 de escrita ainda é assunto do toast. */
  it('não marca a escrita com OWNED_HTTP_ERRORS', () => {
    service.save([30, 7]).subscribe();

    const context = httpPut.mock.calls[0][2]?.context;
    expect(context?.get(OWNED_HTTP_ERRORS) ?? false).toBe(false);
  });

  it('trata o 403 como ausência de permissão, não como falha de carregamento', () => {
    httpGet.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })),
    );
    const onError = vi.fn();

    service.load().subscribe({ error: onError });

    expect(service.forbidden()).toBe(true);
    expect(service.error()).toBeNull();
    expect(service.settings()).toBeNull();
    expect(service.loading()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('mantém o 500 como falha de carregamento, sem marcar forbidden', () => {
    httpGet.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );

    service.load().subscribe({ error: () => void 0 });

    expect(service.forbidden()).toBe(false);
    expect(service.error()).toBe('Não foi possível carregar as janelas de aviso.');
  });

  /** O OWNER que assume a sessão depois do MANAGER não pode herdar o 403. */
  it('limpa forbidden numa releitura bem-sucedida', () => {
    httpGet.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })),
    );
    service.load().subscribe({ error: () => void 0 });

    service.load().subscribe();

    expect(service.forbidden()).toBe(false);
    expect(service.settings()).toEqual(settings);
  });
});
