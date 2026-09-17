import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanySelectionService } from './company-selection.service';
import { SessionService } from './session.service';
import { environment } from '../../environments/environment';

/**
 * O backend resolve a empresa pelo claim `companyId` do TOKEN. Trocar de empresa sem
 * trocar o token é o mesmo que não trocar — daí os dois contratos protegidos aqui: o
 * token novo é persistido antes de qualquer navegação, e uma resposta sem token é
 * FALHA (seguir em frente deixaria a interface afirmando uma empresa e o servidor
 * entregando dados de outra).
 */
describe('CompanySelectionService', () => {
  let store: Record<string, string>;
  let httpPost: ReturnType<typeof vi.fn>;
  let httpGet: ReturnType<typeof vi.fn>;
  let service: CompanySelectionService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    store = { token: 'token-da-empresa-a' };
    httpPost = vi.fn(() => of({ token: 'token-da-empresa-b' }));
    httpGet = vi.fn(() => of({ companies: [] }));

    TestBed.configureTestingModule({
      providers: [
        CompanySelectionService,
        { provide: HttpClient, useValue: { post: httpPost, get: httpGet } },
        {
          provide: SessionService,
          useValue: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            setToken: (token: string) => {
              store['token'] = token;
            },
            getToken: () => store['token'] ?? null,
          },
        },
      ],
    });
    service = TestBed.inject(CompanySelectionService);
  });

  it('pede o token da empresa escolhida e persiste antes de emitir', () => {
    let emitted: string | null = null;
    service.select('company-b').subscribe((token) => (emitted = token));

    expect(httpPost).toHaveBeenCalledWith(
      `${environment.apiUrl}/auth/select-company/company-b`,
      {},
    );
    expect(store['token']).toBe('token-da-empresa-b');
    expect(emitted).toBe('token-da-empresa-b');
  });

  it('resposta sem token é falha e não toca na sessão', () => {
    httpPost.mockReturnValue(of({}));
    const error = vi.fn();

    service.select('company-b').subscribe({ next: () => {}, error });

    expect(error).toHaveBeenCalled();
    expect(store['token']).toBe('token-da-empresa-a');
  });

  /**
   * FIX-0363 — a lista de empresas era um SNAPSHOT do login. Quem aceitava um
   * convite depois nao via a empresa nova ate deslogar; com convites em
   * producao, esse virou o caminho normal.
   */
  describe('refreshCompaniesFromMe', () => {
    const companies = [
      { companyId: 'c-1', companyName: 'Locadora A', role: 'OWNER' },
      { companyId: 'c-2', companyName: 'Locadora B', role: 'DRIVER' },
    ];

    it('le as empresas de /auth/me e regrava userCompanies', () => {
      httpGet = vi.fn(() => of({ companies }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CompanySelectionService,
          { provide: HttpClient, useValue: { post: httpPost, get: httpGet } },
          {
            provide: SessionService,
            useValue: {
              getItem: (key: string) => store[key] ?? null,
              setItem: (key: string, value: string) => {
                store[key] = value;
              },
              setToken: (token: string) => {
                store['token'] = token;
              },
              getToken: () => store['token'] ?? null,
            },
          },
        ],
      });
      const svc = TestBed.inject(CompanySelectionService);

      let emitted: unknown;
      svc.refreshCompaniesFromMe().subscribe((c) => (emitted = c));

      expect(String(httpGet.mock.calls[0][0])).toBe(`${environment.apiUrl}/auth/me`);
      expect(JSON.parse(store['userCompanies'])).toEqual(companies);
      expect(emitted).toEqual(companies);
    });

    /**
     * Resposta vazia/inesperada NAO apaga o snapshot: o seletor voltaria para
     * "Sem Empresa" logo depois de uma troca bem-sucedida. Foi o spec da
     * `layout.store` que pegou isto.
     */
    /**
     * `companies` numa forma inesperada (uma string) tem `.length` e passaria
     * pela guarda de lista vazia medindo CARACTERES — o valor sujo entraria no
     * armazenamento como se fosse a lista de empresas.
     */
    it('ignora um companies que nao e array', () => {
      store['userCompanies'] = JSON.stringify([
        { companyId: 'c-1', companyName: 'Locadora A', role: 'OWNER' },
      ]);
      httpGet = vi.fn(() => of({ companies: 'OWNER' }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CompanySelectionService,
          { provide: HttpClient, useValue: { post: httpPost, get: httpGet } },
          {
            provide: SessionService,
            useValue: {
              getItem: (key: string) => store[key] ?? null,
              setItem: (key: string, value: string) => {
                store[key] = value;
              },
              setToken: (token: string) => {
                store['token'] = token;
              },
              getToken: () => store['token'] ?? null,
            },
          },
        ],
      });

      let emitted: unknown;
      TestBed.inject(CompanySelectionService)
        .refreshCompaniesFromMe()
        .subscribe((c) => (emitted = c));

      expect(emitted).toEqual([]);
      expect(JSON.parse(store['userCompanies'])).toEqual([
        { companyId: 'c-1', companyName: 'Locadora A', role: 'OWNER' },
      ]);
    });

    it('nao sobrescreve a lista quando /auth/me vem sem companies', () => {
      store['userCompanies'] = JSON.stringify([
        { companyId: 'c-1', companyName: 'Locadora A', role: 'OWNER' },
      ]);

      service.refreshCompaniesFromMe().subscribe();

      expect(JSON.parse(store['userCompanies'])).toEqual([
        { companyId: 'c-1', companyName: 'Locadora A', role: 'OWNER' },
      ]);
    });
  });
});
