import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CompanySelectionService } from './company-selection.service';
import { DriverIdentityRecoveryService } from './driver-identity-recovery.service';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { SessionService } from './session.service';

describe('DriverIdentityRecoveryService', () => {
  let companyIdFromToken: string | null;
  let select: ReturnType<typeof vi.fn>;

  function make(): DriverIdentityRecoveryService {
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: { getCompanyIdFromToken: () => companyIdFromToken } },
        { provide: CompanySelectionService, useValue: { select } },
      ],
    });
    return TestBed.inject(DriverIdentityRecoveryService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    companyIdFromToken = 'company-1';
    select = vi.fn(() => of('token-novo'));
  });

  it('reemite o token pela empresa do CLAIM do token', async () => {
    const token = await firstValueFrom(make().reissueToken());

    expect(token).toBe('token-novo');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0][0]).toBe('company-1');
  });

  /**
   * A falha desta chamada ja tem dono (o `errorInterceptor` cai no /login). Sem a
   * marca, um 403 aqui dispararia o toast generico "Acesso negado" por cima do
   * aviso de sessao renovada.
   */
  it('marca a chamada como SILENT para nao duplicar o aviso', async () => {
    await firstValueFrom(make().reissueToken());

    const context = select.mock.calls[0][1];
    expect(context?.get(SILENT_HTTP_ERRORS)).toBe(true);
  });

  /**
   * Tres requisicoes em voo recebem tres 403 ao mesmo tempo. Se cada uma pedisse
   * o proprio token, o segundo e o terceiro invalidariam o primeiro.
   */
  it('compartilha UMA reemissao entre as requisicoes que falharam juntas', async () => {
    const gate = new Subject<string>();
    select = vi.fn(() => gate.asObservable());
    const service = make();

    const first = firstValueFrom(service.reissueToken());
    const second = firstValueFrom(service.reissueToken());
    gate.next('token-novo');
    gate.complete();

    expect(await first).toBe('token-novo');
    expect(await second).toBe('token-novo');
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('pede um token novo depois que a reemissao anterior terminou', async () => {
    const service = make();
    await firstValueFrom(service.reissueToken());
    await firstValueFrom(service.reissueToken());

    expect(select).toHaveBeenCalledTimes(2);
  });

  it('erra sem chamar o backend quando o token nao tem companyId', async () => {
    companyIdFromToken = null;

    await expect(lastValueFrom(make().reissueToken())).rejects.toThrow(/companyId/);
    expect(select).not.toHaveBeenCalled();
  });

  /** Fracasso da reemissao propaga: quem chamou decide o proximo passo (o /login). */
  it('propaga o erro quando o backend recusa a reemissao', async () => {
    select = vi.fn(() => throwError(() => new Error('403 select-company')));

    await expect(lastValueFrom(make().reissueToken())).rejects.toThrow('403 select-company');
  });

  it('nao guarda uma reemissao que falhou', async () => {
    let attempt = 0;
    select = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? throwError(() => new Error('boom')) : of('token-novo');
    });
    const service = make();

    await expect(lastValueFrom(service.reissueToken())).rejects.toThrow('boom');
    expect(await firstValueFrom(service.reissueToken())).toBe('token-novo');
    expect(select).toHaveBeenCalledTimes(2);
  });
});
