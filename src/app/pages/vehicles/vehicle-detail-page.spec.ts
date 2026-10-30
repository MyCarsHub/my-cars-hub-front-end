import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
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
    charges?: RentalChargeDto[];
    completed?: Partial<RentalListItemDto>[];
    rentalFails?: boolean;
    aba?: string;
  }

  let fixture: ComponentFixture<VehicleDetail>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let list: ReturnType<typeof vi.fn>;
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
      charges = [],
      completed = [],
      rentalFails = false,
      aba,
    } = options;

    query = new BehaviorSubject(convertToParamMap(aba ? { aba } : {}));
    getGerenciaSummary = vi.fn(() => summary);
    getPendencias = vi.fn(() => pendencias);
    claim = vi.fn();
    list = vi.fn((filters: { status: string }) => {
      if (rentalFails) return throwError(() => new HttpErrorResponse({ status: 500 }));
      const content = filters.status === 'ACTIVE' ? (active ? [active] : []) : completed;
      return of({ content, page: 0, size: 1, total: content.length });
    });
    getById = vi.fn(() => of({ periodRate: 65_000, charges }));

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
            listDocuments: vi.fn(() => of([])),
          },
        },
        { provide: RentalService, useValue: { list, getById } },
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
    expect(text(host().querySelector('[data-money-empty]'))).toContain('Faltam as parcelas');
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

  it('Histórico mostra Financiamento só em carro financiado e aponta para as páginas', async () => {
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
    ]);

    await setup({ aba: 'gerencia' });
    expect(hrefs()).toContain('/veiculos/veh-1/gerencia/financiamentos');
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
    const excluir = buttons.find((x) => text(x).startsWith('Excluir veículo'));
    expect(excluir?.disabled).toBe(true);
    expect(text(excluir ?? null)).toContain('Finalize o aluguel para excluir');
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

  it('pede o ativo com size 1 e os concluídos com size 100', async () => {
    await setup({ vehicle: { ...baseVehicle, status: 'AVAILABLE' } });
    expect(list).toHaveBeenCalledWith({ vehicleId: VEHICLE_ID, status: 'ACTIVE', size: 1 });
    expect(list).toHaveBeenCalledWith({ vehicleId: VEHICLE_ID, status: 'COMPLETED', size: 100 });
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
