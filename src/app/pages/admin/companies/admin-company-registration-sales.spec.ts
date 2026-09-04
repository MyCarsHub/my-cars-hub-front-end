import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminCompanyDetail } from './admin-company-detail';
import { AdminCompaniesService } from '../admin-companies.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import type {
  AdminCompanyOperations,
  AdminCompanyRegistration,
  AdminCompanySaleUndoItem,
  AdminCompanyDetail as AdminCompanyDetailDto,
} from '../../../types/admin-company.types';
import { formatBRL } from '../../../types/dashboard.types';

/**
 * FEAT-0076 — os dois blocos que faltavam na tela do admin: DADOS CADASTRAIS
 * (FIX-0244, as 11 colunas da V52) e HISTÓRICO DE VENDAS (FEAT-0075). Era por
 * falta deles que "a parte da empresa para o administrador vivia vazia".
 *
 * As garantias travadas aqui:
 *  1. cadastro PREENCHIDO aparece com os valores reais;
 *  2. cadastro VAZIO não parece quebrado — "—" por campo, mais um aviso;
 *  3. a venda aparece com valor formatado, comprador, data e autor;
 *  4. a trilha distingue desfazimento de RECUSA (falta de vaga no plano);
 *  5. empresa sem venda tem estado vazio elegante, nunca erro.
 *
 * LGPD: os fixtures usam nomes fictícios de propósito, e nada neste fluxo
 * escreve telefone/e-mail/comprador em log — a exibição é só de tela.
 */
