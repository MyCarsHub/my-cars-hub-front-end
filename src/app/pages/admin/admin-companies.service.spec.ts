import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCompaniesService } from './admin-companies.service';
import { environment } from '../../../environments/environment';
import type {
  AdminCompanyDetail,
  AdminCompanyListItem,
  AdminCompanyOperations,
} from '../../types/admin-company.types';

const ZERO_OPERATIONS: AdminCompanyOperations = {
  rentals: {
    total: 0,
    activeTotal: 0,
    closedTotal: 0,
    closedAmountCents: 0,
    completedTotal: 0,
    completedAmountCents: 0,
    canceledTotal: 0,
    paidAmountCents: 0,
  },
  contracts: { total: 0, generatedTotal: 0, signedTotal: 0 },
  vehicles: { total: 0, activeTotal: 0 },
  drivers: { total: 0, workingTotal: 0 },
  fines: { total: 0, pendingTotal: 0, amountCents: 0 },
  maintenances: { total: 0, costCents: 0 },
  sales: { sales: [], undos: [] },
};

const detailOf = (id: string, overrides: Partial<AdminCompanyDetail> = {}): AdminCompanyDetail => ({
  id,
  name: `Empresa ${id}`,
  documentMasked: null,
  status: 'ACTIVE',
  active: true,
  createdAt: null,
  modifiedAt: null,
  subscription: null,
  members: [],
  chargeIntegration: null,
  registration: {
    phone: null,
    email: null,
    addressStreet: null,
    addressNumber: null,
    addressComplement: null,
    addressDistrict: null,
    addressCep: null,
    addressCity: null,
    addressUf: null,
    representativeName: null,
    representativeRole: null,
  },
  operations: ZERO_OPERATIONS,
  internal: false,
  ...overrides,
});

/**
 * Nenhum método deste serviço tinha spec. A revisão do FEAT-0141 conferiu URL e
 * corpo do `updateInternal` POR LEITURA, porque os specs da página trocam o
 * serviço inteiro por um mock — então o contrato HTTP de verdade nunca foi
 * exercitado. `updateStatus` estava no mesmo buraco, e `loadDetail` também.
 */
