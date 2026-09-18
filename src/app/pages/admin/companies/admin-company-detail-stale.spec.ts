import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import type {
  AdminCompanyDetail as AdminCompanyDetailDto,
  AdminCompanyOperations,
} from '../../../types/admin-company.types';

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

const ALFA = 'Locadora Alfa';
const BETA = 'Locadora Beta';

const company = (id: string, name: string): AdminCompanyDetailDto => ({
  id,
  name,
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
});

/**
 * FIX-0457 — o detalhe de uma empresa aparecendo sob o cabeçalho de outra.
 *
 * A sequência é o defeito, não o estado final: agir na LISTA sobre a empresa A
 * grava o detalhe de A no signal compartilhado do serviço, mesmo com a página de
 * detalhe fechada; abrir B em seguida renderizava A até o GET de B responder,
 * porque o template só mostra o esqueleto enquanto `!detail()`.
 *
 * Por isso a resposta de B fica PENDENTE aqui. É nesse intervalo — e só nele —
 * que o dado errado aparecia. Um teste que resolvesse o GET antes de olhar a
 * tela passaria com o defeito inteiro no lugar.
 *
 * E por isso o serviço é o REAL, com apenas o `HttpClient` trocado: os outros
 * specs desta página substituem o serviço por um mock, que é exatamente o que
 * deixou este defeito invisível — um mock não tem o signal compartilhado que
 * causa o vazamento.
 */
describe('AdminCompanyDetail — não mostra a empresa anterior', () => {
  let get: ReturnType<typeof vi.fn>;
  let patch: ReturnType<typeof vi.fn>;
  let service: AdminCompaniesService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    get = vi.fn();
    patch = vi.fn();

    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: HttpClient, useValue: { get, patch } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'co-b' })) },
        },
        {
          provide: NotificationService,
          useValue: {
            error: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            push: vi.fn(),
          },
        },
        {
          provide: ImpersonationService,
          useValue: { start: vi.fn(), active: () => false },
        },
      ],
    });
    service = TestBed.inject(AdminCompaniesService);
  });

  /** Abre a página de `co-b` com o GET ainda pendente e devolve o texto na tela. */
  function openDetailWithPendingLoad(): { text: () => string; resolve: () => void } {
    const pending = new Subject<AdminCompanyDetailDto>();
    get.mockReturnValue(pending);

    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    return {
      text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
      resolve: () => {
        pending.next(company('co-b', BETA));
        pending.complete();
        fixture.detectChanges();
      },
    };
  }

  it('não mostra a empresa marcada como interna na lista enquanto carrega a outra', () => {
    patch.mockReturnValue(of(company('co-a', ALFA)));
    service.updateInternal('co-a', true).subscribe();
    expect(service.detail()?.name).toBe(ALFA);

    const page = openDetailWithPendingLoad();

    expect(page.text()).not.toContain(ALFA);

    page.resolve();
    expect(page.text()).toContain(BETA);
  });

  it('não mostra a empresa suspensa na lista enquanto carrega a outra', () => {
    patch.mockReturnValue(of(company('co-a', ALFA)));
    service.updateStatus('co-a', false).subscribe();
    expect(service.detail()?.name).toBe(ALFA);

    const page = openDetailWithPendingLoad();

    expect(page.text()).not.toContain(ALFA);

    page.resolve();
    expect(page.text()).toContain(BETA);
  });

  /**
   * O que deve aparecer no lugar: o esqueleto. Sem esta afirmação, uma página
   * que renderizasse um branco silencioso — ou que quebrasse — também passaria
   * nos dois testes acima, já que ambos só dizem o que NÃO pode estar lá.
   */
  it('mostra o esqueleto de carregamento no lugar', () => {
    patch.mockReturnValue(of(company('co-a', ALFA)));
    service.updateInternal('co-a', true).subscribe();

    const pending = new Subject<AdminCompanyDetailDto>();
    get.mockReturnValue(pending);
    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.animate-pulse')).not.toBeNull();
  });
});
