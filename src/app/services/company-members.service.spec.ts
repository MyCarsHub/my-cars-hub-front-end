import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyMembersService } from './company-members.service';
import { SessionService } from './session.service';
import { TenantResetRegistry } from './tenant-reset.registry';
import { environment } from '../../environments/environment';
import type { CompanyMemberResponse } from '../types/company-member.types';

/**
 * Guarda tres coisas que quebram em silencio: a URL (o `companyId` vem do TOKEN, nao do
 * espelho do sessionStorage), o cache por empresa que o `reset()` tem de zerar, e — a mais
 * importante — QUANDO a linha sai da lista local.
 */
describe('CompanyMembersService', () => {
  const COMPANY = 'co-7';
  const BASE = `${environment.apiUrl}/companies/${COMPANY}/members`;

  const manager: CompanyMemberResponse = {
    userId: 'user-gerente',
    name: 'Gerente Bruno',
    email: 'bruno@empresa.com.br',
    role: 'MANAGER',
    memberSince: '2026-03-02T12:00:00Z',
  };

  const driver: CompanyMemberResponse = { ...manager, userId: 'user-motorista', role: 'DRIVER' };

  let httpGet: ReturnType<typeof vi.fn>;
  let httpDelete: ReturnType<typeof vi.fn>;
  let service: CompanyMembersService;

  function build(companyId: string | null = COMPANY): CompanyMembersService {
    TestBed.resetTestingModule();
    httpGet = vi.fn(() => of([manager, driver]));
    httpDelete = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      providers: [
        CompanyMembersService,
        { provide: HttpClient, useValue: { get: httpGet, delete: httpDelete } },
        {
          provide: SessionService,
          useValue: { getCompanyIdFromToken: vi.fn(() => companyId) },
        },
        { provide: TenantResetRegistry, useValue: { register: vi.fn(), run: vi.fn() } },
      ],
    });
    return TestBed.inject(CompanyMembersService);
  }

  beforeEach(() => {
    service = build();
  });

  it('pede o roster da empresa do TOKEN, nao do espelho do sessionStorage', () => {
    service.list().subscribe();

    expect(httpGet).toHaveBeenCalledWith(BASE);
    expect(service.members()).toEqual([manager, driver]);
    expect(service.loaded()).toBe(true);
  });

  it('remove pelo userId, na URL da empresa ativa', () => {
    service.list().subscribe();
    service.remove('user-motorista').subscribe();

    expect(httpDelete).toHaveBeenCalledWith(`${BASE}/user-motorista`);
  });

  it('204 derruba a linha localmente, sem refazer o GET', () => {
    service.list().subscribe();
    service.remove('user-motorista').subscribe();

    expect(service.members()).toEqual([manager]);
    // O 204 nao traz roster: refazer o GET aqui gastaria uma ida para saber o que ja se sabe.
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  /**
   * MEDIUM-1 DA REVISAO — A PROPRIEDADE QUE ESTAVA CORRETA E SEM TESTE.
   *
   * A linha so sai da lista DEPOIS do 204, porque o `filter` esta dentro do `tap` do
   * sucesso. A revisao provou que a ausencia deste caso era real: movendo o `filter` para
   * fora do `tap` — remocao otimista — a suite da tela ficava 14/14 VERDE.
   *
   * O QUE A REMOCAO OTIMISTA CAUSARIA, e e a pior combinacao possivel nesta tela
   * especificamente: a pessoa DESAPARECE da lista de quem administra e CONTINUA COM ACESSO.
   * Quem administra para de ver quem precisa remover, e acredita que removeu. O backend
   * responde 404 quando a linha deixou de ser ACTIVE entre a leitura e a escrita justamente
   * para que um sucesso aqui signifique que escreveu — jogar a linha fora antes da resposta
   * desperdica essa garantia.
   */
  it('remocao que FALHA mantem a linha na lista', () => {
    service.list().subscribe();
    httpDelete.mockReturnValue(throwError(() => new Error('500')));

    service.remove('user-motorista').subscribe({ error: () => undefined });

    expect(service.members()).toEqual([manager, driver]);
  });

  it('reset zera o cache por empresa — ele nao atravessa troca de tenant', () => {
    service.list().subscribe();
    expect(service.memberCount()).toBe(2);

    service.reset();

    expect(service.members()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.memberCount()).toBe(0);
  });

  /**
   * Sem empresa no token nao existe URL para pedir. Falhar alto e deliberado: uma URL com
   * `null` bateria numa rota inexistente e voltaria 404, que a tela mostraria como "empresa
   * nao encontrada" — trocando sessao quebrada por empresa inexistente.
   */
  it('sem empresa no token NAO monta URL e nao devolve lista vazia', () => {
    const semEmpresa = build(null);

    expect(() => semEmpresa.list()).toThrow();
    expect(httpGet).not.toHaveBeenCalled();
  });
});
