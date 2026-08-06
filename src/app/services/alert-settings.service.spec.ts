import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertSettingsService } from './alert-settings.service';
import { SessionService } from './session.service';
import type { AlertSettings } from '../types/alert-settings.types';

/**
 * Cobre `GET`/`PUT /v1/companies/current/alert-settings`:
 *  - a leitura alimenta o signal e é cacheada por empresa;
 *  - trocar de empresa (multi-tenant, mesma aba) invalida o cache — é o que
 *    dispensa um `reset()` no logout, já que `selectedCompanyId` sai junto;
 *  - o PUT é substituição completa e a resposta vira o novo estado;
 *  - a falha é reemitida para a tela decidir a mensagem.
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
});
