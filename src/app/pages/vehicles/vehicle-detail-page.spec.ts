import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, NEVER, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleDetail } from './vehicle-detail';
import { RentalService } from '../rentals/rental.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import type { GerenciaFinanceChunk, GerenciaSummary } from '../../types/gerencia-summary.types';
import type { RentalChargeDto, RentalListItemDto } from '../../types/rental.types';
import type { Vehicle } from '../../types/vehicle.types';
import type {
  VehiclePendencia,
  VehiclePendenciaType,
} from '../../types/vehicle-pendencia.types';

/** A página única do carro: segmentos, os dois vazios, pendências e o que cada falha deixa em pé. */
describe('VehicleDetail, página única', () => {
  const VEHICLE_ID = 'veh-1';

  const baseVehicle: Vehicle = {
    id: VEHICLE_ID,
    companyId: 'co-1',
    plate: 'RTA4B21',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearManufacture: 2023,
    yearModel: 2024,
    chassis: '9BD358A1NPYL12345',
    hodometer: 48_210,
    licensingExpiration: '2026-11-05',
    renavam: '01234567890',
    color: 'Prata',
    purchaseDate: '2026-01-10',
    purchasePrice: 7_200_000,
    ipvaAmount: 216_000,
    ipvaDueDate: '2026-11-10',
    ipvaStatus: 'PENDING',
    ipvaExpired: false,
    status: 'RENTED',
    fuel: null,
    activeFinancing: null,
    sale: null,
    createdDate: '2026-03-02',
    modifyDate: '2026-10-12',
  };

  const finance: GerenciaFinanceChunk = {
    purchaseCostCents: 7_200_000,
    totalMaintenanceExpenseCents: 184_000,
    totalFinancingPaidCents: 1_160_000,
    totalRentalRevenueCents: 1_885_000,
    totalRentalReceivedCents: 1_365_000,
    totalInvestedCents: 3_344_000,
    saleValueCents: null,
    saleDate: null,
    resultCents: -1_459_000,
    resultReceivedCents: -1_979_000,
    financingDataIncomplete: false,
    financingPayoffUnknown: false,
    financed: true,
    downPaymentCents: 2_000_000,
    purchasePriceMissing: false,
  };

  const summaryOf = (f: Partial<GerenciaFinanceChunk> = {}): GerenciaSummary =>
    ({
      vehicle: {},
      fines: { openCount: 0, openAmountCents: 0 },
      maintenances: { openCount: 9, nextServiceDate: null },
      activeFinancing: null,
      licensing: { expiration: null, expiringSoon: false, expired: false },
      finance: { ...finance, ...f },
      dates: {},
    }) as unknown as GerenciaSummary;

  const pendencia = (over: Partial<VehiclePendencia> = {}): VehiclePendencia => ({
    type: 'FINE',
    id: `p-${Math.random()}`,
    targetId: 't-1',
    description: 'Excesso de velocidade',
    dueDate: '2026-10-24',
    amountCents: 19_523,
    daysUntilDue: -6,
    urgency: 'OVERDUE',
    dueHodometer: null,
    ...over,
  });

  const activeRental: RentalListItemDto = {
    id: 'r-1',
    vehicleId: VEHICLE_ID,
    driverId: 'd-1',
    driverName: 'Carlos Mendes',
    startDate: '2026-10-01',
    endDate: '2099-12-31',
    totalAmount: 1_885_000,
    caucaoAmount: 0,
    status: 'ACTIVE',
    billingFrequency: 'WEEKLY',
  };

  const charge = (over: Partial<RentalChargeDto>): RentalChargeDto =>
    ({
      id: 'c-1',
      kind: 'RENTAL_PERIOD',
      amount: 65_000,
      status: 'PENDING',
      dueDate: '2026-11-05',
      ...over,
    }) as RentalChargeDto;

  interface Options {
    vehicle?: Vehicle;
    summary?: Observable<GerenciaSummary>;
    pendencias?: Observable<VehiclePendencia[]>;
    active?: RentalListItemDto | null;
    reserved?: Partial<RentalListItemDto>[];
    charges?: RentalChargeDto[];
    completed?: Partial<RentalListItemDto>[];
    rentalFails?: boolean;
    detailFails?: boolean;
    aba?: string;
  }

  let fixture: ComponentFixture<VehicleDetail>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let list: ReturnType<typeof vi.fn>;
  let sharedList: ReturnType<typeof vi.fn>;
  let getById: ReturnType<typeof vi.fn>;
  let getPendencias: ReturnType<typeof vi.fn>;
  let getGerenciaSummary: ReturnType<typeof vi.fn>;
  let claim: ReturnType<typeof vi.fn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = host()): string =>
    (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const panel = (id: 'veiculo' | 'gerencia') =>
    host().querySelector<HTMLElement>(`#vehicle-panel-${id}`)!;
  const tab = (label: string) =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) =>
      text(b).startsWith(label),
    )!;
  const badge = () => tab('Gerência').querySelector('app-count-badge');
  const row = (type: VehiclePendenciaType) =>
    host().querySelector<HTMLAnchorElement>(`a[appListRow][data-pendencia="${type}"]`)!;

  async function setup(options: Options = {}): Promise<void> {
    const {
      vehicle = baseVehicle,
      summary = of(summaryOf()),
      pendencias = of([]),
      active = null,
      reserved = [],
      charges = [],
      completed = [],
      rentalFails = false,
      detailFails = false,
      aba,
    } = options;

    query = new BehaviorSubject(convertToParamMap(aba ? { aba } : {}));
    getGerenciaSummary = vi.fn(() => summary);
    getPendencias = vi.fn(() => pendencias);
    claim = vi.fn();
    list = vi.fn((_id: string, status: string) => {
      if (rentalFails) return throwError(() => new HttpErrorResponse({ status: 500 }));
      const byStatus: Record<string, Partial<RentalListItemDto>[]> = {
        ACTIVE: active ? [active] : [],
        RESERVED: reserved,
        COMPLETED: completed,
      };
      const content = byStatus[status] ?? [];
      return of({ content, page: 0, size: 1, total: content.length });
    });
    sharedList = vi.fn();
    getById = vi.fn(() =>
      detailFails
        ? throwError(() => new HttpErrorResponse({ status: 500 }))
        : of({ periodRate: 65_000, charges }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: () => VEHICLE_ID } },
            queryParamMap: query.asObservable(),
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            getOne: vi.fn(() => of(vehicle)),
            getGerenciaSummary,
            getPendencias,
            listRentals: list,
            listDocuments: vi.fn(() => of([])),
          },
        },
        { provide: RentalService, useValue: { list: sharedList, getById } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: { claim, messageFor: (_: unknown, fallback?: string) => fallback ?? '' },
        },
      ],
    });

    fixture = TestBed.createComponent(VehicleDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  // ------------------------------------------------------------- segmentos

  it('abre em Veículo sem parâmetro', async () => {
    await setup();
    expect(panel('veiculo').hidden).toBe(false);
    expect(panel('gerencia').hidden).toBe(true);
  });

  it('?aba=gerencia abre Gerência', async () => {
    await setup({ aba: 'gerencia' });
    expect(panel('gerencia').hidden).toBe(false);
    expect(panel('veiculo').hidden).toBe(true);
    expect(tab('Gerência').getAttribute('aria-selected')).toBe('true');
  });

  it('a mudança de ?aba com a página aberta troca o segmento: é o redirect caindo aqui', async () => {
    await setup();
    query.next(convertToParamMap({ aba: 'gerencia' }));
    fixture.detectChanges();
    expect(panel('gerencia').hidden).toBe(false);
  });

  it('o segmento guarda a aba na URL sem criar entrada no histórico', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    tab('Gerência').click();
    fixture.detectChanges();

    expect(panel('gerencia').hidden).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { aba: 'gerencia' }, replaceUrl: true }),
    );
  });

  it('os dois painéis ficam montados: trocar de segmento não cancela envio de documento', async () => {
    await setup();
    tab('Gerência').click();
    fixture.detectChanges();
    expect(host().querySelector('app-documents-card')).not.toBeNull();
  });

  // ------------------------------------------------------------------ badge

  it('o badge conta a lista, nunca o openCount do resumo', async () => {
    await setup({ pendencias: of([pendencia(), pendencia({ type: 'IPVA' })]) });
    expect(badge()?.textContent).toBe('2');
    expect(badge()?.getAttribute('aria-label')).toBe('2 pendências');
  });

  it('zero pendências não mostra badge', async () => {
    await setup();
    expect(badge()).toBeNull();
  });

  // ---------------------------------------------------------------- dinheiro

  it('financiado compõe Investido com Entrada, Parcelas pagas e Manutenções', async () => {
    await setup({ aba: 'gerencia' });
    const stats = text(host().querySelector('app-vehicle-money-hero dl'));
    expect(stats).toContain('investido');
    expect(stats).toContain('33.440,00');
    expect(stats).toContain('entrada');
    expect(stats).toContain('20.000,00');
    expect(stats).toContain('parcelas pagas');
    expect(stats).toContain('11.600,00');
    expect(stats).toContain('manutenções');
    expect(stats).not.toContain('compra');
  });

  it('à vista compõe Investido com Compra e Manutenções', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          financed: false,
          downPaymentCents: null,
          totalFinancingPaidCents: null,
          totalInvestedCents: 7_384_000,
        }),
      ),
    });
    const stats = text(host().querySelector('app-vehicle-money-hero dl'));
    expect(stats).toContain('compra');
    expect(stats).toContain('72.000,00');
    expect(stats).not.toContain('entrada');
    expect(stats).not.toContain('parcelas pagas');
  });

  it('Recebido e Contratado têm o mesmo peso, com resultado e % do investido', async () => {
    await setup({ aba: 'gerencia' });
    const recebido = text(host().querySelector('[data-column="Recebido"]'));
    const contratado = text(host().querySelector('[data-column="Contratado"]'));
    expect(recebido).toContain('13.650,00');
    expect(recebido).toContain('41% do investido');
    expect(recebido).toContain('−R$ 19.790,00');
    expect(contratado).toContain('18.850,00');
    expect(contratado).toContain('56% do investido');
    expect(contratado).toContain('−R$ 14.590,00');
    expect(host().querySelectorAll('[data-track]')).toHaveLength(2);
  });

  it('o anel diz "72% recebido", a fração do contratado', async () => {
    await setup({ aba: 'gerencia' });
    const ring = host().querySelector('app-vehicle-money-hero app-painted-ring');
    expect(ring?.textContent).toContain('72%');
    expect(ring?.textContent).toContain('recebido');
    expect(ring?.textContent).not.toContain('pago');
    expect(ring?.getAttribute('aria-label')).toBe('72% do contratado recebido');
  });

  it('laranja até se pagar, verde depois', async () => {
    await setup({ aba: 'gerencia' });
    const card = () => host().querySelector('[data-money-hero]');
    expect(card()?.getAttribute('data-tone')).toBe('orange');
    expect(text(card())).toContain('Ainda não se pagou');

    await setup({ aba: 'gerencia', summary: of(summaryOf({ resultReceivedCents: 816_000 })) });
    expect(card()?.getAttribute('data-tone')).toBe('green');
    expect(text(card())).toContain('Já se pagou');
  });

  it('sem valor de compra: mantém Recebido e Contratado, some track, %, Resultado e Investido', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          purchasePriceMissing: true,
          financed: false,
          totalInvestedCents: null,
          resultCents: null,
          resultReceivedCents: null,
        }),
      ),
    });
    const hero = host().querySelector('[data-money-hero]');

    expect(text(hero)).toContain('Falta o valor de compra');
    expect(text(hero)).toContain('13.650,00');
    expect(text(hero)).toContain('18.850,00');
    expect(hero?.querySelector('[data-track]')).toBeNull();
    const columns = text(hero?.querySelector('[data-duo]') ?? null);
    expect(columns).not.toContain('resultado');
    expect(columns).not.toContain('investido');
    expect(text(hero)).not.toContain('investido');
    expect(hero?.querySelector('dl')).toBeNull();
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(hero?.querySelector('[data-money-empty-action]')?.getAttribute('href')).toBe(
      '/veiculos/veh-1/editar',
    );
  });

  it('o vazio sai da flag, nunca de purchaseCostCents nulo', async () => {
    await setup({ aba: 'gerencia', summary: of(summaryOf({ purchaseCostCents: null })) });
    expect(host().querySelector('[data-money-empty]')).toBeNull();
    expect(host().querySelector('app-vehicle-money-hero dl')).not.toBeNull();
  });

  it('financiamento sem entrada: vazio próprio, sem vermelho e sem prometer edição', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          financingDataIncomplete: true,
          downPaymentCents: null,
          totalInvestedCents: null,
          resultCents: null,
          resultReceivedCents: null,
        }),
      ),
    });
    const hero = host().querySelector('[data-money-hero]');

    expect(text(hero)).toContain('Falta a entrada do financiamento');
    expect(text(hero)).toContain('não dá para calcular o Investido');
    expect(text(hero)).not.toContain('Editar');
    expect(text(hero)).not.toContain('Informar');
    expect(hero?.innerHTML).not.toContain('rose');
    expect(hero?.innerHTML).not.toContain('red-');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    const action = hero?.querySelector('[data-money-empty-action]');
    expect(text(action)).toBe('Ver financiamento');
    expect(action?.getAttribute('href')).toBe('/veiculos/veh-1/gerencia/financiamentos');
  });

  it('financiamento com entrada mas sem parcelas diz o que falta de verdade', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          financingDataIncomplete: true,
          totalFinancingPaidCents: null,
          totalInvestedCents: null,
          resultCents: null,
          resultReceivedCents: null,
        }),
      ),
    });
    const empty = text(host().querySelector('[data-money-empty]'));
    expect(empty).toContain('Faltam as parcelas');
    expect(empty).toContain('Sem elas não dá');
  });

  it('venda de valor zero ainda é venda, e o resultado diz que a inclui', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(summaryOf({ saleValueCents: 0, saleDate: '2026-08-20' })),
    });
    expect(text(host().querySelector('[data-sale-line]'))).toBe(
      'Resultado inclui a venda de R$ 0,00 em 20/08/2026.',
    );
  });

  it('sem venda não há linha de venda', async () => {
    await setup({ aba: 'gerencia' });
    expect(host().querySelector('[data-sale-line]')).toBeNull();
  });

  it('Recebido sem Contratado: nunca "Nenhum contrato", e sem anel', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(summaryOf({ totalRentalRevenueCents: 0, totalRentalReceivedCents: 130_000 })),
    });
    const hero = host().querySelector('[data-money-hero]');
    expect(text(hero)).not.toContain('Nenhum contrato');
    expect(text(hero)).toContain('O recebido inclui aluguéis encerrados antes do fim.');
    expect(hero?.querySelector('app-painted-ring')).toBeNull();
  });

  it('Recebido acima de Contratado: sem anel e nenhum percentual acima de 100 nele', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(summaryOf({ totalRentalRevenueCents: 100_000, totalRentalReceivedCents: 130_000 })),
    });
    const hero = host().querySelector('[data-money-hero]');
    expect(hero?.querySelector('app-painted-ring')).toBeNull();
    expect(text(hero)).toContain('O recebido inclui aluguéis encerrados antes do fim.');
    expect(text(hero)).not.toContain('130%');
  });

  it('nada contratado e nada recebido continua "Nenhum contrato"', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(summaryOf({ totalRentalRevenueCents: 0, totalRentalReceivedCents: 0 })),
    });
    expect(text(host().querySelector('[data-money-hero]'))).toContain('Nenhum contrato');
  });

  it('backend sem os campos novos não imprime NaN', async () => {
    const old = { resultReceivedCents: undefined, downPaymentCents: undefined };
    await setup({
      aba: 'gerencia',
      summary: of(summaryOf(old as unknown as Partial<GerenciaFinanceChunk>)),
    });
    expect(host().querySelector('[data-money-hero]')?.textContent).not.toContain('NaN');
    expect(text(host().querySelector('[data-column="Contratado"]'))).toContain('−R$ 14.590,00');
    expect(text(host().querySelector('[data-column="Recebido"]'))).not.toContain('resultado');
  });

  it('venda sem Resultado na tela não fala de Resultado', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          saleValueCents: 4_500_000,
          saleDate: '2026-08-20',
          financingDataIncomplete: true,
          totalInvestedCents: null,
          resultCents: null,
          resultReceivedCents: null,
        }),
      ),
    });
    expect(text(host().querySelector('[data-sale-line]'))).toBe(
      'Vendido por R$ 45.000,00 em 20/08/2026.',
    );
  });

  it('quitação sem valor: vazio próprio, sem vermelho e sem prometer edição', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          financingPayoffUnknown: true,
          totalInvestedCents: null,
          resultCents: null,
          resultReceivedCents: 900_000 as unknown as null,
        }),
      ),
    });
    const hero = host().querySelector('[data-money-hero]');

    expect(text(hero)).toContain('Falta o valor da quitação');
    expect(text(hero)).toContain('não foi registrado');
    expect(text(hero)).toContain('não dá para calcular o Investido');
    expect(text(hero)).not.toContain('Editar');
    expect(text(hero)).not.toContain('Informar');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(hero?.querySelector('[data-track]')).toBeNull();
    expect(hero?.querySelector('dl')).toBeNull();
    expect(hero?.innerHTML).not.toContain('rose');
    const action = hero?.querySelector('[data-money-empty-action]');
    expect(text(action)).toBe('Ver financiamento');
    expect(action?.getAttribute('href')).toBe('/veiculos/veh-1/gerencia/financiamentos');
  });

  it('quitação sem valor e financiamento incompleto juntos: a quitação fala primeiro', async () => {
    await setup({
      aba: 'gerencia',
      summary: of(
        summaryOf({
          financingPayoffUnknown: true,
          financingDataIncomplete: true,
          downPaymentCents: null,
          totalInvestedCents: null,
          resultCents: null,
          resultReceivedCents: null,
        }),
      ),
    });
    const hero = text(host().querySelector('[data-money-hero]'));
    expect(hero).toContain('Quitação sem valor');
    expect(hero).toContain('Falta o valor da quitação');
    expect(hero).not.toContain('Falta a entrada');
    expect(hero).not.toContain('Financiamento incompleto');
  });

  it('não desenha cartão pintado com degradê', async () => {
    await setup({ aba: 'gerencia', active: activeRental });
    for (const card of Array.from(host().querySelectorAll('app-painted-card'))) {
      expect(card.className).not.toContain('gradient');
    }
  });

  // -------------------------------------------------------------- pendências

  const routes: [VehiclePendenciaType, string | null, string][] = [
    ['FINE', 'x', '/multas/x'],
    ['MAINTENANCE', 'x', '/manutencoes/x'],
    ['INSURANCE', 'x', '/seguros/x'],
    ['INSURANCE_INSTALLMENT', 'x', '/seguros/x'],
    ['FINANCING_INSTALLMENT', 'x', '/financiamentos/x'],
    ['LICENSING', 'veh-1', '/veiculos/veh-1/editar'],
    ['IPVA', 'veh-1', '/veiculos/veh-1/editar'],
    ['INSPECTION', 'x', '/vistorias/x'],
    ['INSPECTION', null, '/vistorias'],
  ];

  it.each(routes)('a linha %s (alvo %s) abre %s', async (type, targetId, href) => {
    await setup({ aba: 'gerencia', pendencias: of([pendencia({ type, targetId })]) });
    expect(row(type).getAttribute('href')).toBe(href);
  });

  it('a tabela leva ao mesmo destino da lista', async () => {
    await setup({ aba: 'gerencia', pendencias: of([pendencia({ targetId: 'x' })]) });
    const link = host().querySelector('table a');
    expect(link?.getAttribute('href')).toBe('/multas/x');
  });

  it.each([
    [{ urgency: 'OVERDUE', daysUntilDue: -6 }, 'Atrasada há 6 dias', 'bg-primary-50'],
    [{ urgency: 'OVERDUE', daysUntilDue: -1 }, 'Atrasada há 1 dia', 'bg-primary-50'],
    [{ urgency: 'DUE_SOON', daysUntilDue: 0 }, 'Vence hoje', 'bg-amber-100'],
    [{ urgency: 'DUE_SOON', daysUntilDue: 1 }, 'Em 1 dia', 'bg-amber-100'],
    [{ urgency: 'DUE_SOON', daysUntilDue: 11 }, 'Em 11 dias', 'bg-amber-100'],
    [{ urgency: 'LATER', daysUntilDue: 29 }, 'Em 29 dias', 'bg-surface-sunken'],
    [{ urgency: 'NO_DATE', daysUntilDue: null, dueDate: null }, 'Sem data', 'bg-surface-sunken'],
  ] as const)('o chip lê urgency e daysUntilDue: %j', async (over, label, tone) => {
    await setup({ aba: 'gerencia', pendencias: of([pendencia({ ...over })]) });
    const chip = row('FINE').querySelector('app-status-chip');
    expect(text(chip)).toBe(label);
    expect(chip?.className).toContain(tone);
    expect(chip?.children).toHaveLength(0);
  });

  it('a urgência vem do backend: dias positivos com OVERDUE não viram "Em N dias"', async () => {
    await setup({
      aba: 'gerencia',
      pendencias: of([
        pendencia({
          type: 'MAINTENANCE',
          urgency: 'OVERDUE',
          daysUntilDue: 20,
          dueHodometer: 50_000,
        }),
      ]),
    });
    expect(text(row('MAINTENANCE').querySelector('app-status-chip'))).toBe('Km atingido');
  });

  it('concorda em gênero com o que atrasou', async () => {
    await setup({ aba: 'gerencia', pendencias: of([pendencia({ type: 'LICENSING' })]) });
    expect(text(row('LICENSING').querySelector('app-status-chip'))).toBe('Atrasado há 6 dias');
  });

  it('"1 atrasada" no singular, "2 atrasadas" no plural', async () => {
    await setup({ aba: 'gerencia', pendencias: of([pendencia()]) });
    expect(text(host().querySelector('[data-pendencias-note]'))).toBe('1 atrasada, 1 no total');

    await setup({
      aba: 'gerencia',
      pendencias: of([
        pendencia(),
        pendencia({ type: 'IPVA' }),
        pendencia({ type: 'INSPECTION', urgency: 'LATER', daysUntilDue: 20 }),
      ]),
    });
    expect(text(host().querySelector('[data-pendencias-note]'))).toBe('2 atrasadas, 3 no total');
  });

  it('o quadro é sólido atrasado, tingido perto e neutro depois', async () => {
    await setup({
      aba: 'gerencia',
      pendencias: of([
        pendencia(),
        pendencia({ type: 'IPVA', urgency: 'DUE_SOON', daysUntilDue: 5 }),
        pendencia({ type: 'INSPECTION', urgency: 'LATER', daysUntilDue: 20 }),
      ]),
    });
    expect(row('FINE').querySelector('.tile.hot')).not.toBeNull();
    expect(row('IPVA').querySelector('.tile.tint')).not.toBeNull();
    const later = row('INSPECTION').querySelector('.tile');
    expect(later?.className).not.toContain('hot');
    expect(later?.className).not.toContain('tint');
  });

  it('mantém a ordem que o backend mandou', async () => {
    await setup({
      aba: 'gerencia',
      pendencias: of([
        pendencia({ type: 'IPVA' }),
        pendencia({ type: 'FINE' }),
        pendencia({ type: 'INSPECTION' }),
      ]),
    });
    const order = Array.from(host().querySelectorAll('a[appListRow][data-pendencia]')).map((a) =>
      a.getAttribute('data-pendencia'),
    );
    expect(order).toEqual(['IPVA', 'FINE', 'INSPECTION']);
  });

  it('lista vazia diz "Nada a resolver"', async () => {
    await setup({ aba: 'gerencia' });
    expect(text(host().querySelector('[data-pendencias-empty]'))).toContain('Nada a resolver');
  });

  it('Histórico aponta para as páginas, e carro à vista mantém o caminho do financiamento', async () => {
    await setup({ aba: 'gerencia', summary: of(summaryOf({ financed: false })) });
    const hrefs = () =>
      Array.from(host().querySelectorAll('app-vehicle-history-group a')).map((a) =>
        a.getAttribute('href'),
      );
    expect(hrefs()).toEqual([
      '/alugueis?vehicleId=veh-1',
      '/veiculos/veh-1/gerencia/manutencoes',
      '/veiculos/veh-1/gerencia/multas',
      '/veiculos/veh-1/gerencia/seguros',
      '/veiculos/veh-1/editar',
    ]);
    expect(text(host().querySelector('app-vehicle-history-group'))).toContain(
      'Cadastrar financiamento',
    );

    await setup({ aba: 'gerencia' });
    expect(hrefs()).toContain('/veiculos/veh-1/gerencia/financiamentos');
    expect(hrefs()).not.toContain('/veiculos/veh-1/editar');
    expect(text(host().querySelector('app-vehicle-history-group'))).toContain('Contrato e parcelas');
  });

  it('carro à vista vendido não oferece cadastrar: o formulário está travado', async () => {
    const sale = {
      id: 's',
      buyerName: 'M',
      saleDate: '2026-08-20',
      saleValueCents: 1,
      createdDate: '2026-08-20',
    };
    await setup({
      aba: 'gerencia',
      vehicle: { ...baseVehicle, status: 'INACTIVE', sale },
      summary: of(summaryOf({ financed: false })),
    });
    const group = host().querySelector('app-vehicle-history-group');
    expect(text(group)).not.toContain('Financiamento');
    expect(group?.querySelector('a[href$="/editar"]')).toBeNull();
  });

  it('carro financiado vendido mantém o histórico do financiamento', async () => {
    const sale = {
      id: 's',
      buyerName: 'M',
      saleDate: '2026-08-20',
      saleValueCents: 1,
      createdDate: '2026-08-20',
    };
    await setup({ aba: 'gerencia', vehicle: { ...baseVehicle, status: 'INACTIVE', sale } });
    expect(
      host().querySelector('app-vehicle-history-group a[href$="/gerencia/financiamentos"]'),
    ).not.toBeNull();
  });

  it('o link do financiamento não some enquanto o resumo carrega ou falha', async () => {
    const link = () =>
      host().querySelector('app-vehicle-history-group a[href$="/gerencia/financiamentos"]');

    await setup({ aba: 'gerencia', summary: NEVER });
    expect(link()).not.toBeNull();

    await setup({
      aba: 'gerencia',
      summary: throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    expect(link()).not.toBeNull();
  });

  // -------------------------------------------------------------- hero do carro

  it('alugado: motorista, próxima cobrança, dias restantes e cartão verde', async () => {
    await setup({
      active: activeRental,
      charges: [
        charge({ dueDate: '2026-11-12', id: 'c-2' }),
        charge({ dueDate: '2026-11-05' }),
        charge({ kind: 'CAUCAO', dueDate: '2026-10-01', id: 'c-3' }),
        charge({ status: 'PAID', dueDate: '2026-10-29', id: 'c-4' }),
      ],
    });
    const hero = host().querySelector('[data-rental-hero]');

    expect(text(hero?.querySelector('[data-hero-driver]') ?? null)).toBe('Carlos Mendes');
    expect(text(hero?.querySelector('[data-hero-line]') ?? null)).toBe(
      'Cobranças em dia. Próxima em 05/11, R$ 650,00.',
    );
    expect(hero?.getAttribute('data-tone')).toBe('green');
    expect(hero?.querySelector('app-painted-ring')?.getAttribute('aria-label')).toContain(
      'para a devolução',
    );
    expect(text(hero)).toContain('Semanal');
    expect(text(hero)).toContain('por semana');
    expect(hero?.querySelector('a')?.getAttribute('href')).toBe('/alugueis/r-1');
    expect(text(hero?.querySelector('a') ?? null)).toBe('Ver aluguel');
  });

  it('cobrança atrasada troca a frase e pinta o cartão de laranja', async () => {
    await setup({
      active: activeRental,
      charges: [charge({ status: 'PAST_DUE', dueDate: '2026-10-22' })],
    });
    const hero = host().querySelector('[data-rental-hero]');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(text(hero?.querySelector('[data-hero-line]') ?? null)).toBe(
      'Cobrança atrasada desde 22/10, R$ 650,00.',
    );
  });

  it('a frase da atrasada fala dela, mesmo que a atrasada não seja de aluguel', async () => {
    await setup({
      active: activeRental,
      charges: [
        charge({ dueDate: '2026-11-05' }),
        charge({ id: 'c-9', kind: 'CAUCAO', status: 'PAST_DUE', dueDate: '2026-10-02', amount: 80_000 }),
      ],
    });
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Cobrança atrasada desde 02/10, R$ 800,00.',
    );
  });

  it('cobrança FAILED não é "em dia": cartão laranja com frase própria', async () => {
    await setup({
      active: activeRental,
      charges: [
        charge({ id: 'c-1', status: 'FAILED', dueDate: '2026-11-14' }),
        charge({ id: 'c-2', dueDate: '2026-11-21' }),
      ],
    });
    const hero = host().querySelector('[data-rental-hero]');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Cobrança com falha: 14/11, R$ 650,00.',
    );
  });

  it('cobrança DISPUTED não é "em dia": cartão laranja com frase própria', async () => {
    await setup({
      active: activeRental,
      charges: [
        charge({ id: 'c-1', status: 'DISPUTED', dueDate: '2026-11-14' }),
        charge({ id: 'c-2', dueDate: '2026-11-21' }),
      ],
    });
    const hero = host().querySelector('[data-rental-hero]');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Cobrança contestada: 14/11, R$ 650,00.',
    );
  });

  it('atenção sem data continua atenção, sem inventar dia', async () => {
    await setup({
      active: activeRental,
      charges: [charge({ status: 'FAILED', dueDate: null })],
    });
    expect(text(host().querySelector('[data-hero-line]'))).toBe('Há cobrança com falha.');
  });

  it('sem nenhuma cobrança não há evidência para dizer "em dia"', async () => {
    await setup({ active: activeRental, charges: [] });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Nenhuma cobrança registrada neste aluguel.',
    );
    expect(hero?.getAttribute('data-tone')).toBe('orange');
  });

  it('cobrança aberta sem vencimento não vira "em dia"', async () => {
    await setup({ active: activeRental, charges: [charge({ dueDate: null })] });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Cobrança em aberto sem vencimento, R$ 650,00.',
    );
    expect(hero?.getAttribute('data-tone')).toBe('orange');
  });

  it('tudo pago é evidência: verde, "Cobranças em dia."', async () => {
    await setup({ active: activeRental, charges: [charge({ status: 'PAID' })] });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(host().querySelector('[data-hero-line]'))).toBe('Cobranças em dia.');
    expect(hero?.getAttribute('data-tone')).toBe('green');
  });

  it('caução paga sozinha não é aluguel em dia', async () => {
    await setup({
      active: activeRental,
      charges: [charge({ kind: 'CAUCAO', status: 'PAID' })],
    });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Nenhuma cobrança de aluguel ativa ou paga.',
    );
    expect(hero?.getAttribute('data-tone')).toBe('orange');
  });

  it('só cobranças de aluguel canceladas não são "em dia"', async () => {
    await setup({
      active: activeRental,
      charges: [charge({ id: 'c-1', status: 'CANCELED' }), charge({ id: 'c-2', status: 'CANCELED' })],
    });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Nenhuma cobrança de aluguel ativa ou paga.',
    );
    expect(hero?.getAttribute('data-tone')).toBe('orange');
  });

  it('caução em aberto com vencimento não vira próxima cobrança nem "em dia"', async () => {
    await setup({
      active: activeRental,
      charges: [charge({ kind: 'CAUCAO', status: 'PENDING', dueDate: '2026-11-05' })],
    });
    expect(host().querySelector('[data-rental-hero]')?.getAttribute('data-tone')).toBe('orange');
    expect(text(host().querySelector('[data-hero-line]'))).not.toContain('em dia');
  });

  it('uma cobrança de aluguel paga basta como evidência, mesmo com canceladas ao lado', async () => {
    await setup({
      active: activeRental,
      charges: [charge({ id: 'c-1', status: 'CANCELED' }), charge({ id: 'c-2', status: 'PAID' })],
    });
    expect(host().querySelector('[data-rental-hero]')?.getAttribute('data-tone')).toBe('green');
    expect(text(host().querySelector('[data-hero-line]'))).toBe('Cobranças em dia.');
  });

  it('leitura de cobranças que falha pinta o cartão de laranja', async () => {
    await setup({ active: activeRental, detailFails: true });
    const hero = host().querySelector('[data-rental-hero]');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(text(host().querySelector('[data-hero-line]'))).toBe(
      'Não foi possível ler as cobranças agora.',
    );
    expect(claim).toHaveBeenCalled();
  });

  it('reservado diz que está reservado, para quem e desde quando', async () => {
    await setup({
      vehicle: { ...baseVehicle, status: 'AVAILABLE' },
      reserved: [
        { ...activeRental, id: 'r-8', driverName: 'Bia Lima', startDate: '2099-03-01', endDate: '2099-04-01', status: 'RESERVED' },
        { ...activeRental, id: 'r-9', driverName: 'Ana Reis', startDate: '2099-02-01', endDate: '2099-02-20', status: 'RESERVED' },
      ],
    });
    const hero = host().querySelector('[data-rental-hero]');

    expect(text(hero)).toContain('Reservado');
    expect(text(hero)).toContain('Ana Reis');
    expect(text(hero)).toContain('A partir de 01/02/2099');
    expect(text(hero)).not.toContain('Pronto para');
    expect(text(hero)).not.toContain('Novo aluguel');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    const link = hero?.querySelector('a');
    expect(text(link ?? null)).toBe('Ver reserva');
    expect(link?.getAttribute('href')).toBe('/alugueis/r-9');
  });

  it('carro na oficina com reserva mantém o estado e avisa da reserva', async () => {
    await setup({
      vehicle: { ...baseVehicle, status: 'MAINTENANCE' },
      reserved: [{ ...activeRental, driverName: 'Ana Reis', startDate: '2099-02-01', status: 'RESERVED' }],
    });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(hero)).toContain('Em manutenção');
    expect(text(hero)).toContain('Reservado para Ana Reis a partir de 01/02/2099.');
  });

  it('vendido e reservado mostra as duas coisas', async () => {
    const sale = { id: 's', buyerName: 'M', saleDate: '2026-08-20', saleValueCents: 1, createdDate: '2026-08-20' };
    await setup({
      vehicle: { ...baseVehicle, status: 'AVAILABLE', sale },
      reserved: [{ ...activeRental, driverName: 'Ana Reis', startDate: '2099-02-01', status: 'RESERVED' }],
    });
    expect(host().querySelector('[data-sold-banner]')).not.toBeNull();
    expect(text(host().querySelector('[data-rental-hero]'))).toContain('Ana Reis');
  });

  it('status Alugado sem aluguel ativo diz o que foi lido, não uma falha', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'RENTED' } });
    const line = text(host().querySelector('[data-hero-line]'));
    expect(line).toBe('Nenhum aluguel ativo encontrado para este carro.');
  });

  it('disponível sem conseguir ler os aluguéis não promete nada', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' }, rentalFails: true });
    const line = text(host().querySelector('[data-hero-line]'));
    expect(line).toBe('Não foi possível ler os aluguéis agora.');
  });

  describe('com a leitura de aluguéis sem resposta', () => {
    const sale = {
      id: 's',
      buyerName: 'M',
      saleDate: '2026-08-20',
      saleValueCents: 1,
      createdDate: '2026-08-20',
    };

    it('vendido não parece sem aluguel: o bloco da venda diz que não leu', async () => {
      await setup({
        vehicle: { ...baseVehicle, status: 'RENTED', sale },
        rentalFails: true,
      });
      expect(host().querySelector('[data-sold-banner]')).not.toBeNull();
      expect(text(host().querySelector('[data-rental-unread]'))).toBe(
        'Não foi possível ler os aluguéis agora: pode haver aluguel em curso neste carro.',
      );
      expect(text()).not.toContain('Novo aluguel');
      expect(text()).not.toContain('No pátio');
    });

    it('vendido com a leitura em dia não mostra aviso nenhum', async () => {
      await setup({ vehicle: { ...baseVehicle, status: 'INACTIVE', sale } });
      expect(host().querySelector('[data-sold-banner]')).not.toBeNull();
      expect(host().querySelector('[data-rental-unread]')).toBeNull();
      expect(host().querySelector('[data-rental-hero]')).toBeNull();
    });

    it('vendido e alugado, com o detalhe falhando, fica no cartão do aluguel', async () => {
      await setup({
        vehicle: { ...baseVehicle, status: 'RENTED', sale },
        active: activeRental,
        detailFails: true,
      });
      expect(host().querySelector('[data-rental-unread]')).toBeNull();
      expect(text(host().querySelector('[data-hero-line]'))).toBe(
        'Não foi possível ler as cobranças agora.',
      );
    });

    it.each([
      ['MAINTENANCE', 'Em manutenção'],
      ['INACTIVE', 'Inativo'],
    ] as const)('%s diz que não leu, em vez de calar sobre reserva', async (status, label) => {
      await setup({ vehicle: { ...baseVehicle, status }, rentalFails: true });
      const hero = host().querySelector('[data-rental-hero]');
      expect(text(hero)).toContain(label);
      expect(text(host().querySelector('[data-hero-line]'))).toContain(
        'Não foi possível ler os aluguéis agora.',
      );
    });

    it('sem falha, oficina e inativo não falam de leitura', async () => {
      await setup({ vehicle: { ...baseVehicle, status: 'MAINTENANCE' } });
      expect(text(host().querySelector('[data-hero-line]'))).not.toContain('Não foi possível');
    });
  });

  it('o detalhe do aluguel só é pedido quando existe aluguel ativo', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    expect(getById).not.toHaveBeenCalled();

    await setup({ active: activeRental });
    expect(getById).toHaveBeenCalledWith('r-1');
  });

  it('disponível: "No pátio", dias sem alugar pelo MAIOR fim, e "Novo aluguel"', async () => {
    await setup({
      vehicle: { ...baseVehicle, status: 'AVAILABLE' },
      completed: [{ endDate: '2026-01-10' }, { endDate: '2026-06-30' }, { endDate: '2026-03-01' }],
    });
    const hero = host().querySelector('[data-rental-hero]');

    expect(text(hero)).toContain('No pátio');
    expect(text(hero)).toContain('Sem alugar desde 30/06');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
    expect(text(hero?.querySelector('a') ?? null)).toBe('Novo aluguel');
    expect(hero?.querySelector('a')?.getAttribute('href')).toBe(
      '/alugueis/novo?vehicleId=veh-1',
    );
  });

  it('disponível sem aluguel concluído não inventa data', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    expect(text(host().querySelector('[data-rental-hero]'))).toContain(
      'ainda não tem aluguel concluído',
    );
  });

  it('em manutenção e inativo têm hero próprio, pintado de laranja', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'MAINTENANCE' } });
    expect(text(host().querySelector('[data-rental-hero]'))).toContain('Em manutenção');

    await setup({ vehicle: { ...baseVehicle, status: 'INACTIVE' } });
    const hero = host().querySelector('[data-rental-hero]');
    expect(text(hero)).toContain('Inativo');
    expect(hero?.getAttribute('data-tone')).toBe('orange');
  });

  // ---------------------------------------------------------------- Documentação

  it('o chip da Documentação lê a pendência, sem calcular urgência na tela', async () => {
    await setup();
    expect(host().querySelector('[data-licensing-row] app-status-chip')).toBeNull();

    await setup({
      pendencias: of([pendencia({ type: 'LICENSING', urgency: 'DUE_SOON', daysUntilDue: 6 })]),
    });
    expect(text(host().querySelector('[data-licensing-row] app-status-chip'))).toBe('Em 6 dias');
  });

  describe('com as pendências sem resposta', () => {
    const failed = () => throwError(() => new HttpErrorResponse({ status: 500 }));

    it('a aba Veículo avisa da falha, e tentar de novo relê', async () => {
      await setup({ pendencias: failed() });
      const banner = () => panel('veiculo').querySelector('[data-pendencias-failed]');

      expect(text(banner())).toContain('Não foi possível ler as pendências');

      getPendencias.mockReturnValue(of([pendencia()]));
      banner()?.querySelector('button')?.click();
      fixture.detectChanges();

      expect(banner()).toBeNull();
      expect(badge()?.textContent).toBe('1');
    });

    it('licenciamento vencido não parece calmo', async () => {
      await setup({
        pendencias: failed(),
        vehicle: { ...baseVehicle, licensingExpiration: '2020-03-01' },
      });
      const chip = host().querySelector('[data-licensing-row] app-status-chip');
      expect(text(chip)).toContain('Vencido');
      expect(chip?.className).toContain('bg-primary-50');
    });

    it('IPVA vencido guardado como PENDING não lê "Pendente"', async () => {
      await setup({
        pendencias: failed(),
        vehicle: { ...baseVehicle, ipvaDueDate: '2020-03-01', ipvaStatus: 'PENDING' },
      });
      const chip = host().querySelector('[data-ipva-row] app-status-chip');
      expect(text(chip)).toContain('Vencido');
      expect(chip?.className).toContain('bg-primary-50');
    });

    it('licenciamento futuro segue sem chip', async () => {
      await setup({
        pendencias: failed(),
        vehicle: { ...baseVehicle, licensingExpiration: '2099-03-01' },
      });
      expect(host().querySelector('[data-licensing-row] app-status-chip')).toBeNull();
    });
  });

  it('carro vendido, fora da lista por regra, mantém o aviso de IPVA vencido', async () => {
    const sale = { id: 's', buyerName: 'M', saleDate: '2026-08-20', saleValueCents: 1, createdDate: '2026-08-20' };
    await setup({
      vehicle: { ...baseVehicle, sale, status: 'INACTIVE', ipvaExpired: true, ipvaDueDate: '2020-03-01' },
      pendencias: of([]),
    });
    expect(text(host().querySelector('[data-ipva-row] app-status-chip'))).toContain('Vencido');
  });

  it('IPVA pago nunca lê vencido, nem com a data no passado', async () => {
    await setup({
      vehicle: { ...baseVehicle, ipvaStatus: 'PAID', ipvaExpired: true, ipvaDueDate: '2020-03-01' },
    });
    expect(text(host().querySelector('[data-ipva-row] app-status-chip'))).toBe('Pago');
  });

  it('IPVA pago sem pendência mostra o status cadastrado', async () => {
    await setup({ vehicle: { ...baseVehicle, ipvaStatus: 'PAID' } });
    expect(text(host().querySelector('[data-ipva-row] app-status-chip'))).toBe('Pago');
  });

  it('o título é a placa e o bloco Gerência antigo saiu', async () => {
    await setup();
    expect(text(host().querySelector('h1'))).toBe('RTA-4B21');
    expect(text()).toContain('Fiat Argo · 2024 · Prata');
    expect(text()).not.toContain('Gerência do veículo');
    expect(host().querySelector('app-status-chip')?.textContent).toContain('Alugado');
  });

  // ------------------------------------------------------------------- ações

  it('alugado: manutenção e inativo ficam visíveis, travados e com o motivo', async () => {
    await setup({ active: activeRental });
    const buttons = Array.from(host().querySelectorAll<HTMLButtonElement>('button[appListRow]'));
    for (const label of ['Marcar em manutenção', 'Marcar inativo']) {
      const b = buttons.find((x) => text(x).startsWith(label));
      expect(b?.disabled).toBe(true);
      expect(text(b ?? null)).toContain('Encerre o aluguel para alterar');
    }
  });

  describe('Editar e Excluir, onde estavam na página antiga', () => {
    const desktop = () => host().querySelector<HTMLElement>('[data-page-actions="desktop"]')!;
    const mobile = () => host().querySelector<HTMLElement>('[data-page-actions="mobile"]')!;
    const excluir = (root: HTMLElement) =>
      root.querySelector<HTMLButtonElement>('button[aria-label="Excluir"]')!;
    const editar = (root: HTMLElement) => root.querySelector<HTMLAnchorElement>('app-detail-actions a')!;

    it('desktop: no cabeçalho da página, escondido no celular', async () => {
      await setup();
      const block = desktop();
      expect(block.closest('header')).not.toBeNull();
      expect(block.className).toContain('hidden');
      expect(block.className).toContain('lg:flex');
      expect(block.className).toContain('shrink-0');
      // A folga que o shell reserva para o sino não empurra os botões da margem.
      expect(block.className).toContain('--page-header-end');
      expect(block.querySelector('app-detail-actions')).not.toBeNull();
    });

    it('celular: no fim da página, escondido no desktop', async () => {
      await setup();
      const block = mobile();
      expect(block.className).toContain('lg:hidden');
      expect(block.className).toContain('mt-6');
      expect(block.querySelector('app-detail-actions')).not.toBeNull();
      const panels = host().querySelectorAll('[role="tabpanel"]');
      const last = panels[panels.length - 1];
      expect(last.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('ficam fora dos painéis, nas duas abas', async () => {
      await setup({ aba: 'gerencia' });
      expect(desktop().closest('[role="tabpanel"]')).toBeNull();
      expect(mobile().closest('[role="tabpanel"]')).toBeNull();
      expect(panel('veiculo').hidden).toBe(true);
      expect(mobile().closest('[hidden]')).toBeNull();
    });

    it('Editar leva ao formulário, nas duas posições', async () => {
      await setup();
      expect(editar(desktop()).getAttribute('href')).toBe('/veiculos/veh-1/editar');
      expect(editar(mobile()).getAttribute('href')).toBe('/veiculos/veh-1/editar');
    });

    it('as linhas de Editar e Excluir saíram de Ações; as outras ficam', async () => {
      await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
      const group = text(host().querySelector('app-vehicle-actions-group'));
      expect(group).not.toContain('Editar');
      expect(group).not.toContain('Excluir');
      expect(group).toContain('Marcar em manutenção');
      expect(group).toContain('Marcar inativo');
      expect(group).toContain('Vender');

      await setup({ vehicle: { ...baseVehicle, status: 'INACTIVE' } });
      expect(text(host().querySelector('app-vehicle-actions-group'))).toContain('Marcar disponível');
    });

    it('alugado: Excluir travado com o motivo no title, Editar livre', async () => {
      await setup({ active: activeRental });
      for (const block of [desktop(), mobile()]) {
        expect(excluir(block).disabled).toBe(true);
        expect(excluir(block).getAttribute('title')).toContain('Finalize o aluguel para excluir');
        expect(editar(block).getAttribute('aria-disabled')).toBeNull();
      }
    });

    it('vendido: os dois travados, com o motivo no title de Excluir', async () => {
      const sale = { id: 's', buyerName: 'M', saleDate: '2026-08-20', saleValueCents: 1, createdDate: '2026-08-20' };
      await setup({ vehicle: { ...baseVehicle, status: 'INACTIVE', sale } });
      for (const block of [desktop(), mobile()]) {
        expect(excluir(block).disabled).toBe(true);
        expect(excluir(block).getAttribute('title')).toContain('Veículo vendido em 20/08/2026');
        expect(editar(block).getAttribute('aria-disabled')).toBe('true');
      }
    });

    it('disponível: Excluir responde e abre a confirmação', async () => {
      await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
      expect(excluir(desktop()).disabled).toBe(false);
      excluir(mobile()).click();
      fixture.detectChanges();
      expect(text()).toContain('Tem certeza que deseja excluir');
    });
  });

  it('vendido: a frase longa fica no title e a linha mostra só o caminho', async () => {
    const sale = {
      id: 's-1',
      buyerName: 'Maria',
      saleDate: '2026-08-20',
      saleValueCents: 4_500_000,
      createdDate: '2026-08-20',
    };
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE', sale } });
    const buttons = Array.from(host().querySelectorAll<HTMLButtonElement>('button[appListRow]'));
    const manutencao = buttons.find((x) => text(x).startsWith('Marcar em manutenção'));

    expect(manutencao?.disabled).toBe(true);
    expect(text(manutencao ?? null)).toContain('Desfaça a venda para alterar');
    expect(text(manutencao ?? null)).not.toContain('20/08/2026');
    expect(manutencao?.getAttribute('title')).toContain('20/08/2026');
  });

  it('disponível: as ações respondem e o motivo some', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    const buttons = Array.from(host().querySelectorAll<HTMLButtonElement>('button[appListRow]'));
    const manutencao = buttons.find((x) => text(x).startsWith('Marcar em manutenção'));
    expect(manutencao?.disabled).toBe(false);
    expect(text(manutencao ?? null)).not.toContain('Encerre');
  });

  it('a trava de alugado também vale no componente, não só no botão', async () => {
    const updateStatus = vi.fn();
    await setup({ active: activeRental });
    (TestBed.inject(VehiclesService) as unknown as { updateStatus: unknown }).updateStatus =
      updateStatus;
    (
      fixture.componentInstance as unknown as { transitionStatus: (t: string) => void }
    ).transitionStatus('MAINTENANCE');
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('venda e desfazer relêem Resultado e pendências: a página não recarrega sozinha', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    const service = TestBed.inject(VehiclesService) as unknown as Record<string, unknown>;
    service['undoSale'] = vi.fn(() => of(baseVehicle));
    const api = fixture.componentInstance as unknown as {
      vehicle: { set: (v: Vehicle) => void };
      confirmUndoSale: () => void;
    };
    api.vehicle.set(baseVehicle);
    getGerenciaSummary.mockClear();
    getPendencias.mockClear();

    api.confirmUndoSale();

    expect(getGerenciaSummary).toHaveBeenCalledTimes(1);
    expect(getPendencias).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------- leitura independente

  it('só faz GET: nenhuma chamada de escrita de aluguel ou cobrança está ao alcance', async () => {
    await setup({ active: activeRental, charges: [charge({})] });
    expect(Object.keys(TestBed.inject(RentalService))).toEqual(['list', 'getById']);
  });

  it('não escreve na lista compartilhada de aluguéis', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    expect(sharedList).not.toHaveBeenCalled();
  });

  it('pede o ativo com size 1, e reservas e concluídos com size 100', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    expect(list).toHaveBeenCalledWith(VEHICLE_ID, 'ACTIVE', 1);
    expect(list).toHaveBeenCalledWith(VEHICLE_ID, 'RESERVED', 100);
    expect(list).toHaveBeenCalledWith(VEHICLE_ID, 'COMPLETED', 100);
  });

  it('sair da página cancela a leitura de aluguel em voo', async () => {
    let unsubscribed = 0;
    await setup();
    list.mockImplementation(
      () => new Observable(() => () => (unsubscribed += 1)),
    );
    fixture.destroy();
    fixture = TestBed.createComponent(VehicleDetail);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(unsubscribed).toBe(0);

    fixture.destroy();

    expect(unsubscribed).toBe(1);
  });

  it('um 200 malformado nas pendências é falha, não "Nada a resolver"', async () => {
    await setup({
      aba: 'gerencia',
      pendencias: of({ erro: true } as unknown as VehiclePendencia[]),
    });
    expect(host().querySelector('[data-pendencias-empty]')).toBeNull();
    expect(text(host().querySelector('[data-pendencias-error]'))).toContain(
      'Não foi possível carregar as pendências.',
    );
  });

  it('aluguel que falha não derruba a página nem ganha toast', async () => {
    await setup({ rentalFails: true });

    expect(text(host().querySelector('[data-rental-hero]'))).toContain(
      'Não foi possível ler o aluguel agora.',
    );
    expect(host().querySelector('app-vehicle-documents-card')).not.toBeNull();
    expect(claim).toHaveBeenCalled();
  });

  it('resumo que falha mostra o erro com retry, e a pendência continua', async () => {
    await setup({
      aba: 'gerencia',
      summary: throwError(() => new HttpErrorResponse({ status: 500 })),
      pendencias: of([pendencia()]),
    });

    expect(text(host().querySelector('[data-summary-error]'))).toContain(
      'Não foi possível carregar a gerência do veículo.',
    );
    expect(row('FINE')).not.toBeNull();
    expect(badge()?.textContent).toBe('1');

    getGerenciaSummary.mockReturnValue(of(summaryOf()));
    host().querySelector<HTMLButtonElement>('[data-summary-error] button')!.click();
    fixture.detectChanges();
    expect(host().querySelector('[data-money-hero]')).not.toBeNull();
  });

  it('pendências que falham não viram "Nada a resolver"', async () => {
    await setup({
      aba: 'gerencia',
      pendencias: throwError(() => new HttpErrorResponse({ status: 500 })),
    });

    expect(text(host().querySelector('[data-pendencias-error]'))).toContain(
      'Não foi possível carregar as pendências.',
    );
    expect(host().querySelector('[data-pendencias-empty]')).toBeNull();
    expect(host().querySelector('[data-money-hero]')).not.toBeNull();
  });
});