describe('AdminCompaniesService', () => {
  const base = `${environment.apiUrl}/admin/companies`;

  let get: ReturnType<typeof vi.fn>;
  let patch: ReturnType<typeof vi.fn>;
  let service: AdminCompaniesService;

  const bodyOfLastPatch = (): Record<string, unknown> =>
    patch.mock.calls.at(-1)?.[1] as Record<string, unknown>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    get = vi.fn(() => of(detailOf('co-a')));
    patch = vi.fn(() => of(detailOf('co-a')));

    TestBed.configureTestingModule({
      providers: [AdminCompaniesService, { provide: HttpClient, useValue: { get, patch } }],
    });
    service = TestBed.inject(AdminCompaniesService);
  });

  describe('updateInternal', () => {
    it('faz PATCH em /{id}/internal', () => {
      service.updateInternal('co-7', true).subscribe();
      expect(patch.mock.calls[0][0]).toBe(`${base}/co-7/internal`);
    });

    it('manda o valor INVERTIDO que recebeu, nos dois sentidos', () => {
      service.updateInternal('co-7', true).subscribe();
      expect(bodyOfLastPatch()).toEqual({ internal: true });

      service.updateInternal('co-7', false).subscribe();
      expect(bodyOfLastPatch()).toEqual({ internal: false });
    });

    /**
     * O caso perigoso é o `false`. O backend marca o campo como `@NotNull`
     * justamente porque um booleano AUSENTE viraria `false` no unboxing e
     * DESMARCARIA a empresa em silêncio — indistinguível de uma desmarcação
     * pedida. Então não basta o valor estar certo: a CHAVE tem de existir.
     */
    it('mantém a chave internal presente mesmo quando o valor é false', () => {
      service.updateInternal('co-7', false).subscribe();
      const body = bodyOfLastPatch();
      expect(Object.keys(body)).toContain('internal');
      expect(body['internal']).not.toBeUndefined();
    });

    it('grava a resposta no detalhe e sincroniza a linha da listagem', () => {
      service['_companies'].set([
        { id: 'co-7', internal: false } as AdminCompanyListItem,
        { id: 'co-8', internal: false } as AdminCompanyListItem,
      ]);
      patch.mockReturnValue(of(detailOf('co-7', { internal: true })));

      service.updateInternal('co-7', true).subscribe();

      expect(service.detail()?.id).toBe('co-7');
      expect(service.detail()?.internal).toBe(true);
      expect(service.companies()[0].internal).toBe(true);
      expect(service.companies()[1].internal).toBe(false);
    });
  });

  describe('updateStatus', () => {
    it('faz PATCH em /{id}/status com o corpo active', () => {
      service.updateStatus('co-7', false).subscribe();
      expect(patch.mock.calls[0][0]).toBe(`${base}/co-7/status`);
      expect(bodyOfLastPatch()).toEqual({ active: false });
    });

    it('grava a resposta no detalhe e sincroniza status e active na listagem', () => {
      service['_companies'].set([
        { id: 'co-7', status: 'ACTIVE', active: true } as AdminCompanyListItem,
      ]);
      patch.mockReturnValue(of(detailOf('co-7', { status: 'SUSPENDED', active: false })));

      service.updateStatus('co-7', false).subscribe();

      expect(service.detail()?.active).toBe(false);
      expect(service.companies()[0].status).toBe('SUSPENDED');
      expect(service.companies()[0].active).toBe(false);
    });
  });

  /**
   * FIX-0457. A sequência que produzia o defeito: agir na LISTA sobre a empresa
   * A grava o detalhe de A no signal compartilhado, mesmo com a página de
   * detalhe fechada. Abrir B em seguida mostrava A até o GET responder.
   *
   * Os testes afirmam a JANELA, não o fim: a resposta de B fica pendente de
   * propósito, porque é exatamente no intervalo entre a chamada e a resposta que
   * o dado errado aparecia. Afirmar só o estado final passaria com o defeito
   * intacto.
   */
  describe('loadDetail não mostra a empresa anterior', () => {
    it('descarta o detalhe gravado por updateInternal na lista', () => {
      patch.mockReturnValue(of(detailOf('co-a')));
      service.updateInternal('co-a', true).subscribe();
      expect(service.detail()?.id).toBe('co-a');

      const pending = new Subject<AdminCompanyDetail>();
      get.mockReturnValue(pending);
      service.loadDetail('co-b').subscribe();

      expect(service.detail()).toBeNull();

      pending.next(detailOf('co-b'));
      expect(service.detail()?.id).toBe('co-b');
    });

    it('descarta o detalhe gravado por updateStatus na lista', () => {
      patch.mockReturnValue(of(detailOf('co-a')));
      service.updateStatus('co-a', false).subscribe();
      expect(service.detail()?.id).toBe('co-a');

      get.mockReturnValue(new Subject<AdminCompanyDetail>());
      service.loadDetail('co-b').subscribe();

      expect(service.detail()).toBeNull();
    });

    /**
     * O outro lado da regra, e o que impede o conserto de virar "limpa sempre":
     * recarregar a MESMA empresa mantém o que está na tela, então `reload()` e
     * uma ação disparada de dentro da própria página atualizam sem piscar para o
     * esqueleto.
     */
    it('mantém o detalhe quando o id é o mesmo', () => {
      patch.mockReturnValue(of(detailOf('co-a')));
      service.updateStatus('co-a', false).subscribe();

      get.mockReturnValue(new Subject<AdminCompanyDetail>());
      service.loadDetail('co-a').subscribe();

      expect(service.detail()?.id).toBe('co-a');
    });
  });
});
