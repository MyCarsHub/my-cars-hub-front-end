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
  let service: CompanySelectionService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    store = { token: 'token-da-empresa-a' };
    httpPost = vi.fn(() => of({ token: 'token-da-empresa-b' }));

    TestBed.configureTestingModule({
      providers: [
        CompanySelectionService,
        { provide: HttpClient, useValue: { post: httpPost } },
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
});