describe('AdminCompanyDetail — cadastro e vendas (FEAT-0076)', () => {
  const EMPTY_REGISTRATION: AdminCompanyRegistration = {
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
  };

  /** Empresa recém-criada: zeros e listas vazias, nunca null (contrato). */
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

  const SALES_OPERATIONS: AdminCompanyOperations = {
    ...ZERO_OPERATIONS,
    sales: {
      sales: [
        {
          vehicleId: 'veh-1',
          vehiclePlate: 'ABC1D23',
          buyerName: 'Maria Compradora',
          saleDate: '2026-08-20',
          saleValueCents: 4_500_000,
          authorName: 'Operador Um',
          createdAt: '2026-08-20T10:00:00Z',
        },
        {
          vehicleId: 'veh-2',
          vehiclePlate: 'XYZ9K88',
          buyerName: 'Jose Comprador',
          saleDate: '2026-07-05',
          saleValueCents: 3_000_000,
          // Autor excluído: SET NULL na V74 — a linha não pode quebrar.
          authorName: null,
          createdAt: '2026-07-05T09:00:00Z',
        },
      ],
      undos: [
        {
          vehicleId: 'veh-3',
          vehiclePlate: 'QRS4T56',
          state: 'ACTIVE',
          reason: 'Comprador desistiu',
          authorName: 'Operador Dois',
          createdAt: '2026-08-25T12:00:00Z',
        },
        {
          vehicleId: 'veh-4',
          // Veículo excluído depois: a trilha não tem FK e sobrevive a ele.
          vehiclePlate: null,
          state: 'UNDO_REFUSED',
          reason: 'Sem vaga no plano',
          authorName: 'Operador Tres',
          createdAt: '2026-08-26T08:30:00Z',
        },
      ],
    },
  };

  const BASE: AdminCompanyDetailDto = {
    id: 'co-1',
    name: 'Locadora Alfa',
    documentMasked: '12.***.***/0001-**',
    status: 'ACTIVE',
    active: true,
    createdAt: '2025-01-01T00:00:00Z',
    modifiedAt: null,
    subscription: null,
    members: [],
    chargeIntegration: null,
    registration: EMPTY_REGISTRATION,
    operations: ZERO_OPERATIONS,
  };

  function render(overrides: Partial<AdminCompanyDetailDto>): HTMLElement {
    const detailValue: AdminCompanyDetailDto = { ...BASE, ...overrides };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCompanyDetail],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'co-1' })) },
        },
        {
          provide: AdminCompaniesService,
          useValue: {
            detail: signal<AdminCompanyDetailDto | null>(detailValue),
            detailLoading: signal(false),
            statusUpdating: signal(false),
            loadDetail: vi.fn().mockReturnValue(of(detailValue)),
            updateStatus: vi.fn(),
            clearDetail: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
        {
          provide: ImpersonationService,
          useValue: { start: vi.fn(), isActive: signal(false) },
        },
      ],
    });

    const fixture = TestBed.createComponent(AdminCompanyDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function blockText(host: HTMLElement, selector: string): string {
    return normalize(host.querySelector(selector)?.textContent);
  }

  /**
   * Normaliza espaços — INCLUSIVE o NBSP que o `Intl.NumberFormat` põe entre
   * "R$" e o número. Sem aplicar a MESMA normalização no valor esperado, a
   * comparação falha por um caractere invisível e o teste vira caça-fantasma.
   */
  function normalize(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * O `<dd>` que acompanha um `<dt>` com o rótulo dado — permite afirmar UM
   * campo em vez de varrer o card inteiro.
   */
  function dtValue(scope: Element, label: string): string {
    const pair = Array.from(scope.querySelectorAll('div')).find(
      (div) => normalize(div.querySelector('dt')?.textContent) === label,
    );
    return pair?.querySelector('dd')?.textContent ?? '';
  }

  /** `formatBRL` normalizado, para comparar com o texto normalizado da tela. */
  function money(cents: number): string {
    return normalize(formatBRL(cents));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------ dados cadastrais

  it('mostra contato, endereço e representante quando preenchidos', () => {
    const host = render({
      registration: {
        phone: '(11) 98765-4321',
        email: 'contato@alfa.com.br',
        addressStreet: 'Rua das Flores',
        addressNumber: '123',
        addressComplement: 'Sala 4',
        addressDistrict: 'Centro',
        addressCep: '01001-000',
        addressCity: 'Sao Paulo',
        addressUf: 'SP',
        representativeName: 'Ana Gestora',
        representativeRole: 'Diretora',
      },
    });

    const block = blockText(host, '[data-testid="company-registration"]');
    expect(block).toContain('(11) 98765-4321');
    expect(block).toContain('contato@alfa.com.br');
    expect(block).toContain('Rua das Flores');
    expect(block).toContain('Sala 4');
    expect(block).toContain('01001-000');
    expect(block).toContain('Sao Paulo');
    expect(block).toContain('Ana Gestora');
    expect(block).toContain('Diretora');
    expect(host.querySelector('[data-testid="registration-empty"]')).toBeNull();
  });

  /**
   * Preenchimento é PARCIAL por natureza (a V52 é aditiva e o PUT sem `contact`
   * não toca nas colunas). A tela mostra "—" campo a campo e continua de pé —
   * um bloco que sumisse faria o suporte achar que a tela quebrou.
   */
  it('não parece quebrada com o cadastro vazio: três seções, "—" e aviso', () => {
    const host = render({ registration: EMPTY_REGISTRATION });

    expect(host.querySelector('[data-testid="company-registration"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="registration-section"]').length).toBe(3);
    expect(host.querySelector('[data-testid="registration-empty"]')).not.toBeNull();
    expect(blockText(host, '[data-testid="company-registration"]')).toContain('—');
    // Vazio é estado normal, não erro: nenhum banner de falha.
    expect(host.querySelector('app-alert-banner')).toBeNull();
  });

  it('mostra o que existe e "—" só no que falta (preenchimento parcial)', () => {
    const host = render({
      registration: { ...EMPTY_REGISTRATION, phone: '(11) 3333-4444', addressCity: 'Campinas' },
    });

    const block = blockText(host, '[data-testid="company-registration"]');
    expect(block).toContain('(11) 3333-4444');
    expect(block).toContain('Campinas');
    expect(block).toContain('—');
    // Algo preenchido: o aviso de "nada preenchido" não aparece.
    expect(host.querySelector('[data-testid="registration-empty"]')).toBeNull();
  });

  // -------------------------------------------------------------- vendas

  it('lista as vendas vigentes com valor, comprador, data e autor', () => {
    const host = render({ operations: SALES_OPERATIONS });

    const items = host.querySelectorAll('[data-testid="sale-item"]');
    expect(items.length).toBe(2);

    const first = normalize(items[0].textContent);
    expect(first).toContain('ABC1D23');
    expect(first).toContain(money(4_500_000));
    expect(first).toContain('Maria Compradora');
    expect(first).toContain('Operador Um');

    /*
     * A DATA é afirmada no <dd> DELA, não no texto do card inteiro.
     *
     * Antes o teste fazia `toContain('20/08/2026')` sobre o card todo e passava
     * por acidente: o `createdAt` (2026-08-20T10:00:00Z) rendia a MESMA string
     * na linha "Registrada por", então a asserção continuava verde mesmo com a
     * data da venda saindo 19/08 por causa do bug de fuso. Uma asserção ampla
     * demais deixou um defeito real atravessar.
     */
    const saleDateValue = normalize(dtValue(items[0], 'Data:'));
    expect(saleDateValue).toBe('20/08/2026');

    // Autor excluído não quebra a linha: cai no "—" da tela.
    expect(normalize(items[1].textContent)).toContain('—');
  });

  it('distingue desfazimento de RECUSA por falta de vaga', () => {
    const host = render({ operations: SALES_OPERATIONS });

    const undos = host.querySelectorAll('[data-testid="sale-undo-item"]');
    expect(undos.length).toBe(2);

    const desfeita = normalize(undos[0].textContent);
    expect(desfeita).toContain('Desfeita');
    expect(desfeita).toContain('Comprador desistiu');
    expect(desfeita).toContain('Operador Dois');

    const recusada = normalize(undos[1].textContent);
    expect(recusada).toContain('Recusado');
    expect(recusada).toContain('Sem vaga no plano');
    // Veículo excluído depois: a trilha sobrevive e a tela diz isso.
    expect(recusada).toContain('Veículo excluído');
  });

  it('o consolidado ganha o grupo de vendas com o valor somado', () => {
    const host = render({ operations: SALES_OPERATIONS });

    const groups = Array.from(host.querySelectorAll('[data-testid="operation-group"]'));
    const sales = groups.find((g) => (g.textContent ?? '').includes('Vendas de veículo'));
    expect(sales).toBeTruthy();

    const salesText = normalize(sales?.textContent);
    // 45.000,00 + 30.000,00 — a soma das VIGENTES.
    expect(salesText).toContain(money(7_500_000));
    expect(salesText).toContain('Desfazimentos');
  });

  /**
   * `state` é String livre no Java: um estado NOVO não pode ser apresentado
   * como "Desfeita" (afirmaria algo que a tela não sabe). Aparece cru, neutro.
   */
  it('estado desconhecido da trilha não vira "Desfeita" — mostra o valor cru', () => {
    const host = render({
      operations: {
        ...ZERO_OPERATIONS,
        sales: {
          sales: [],
          undos: [
            {
              vehicleId: 'veh-9',
              vehiclePlate: 'NEW0X00',
              state: 'SOMETHING_NEW' as AdminCompanySaleUndoItem['state'],
              reason: 'Estado futuro',
              authorName: 'Operador Novo',
              createdAt: '2026-09-01T10:00:00Z',
            },
          ],
        },
      },
    });

    const undo = normalize(host.querySelector('[data-testid="sale-undo-item"]')?.textContent);
    expect(undo).toContain('SOMETHING_NEW');
    expect(undo).not.toContain('Desfeita');
  });

  it('empresa sem venda: estado vazio elegante, sem erro', () => {
    const host = render({ operations: ZERO_OPERATIONS });

    expect(host.querySelector('[data-testid="company-sales"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="sales-empty"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="sale-item"]').length).toBe(0);
    expect(host.querySelectorAll('[data-testid="sale-undo-item"]').length).toBe(0);
    expect(host.querySelector('app-alert-banner')).toBeNull();
  });
});
