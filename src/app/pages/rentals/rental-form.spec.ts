import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, EMPTY } from 'rxjs';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';
import { SessionService } from '../../services/session.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';

/**
 * Guarantees the "novo aluguel" picker calls the backend with the correct
 * availability filters — always `availableForRental=true`, and in edit mode
 * additionally `includeCurrentRentalId=<id>` so the currently-assigned
 * vehicle/driver stays visible in the dropdown.
 */
describe('RentalForm picker filters', () => {
  let vehiclesList: ReturnType<typeof vi.fn>;
  let driversList: ReturnType<typeof vi.fn>;

  function configure(rentalId: string | null): void {
    vehiclesList = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 500, total: 0 }));
    driversList = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 500, total: 0 }));

    const activatedRoute = {
      snapshot: { paramMap: { get: (key: string) => (key === 'id' ? rentalId : null) } },
    };

    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: VehiclesService, useValue: { list: vehiclesList } },
        { provide: DriverService, useValue: { list: driversList } },
        {
          provide: RentalService,
          useValue: { getById: vi.fn().mockReturnValue(EMPTY) },
        },
        {
          provide: AsaasIntegrationService,
          useValue: { status: signal(null), load: () => EMPTY },
        },
        {
          provide: ContractTemplateService,
          useValue: { get: () => EMPTY },
        },
      ],
    });
  }

  beforeEach(() => {
    // Reset TestBed between cases so each configures its own ActivatedRoute.
    TestBed.resetTestingModule();
  });

  it('create mode: passes availableForRental=true without includeCurrentRentalId', () => {
    configure(null);
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();

    expect(vehiclesList).toHaveBeenCalledTimes(1);
    expect(vehiclesList).toHaveBeenCalledWith({
      size: 500,
      sort: 'plate_asc',
      availableForRental: true,
    });

    expect(driversList).toHaveBeenCalledTimes(1);
    expect(driversList).toHaveBeenCalledWith({
      size: 500,
      sort: 'name_asc',
      availableForRental: true,
    });
  });

  it('edit mode: passes availableForRental=true AND includeCurrentRentalId', () => {
    const rentalId = 'rental-uuid-42';
    configure(rentalId);
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();

    expect(vehiclesList).toHaveBeenCalledWith({
      size: 500,
      sort: 'plate_asc',
      availableForRental: true,
      includeCurrentRentalId: rentalId,
    });

    expect(driversList).toHaveBeenCalledWith({
      size: 500,
      sort: 'name_asc',
      availableForRental: true,
      includeCurrentRentalId: rentalId,
    });
  });

  it('caucaoPaid toggle: present in form, only visible when caucaoReais > 0, and included in the create payload', () => {
    configure(null);
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as unknown as {
      form: {
        controls: { caucaoPaid: { value: boolean; setValue: (v: boolean) => void } };
        patchValue: (v: Record<string, unknown>) => void;
      };
      // computed signal
      caucaoAmountPositive: () => boolean;
    };

    // Form control exists and defaults to false.
    expect(cmp.form.controls.caucaoPaid).toBeDefined();
    expect(cmp.form.controls.caucaoPaid.value).toBe(false);

    // Toggle only visible when there's a caução amount.
    expect(cmp.caucaoAmountPositive()).toBe(false);
    cmp.form.patchValue({ caucaoReais: 500 });
    fixture.detectChanges();
    expect(cmp.caucaoAmountPositive()).toBe(true);
  });
});

/**
 * Período → pickers.
 *
 * CONTRATO DO BACKEND (`GET /v1/vehicles`, `GET /v1/drivers`):
 * `periodStart`/`periodEnd` em `yyyy-MM-dd`, `periodEnd` INCLUSIVO, só surtem
 * efeito junto de `availableForRental=true`, e **só uma das duas pontas é 400**.
 * Daí a regra central destes testes: ou saem as DUAS, ou não sai NENHUMA.
 */
describe('RentalForm período nos pickers', () => {
  let vehiclesList: Mock;
  let driversList: Mock;

  /** `debounceTime(300)` do pipeline. Timers reais, como no rental-detail.spec. */
  async function afterDebounce(fixture: { detectChanges: () => void }): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    fixture.detectChanges();
  }

  function mount(
    rentalId: string | null = null,
    vehicles: unknown[] = [],
    drivers: unknown[] = [],
  ): ReturnType<typeof TestBed.createComponent<RentalForm>> {
    TestBed.resetTestingModule();
    vehiclesList = vi.fn().mockReturnValue(of({ content: vehicles, page: 0, size: 500, total: 0 }));
    driversList = vi.fn().mockReturnValue(of({ content: drivers, page: 0, size: 500, total: 0 }));
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => rentalId } } },
        },
        { provide: VehiclesService, useValue: { list: vehiclesList } },
        { provide: DriverService, useValue: { list: driversList } },
        { provide: RentalService, useValue: { getById: () => EMPTY, create: vi.fn() } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    return fixture;
  }

  type PeriodFormLike = { form: { patchValue: (v: Record<string, unknown>) => void } };

  /** Último argumento com que cada picker foi chamado. */
  function lastCalls(): { vehicle: Record<string, unknown>; driver: Record<string, unknown> } {
    return {
      vehicle: vehiclesList.mock.calls.at(-1)?.[0] as Record<string, unknown>,
      driver: driversList.mock.calls.at(-1)?.[0] as Record<string, unknown>,
    };
  }

  it('período completo entra nas DUAS buscas', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);

    expect(lastCalls().vehicle).toEqual({
      size: 500,
      sort: 'plate_asc',
      availableForRental: true,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-10',
    });
    expect(lastCalls().driver).toEqual({
      size: 500,
      sort: 'name_asc',
      availableForRental: true,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-10',
    });
  });

  it('start == end é válido (aluguel de um dia só)', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-01' });
    await afterDebounce(fixture);

    expect(lastCalls().vehicle).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-01',
    });
  });

  it('só o início preenchido NÃO manda parâmetro nenhum (seria 400)', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-09-01' });
    await afterDebounce(fixture);

    for (const call of [...vehiclesList.mock.calls, ...driversList.mock.calls]) {
      expect(call[0]).not.toHaveProperty('periodStart');
      expect(call[0]).not.toHaveProperty('periodEnd');
    }
  });

  it('só o fim preenchido NÃO manda parâmetro nenhum (seria 400)', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ endDate: '2026-09-10' });
    await afterDebounce(fixture);

    for (const call of [...vehiclesList.mock.calls, ...driversList.mock.calls]) {
      expect(call[0]).not.toHaveProperty('periodStart');
      expect(call[0]).not.toHaveProperty('periodEnd');
    }
  });

  it('fim antes do início NÃO manda parâmetro nenhum (seria 400)', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-09-10', endDate: '2026-09-01' });
    await afterDebounce(fixture);

    for (const call of [...vehiclesList.mock.calls, ...driversList.mock.calls]) {
      expect(call[0]).not.toHaveProperty('periodStart');
    }
  });

  it('data que não existe no calendário não vira parâmetro', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-13-45', endDate: '2026-12-31' });
    await afterDebounce(fixture);

    for (const call of vehiclesList.mock.calls) {
      expect(call[0]).not.toHaveProperty('periodStart');
    }
  });

  it('mudar o período refaz as DUAS buscas com as datas novas', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);
    const afterFirst = vehiclesList.mock.calls.length;

    cmp.form.patchValue({ endDate: '2026-09-20' });
    await afterDebounce(fixture);

    expect(vehiclesList.mock.calls.length).toBeGreaterThan(afterFirst);
    expect(lastCalls().vehicle).toMatchObject({ periodEnd: '2026-09-20' });
    expect(lastCalls().driver).toMatchObject({ periodEnd: '2026-09-20' });
  });

  it('rajada de digitação vira UM refetch só (debounce)', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    const beforeTyping = vehiclesList.mock.calls.length;

    // Chrome emite por segmento ao digitar o ano: 0002 → 0020 → 0202 → 2026.
    cmp.form.patchValue({ startDate: '0002-09-01', endDate: '0002-09-10' });
    cmp.form.patchValue({ startDate: '0020-09-01', endDate: '0020-09-10' });
    cmp.form.patchValue({ startDate: '0202-09-01', endDate: '0202-09-10' });
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);

    expect(vehiclesList.mock.calls.length - beforeTyping).toBe(1);
    expect(lastCalls().vehicle).toMatchObject({ periodStart: '2026-09-01' });
  });

  it('mexer em campo fora do período não refaz busca', async () => {
    const fixture = mount();
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    const before = vehiclesList.mock.calls.length;

    cmp.form.patchValue({ periodRateReais: 250, notes: 'entrega na garagem' });
    await afterDebounce(fixture);

    expect(vehiclesList.mock.calls.length).toBe(before);
  });

  it('edição: período convive com includeCurrentRentalId', async () => {
    const fixture = mount('rental-uuid-42');
    const cmp = fixture.componentInstance as unknown as PeriodFormLike;
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);

    expect(lastCalls().vehicle).toEqual({
      size: 500,
      sort: 'plate_asc',
      availableForRental: true,
      includeCurrentRentalId: 'rental-uuid-42',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-10',
    });
    expect(lastCalls().driver).toMatchObject({
      includeCurrentRentalId: 'rental-uuid-42',
      periodEnd: '2026-09-10',
    });
  });
});

/**
 * DECISÃO documentada: quando o refresh do picker derruba o item já escolhido,
 * a seleção é LIMPA e um aviso explica. Manter deixaria o `<select>` em branco
 * (não existe `<option>` pro valor) enquanto o controle ainda segurava o id —
 * "válido" pro `required` e reprovado só no submit.
 */
describe('RentalForm seleção que deixa de valer no novo período', () => {
  const VEICULO_A = {
    id: 'veh-a',
    plate: 'AAA1A11',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Mobi',
    yearModel: 2022,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2026-01-01',
  };
  const MOTORISTA_A = {
    id: 'drv-a',
    name: 'Ana',
    email: null,
    phone: null,
    licenseNumber: '1',
    licenseCategory: 'B',
    licenseExpiry: '2030-01-01',
    status: 'AVAILABLE',
  };

  let vehiclesList: Mock;
  let driversList: Mock;

  async function afterDebounce(fixture: { detectChanges: () => void }): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    fixture.detectChanges();
  }

  /** Primeira busca devolve A; a partir da segunda, listas vazias. */
  function mountWithVanishingOptions(): ReturnType<typeof TestBed.createComponent<RentalForm>> {
    TestBed.resetTestingModule();
    const paged = (content: unknown[]) => of({ content, page: 0, size: 500, total: content.length });
    vehiclesList = vi
      .fn()
      .mockReturnValueOnce(paged([VEICULO_A]))
      .mockReturnValue(paged([]));
    driversList = vi
      .fn()
      .mockReturnValueOnce(paged([MOTORISTA_A]))
      .mockReturnValue(paged([]));
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        { provide: VehiclesService, useValue: { list: vehiclesList } },
        { provide: DriverService, useValue: { list: driversList } },
        { provide: RentalService, useValue: { getById: () => EMPTY, create: vi.fn() } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    return fixture;
  }

  type SelectionFormLike = {
    form: {
      patchValue: (v: Record<string, unknown>) => void;
      getRawValue: () => Record<string, unknown>;
      invalid: boolean;
    };
  };

  it('limpa a escolha que sumiu da lista, invalida o form e explica o motivo', async () => {
    const fixture = mountWithVanishingOptions();
    const cmp = fixture.componentInstance as unknown as SelectionFormLike;

    cmp.form.patchValue({ vehicleId: 'veh-a', driverId: 'drv-a' });
    fixture.detectChanges();
    expect(cmp.form.getRawValue()['vehicleId']).toBe('veh-a');

    // Usuário escolhe o período DEPOIS de selecionar — as listas encolhem.
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);

    expect(cmp.form.getRawValue()['vehicleId']).toBe('');
    expect(cmp.form.getRawValue()['driverId']).toBe('');
    expect(cmp.form.invalid).toBe(true);

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('O veículo escolhido não está livre no período informado.');
    expect(text).toContain('O motorista escolhido não está livre no período informado.');

    // O aviso é assertivo: a mudança no formulário não partiu destes campos.
    const alerts = [...fixture.nativeElement.querySelectorAll('[role="alert"]')].map((el) =>
      (el.textContent ?? '').trim(),
    );
    expect(alerts.some((t: string) => t.startsWith('O veículo escolhido'))).toBe(true);
  });

  it('o aviso some assim que o usuário escolhe outro item', async () => {
    const fixture = mountWithVanishingOptions();
    const cmp = fixture.componentInstance as unknown as SelectionFormLike;

    cmp.form.patchValue({ vehicleId: 'veh-a' });
    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);
    expect(fixture.nativeElement.textContent).toContain('O veículo escolhido não está livre');

    cmp.form.patchValue({ vehicleId: 'veh-b' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('O veículo escolhido não está livre');
  });

  it('o estado vazio explica o período em vez de culpar aluguel ativo', async () => {
    const fixture = mountWithVanishingOptions();
    const cmp = fixture.componentInstance as unknown as SelectionFormLike;

    cmp.form.patchValue({ startDate: '2026-09-01', endDate: '2026-09-10' });
    await afterDebounce(fixture);

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Nenhum veículo livre no período informado');
    expect(text).not.toContain('todos estão em aluguel ativo');
  });
});

/**
 * Espelho da regra do backend: `pickupDate` tem que cair dentro de
 * `[startDate, endDate]`, inclusivo nas duas pontas e comparado por dia.
 * O backend responde 400 quando isso é violado — o form não pode deixar chegar lá.
 */
describe('RentalForm retirada dentro do período', () => {
  let createSpy: ReturnType<typeof vi.fn>;

  type PickupFormLike = {
    form: {
      patchValue: (v: Record<string, unknown>) => void;
      invalid: boolean;
      errors: Record<string, unknown> | null;
    };
    submit: () => void;
    pickupMin: () => string | null;
    pickupMax: () => string | null;
    pickupOutsidePeriod: () => boolean;
  };

  /** Campos obrigatórios mínimos, sem as datas — cada caso escolhe as suas. */
  const baseValues = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    billingFrequency: 'MONTHLY',
    periodRateReais: 2500,
    initialKm: 42000,
    firstPaymentDate: '2026-08-05',
    dailyInterestReais: 3,
    lateFineType: 'PERCENT',
    lateFineValueInput: 2,
  };

  function mount(): {
    fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>;
    cmp: PickupFormLike;
  } {
    TestBed.resetTestingModule();
    createSpy = vi.fn().mockReturnValue(of({ id: 'rental-novo' }));
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        {
          provide: VehiclesService,
          useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) },
        },
        {
          provide: DriverService,
          useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) },
        },
        { provide: RentalService, useValue: { getById: () => EMPTY, create: createSpy } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    return { fixture, cmp: fixture.componentInstance as unknown as PickupFormLike };
  }

  it('sem período preenchido não impõe limites nem acusa erro', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({ ...baseValues, pickupDate: '2026-08-10T09:00' });
    fixture.detectChanges();

    expect(cmp.pickupMin()).toBeNull();
    expect(cmp.pickupMax()).toBeNull();
    expect(cmp.pickupOutsidePeriod()).toBe(false);
  });

  it('expõe min/max derivados do período, cobrindo o dia inteiro das duas pontas', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({ ...baseValues, startDate: '2026-08-01', endDate: '2026-08-31' });
    fixture.detectChanges();

    expect(cmp.pickupMin()).toBe('2026-08-01T00:00');
    expect(cmp.pickupMax()).toBe('2026-08-31T23:59');
  });

  it('retirada antes do início bloqueia o submit', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({
      ...baseValues,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      pickupDate: '2026-07-31T23:59',
    });
    fixture.detectChanges();

    expect(cmp.pickupOutsidePeriod()).toBe(true);
    expect(cmp.form.errors?.['pickupOutsidePeriod']).toBe(true);
    expect(cmp.form.invalid).toBe(true);

    cmp.submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('retirada depois do fim bloqueia o submit', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({
      ...baseValues,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      pickupDate: '2026-09-01T00:00',
    });
    fixture.detectChanges();

    expect(cmp.pickupOutsidePeriod()).toBe(true);
    cmp.submit();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('limite inclusivo: retirada no primeiro dia do período é válida', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({
      ...baseValues,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      pickupDate: '2026-08-01T00:00',
    });
    fixture.detectChanges();

    expect(cmp.pickupOutsidePeriod()).toBe(false);
    cmp.submit();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('limite inclusivo: retirada no último dia, em qualquer hora, é válida', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({
      ...baseValues,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      pickupDate: '2026-08-31T23:45',
    });
    fixture.detectChanges();

    expect(cmp.pickupOutsidePeriod()).toBe(false);
    cmp.submit();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('mudar o período invalida na hora uma retirada que era válida', () => {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({
      ...baseValues,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      pickupDate: '2026-08-20T10:00',
    });
    fixture.detectChanges();
    expect(cmp.pickupOutsidePeriod()).toBe(false);

    // Usuário encurta o aluguel — a retirada já digitada fica fora do período.
    cmp.form.patchValue({ endDate: '2026-08-10' });
    fixture.detectChanges();

    expect(cmp.pickupOutsidePeriod()).toBe(true);
    expect(cmp.form.invalid).toBe(true);

    const errorEl = fixture.nativeElement.querySelector('#rental-pickup-date-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.getAttribute('role')).toBe('alert');
  });
});

/**
 * Regressão: clicar em "Configure agora" nos cards de Contrato/Cobrança navega
 * pra `/configuracoes/...`, destrói o RentalForm e antes zerava tudo que o
 * usuário tinha preenchido. O rascunho em sessionStorage cobre a ida-e-volta.
 */
describe('RentalForm rascunho (ida-e-volta pras integrações)', () => {
  /** Storage compartilhado entre as duas "visitas" à página. */
  let store: Map<string, string>;
  let createSpy: ReturnType<typeof vi.fn>;

  const fakeSession = (): unknown => ({
    setItem: (k: string, v: string) => store.set(k, v),
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => store.delete(k),
  });

  /**
   * O picker precisa devolver JUSTAMENTE o par que o rascunho restaura: desde
   * que o período vai junto na busca, uma lista vazia significa "esse veículo
   * não está livre" e o formulário limpa a seleção de propósito (ver
   * `applyVehicles`). Com a lista vazia daqui, estes casos mediriam a
   * reconciliação em vez do round-trip do rascunho.
   */
  const DRAFT_VEHICLE = {
    id: 'veh-1',
    plate: 'AAA1A11',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Mobi',
    yearModel: 2022,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2026-01-01',
  };
  const DRAFT_DRIVER = {
    id: 'drv-1',
    name: 'Ana',
    email: null,
    phone: null,
    licenseNumber: '1',
    licenseCategory: 'B',
    licenseExpiry: '2030-01-01',
    status: 'AVAILABLE',
  };

  function visitNewRentalPage(): ReturnType<typeof TestBed.createComponent<RentalForm>> {
    TestBed.resetTestingModule();
    createSpy = vi.fn().mockReturnValue(of({ id: 'rental-novo' }));
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        { provide: SessionService, useValue: fakeSession() },
        {
          provide: VehiclesService,
          useValue: {
            list: () => of({ content: [DRAFT_VEHICLE], page: 0, size: 500, total: 1 }),
          },
        },
        {
          provide: DriverService,
          useValue: {
            list: () => of({ content: [DRAFT_DRIVER], page: 0, size: 500, total: 1 }),
          },
        },
        { provide: RentalService, useValue: { getById: () => EMPTY, create: createSpy } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    return fixture;
  }

  /** Campos obrigatórios mínimos pra um create válido. */
  const validValues = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    billingFrequency: 'MONTHLY',
    periodRateReais: 2500,
    caucaoReais: 800,
    notes: 'entrega na garagem',
    initialKm: 42000,
    pickupDate: '2026-08-01T09:00',
    firstPaymentDate: '2026-08-05',
    dailyInterestReais: 3,
    lateFineType: 'PERCENT',
    lateFineValueInput: 2,
  };

  type FormLike = {
    form: {
      patchValue: (v: Record<string, unknown>) => void;
      getRawValue: () => Record<string, unknown>;
    };
    draftRestored: () => boolean;
    submit: () => void;
    cancel: () => void;
  };

  beforeEach(() => {
    store = new Map<string, string>();
    // Sessão autenticada: o rascunho é chaveado por usuário + empresa.
    store.set('id', 'user-1');
    store.set('selectedCompanyId', 'company-1');
  });

  it('preserva o preenchimento ao sair pra configurar a integração e voltar', () => {
    const first = visitNewRentalPage();
    const before = first.componentInstance as unknown as FormLike;
    before.form.patchValue(validValues);
    first.detectChanges();

    // "Configure agora" → o componente é destruído pela navegação.
    first.destroy();

    const second = visitNewRentalPage();
    const after = second.componentInstance as unknown as FormLike;

    expect(after.draftRestored()).toBe(true);
    expect(after.form.getRawValue()).toMatchObject(validValues);
  });

  it('limpa o rascunho após criar o aluguel com sucesso', () => {
    const first = visitNewRentalPage();
    const cmp = first.componentInstance as unknown as FormLike;
    cmp.form.patchValue(validValues);
    first.detectChanges();

    cmp.submit();
    first.detectChanges();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect([...store.keys()].some((k) => k.startsWith('rentalDraft:'))).toBe(false);

    first.destroy();
    const second = visitNewRentalPage();
    const after = second.componentInstance as unknown as FormLike;
    expect(after.draftRestored()).toBe(false);
    expect(after.form.getRawValue()['vehicleId']).toBe('');
  });

  it('limpa o rascunho ao cancelar (saída intencional do fluxo)', () => {
    const first = visitNewRentalPage();
    const cmp = first.componentInstance as unknown as FormLike;
    cmp.form.patchValue(validValues);
    first.detectChanges();

    cmp.cancel();
    first.detectChanges();

    expect([...store.keys()].some((k) => k.startsWith('rentalDraft:'))).toBe(false);
  });

  it('a restauração (controle a controle) reavalia a retirada contra o período', () => {
    const first = visitNewRentalPage();
    const cmp = first.componentInstance as unknown as FormLike;
    // Rascunho gravado com uma retirada fora do período (ex.: período encurtado
    // logo antes de sair da página).
    cmp.form.patchValue({ ...validValues, endDate: '2026-08-10', pickupDate: '2026-08-20T09:00' });
    first.detectChanges();
    first.destroy();

    const second = visitNewRentalPage();
    const after = second.componentInstance as unknown as FormLike & {
      form: { invalid: boolean };
      pickupOutsidePeriod: () => boolean;
    };

    expect(after.draftRestored()).toBe(true);
    expect(after.pickupOutsidePeriod()).toBe(true);
    expect(after.form.invalid).toBe(true);
  });

  it('não restaura rascunho de outra empresa', () => {
    const first = visitNewRentalPage();
    const cmp = first.componentInstance as unknown as FormLike;
    cmp.form.patchValue(validValues);
    first.detectChanges();
    first.destroy();

    // Usuário troca de empresa ativa antes de voltar ao formulário.
    store.set('selectedCompanyId', 'company-2');

    const second = visitNewRentalPage();
    const after = second.componentInstance as unknown as FormLike;
    expect(after.draftRestored()).toBe(false);
    expect(after.form.getRawValue()['vehicleId']).toBe('');
  });
});

/**
 * `/configuracoes/*` virou OWNER-only (`roleGuard(['OWNER'])`), mas `/alugueis`
 * segue OWNER+MANAGER. Um MANAGER que clicasse em "Configure agora" (ou
 * confirmasse o dialog de integração ausente) era redirecionado em silêncio pro
 * `/dashboard`, perdendo o formulário. O aviso continua visível pros dois
 * papéis — o que muda é a chamada pra ação.
 */
describe('RentalForm CTAs de configuração por papel', () => {
  let navigateSpy: Mock<Router['navigate']>;

  type FormWithDialog = {
    form: { patchValue: (v: Record<string, unknown>) => void };
    missingIntegrationTarget: {
      (): 'asaas' | 'contract' | null;
      set: (v: 'asaas' | 'contract' | null) => void;
    };
    missingIntegrationMessage: () => string;
    missingIntegrationConfirmLabel: () => string;
    confirmMissingIntegration: () => void;
  };

  /** Monta o form de criação com o papel informado em `selectedRole`. */
  function mountAs(role: string): ReturnType<typeof TestBed.createComponent<RentalForm>> {
    TestBed.resetTestingModule();
    const store = new Map<string, string>([
      ['id', 'user-1'],
      ['selectedCompanyId', 'company-1'],
      ['selectedRole', role],
    ]);
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        // O ConfirmDialog usa animações; sem isso o render do dialog quebra.
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        {
          provide: SessionService,
          useValue: {
            setItem: (k: string, v: string) => store.set(k, v),
            getItem: (k: string) => store.get(k) ?? null,
            removeItem: (k: string) => store.delete(k),
          },
        },
        {
          provide: VehiclesService,
          useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) },
        },
        {
          provide: DriverService,
          useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) },
        },
        { provide: RentalService, useValue: { getById: () => EMPTY, create: () => EMPTY } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    navigateSpy = vi.fn<Router['navigate']>().mockResolvedValue(true);
    // Sem template nem Asaas: os dois cards caem no estado "não configurado".
    (fixture.componentInstance as unknown as FormWithDialog).form.patchValue({
      useContractTemplate: true,
      automaticCharge: true,
    });
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(navigateSpy);
    return fixture;
  }

  /** Rótulos dos botões do dialog de integração ausente, na ordem do DOM. */
  function dialogButtons(fixture: { nativeElement: HTMLElement }): string[] {
    return [...fixture.nativeElement.querySelectorAll('app-confirm-dialog button')].map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  /** Todos os hrefs de `/configuracoes` renderizados na página. */
  function settingsLinks(fixture: { nativeElement: HTMLElement }): string[] {
    return [...fixture.nativeElement.querySelectorAll('a[href]')]
      .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
      .filter((href) => href.includes('/configuracoes'));
  }

  it('OWNER: mantém os links "Configure agora" e a navegação do dialog', () => {
    const fixture = mountAs('OWNER');
    const cmp = fixture.componentInstance as unknown as FormWithDialog;

    const links = settingsLinks(fixture);
    expect(links).toContain('/configuracoes/contratos');
    expect(links).toContain('/configuracoes/integracoes/asaas');
    expect(fixture.nativeElement.textContent).toContain('Configure agora');

    cmp.missingIntegrationTarget.set('asaas');
    fixture.detectChanges();
    expect(cmp.missingIntegrationConfirmLabel()).toBe('Configurar Asaas');
    // Duas saídas distintas: navegar pra configuração ou ficar no formulário.
    expect(dialogButtons(fixture)).toEqual(['Voltar ao aluguel', 'Configurar Asaas']);
    cmp.confirmMissingIntegration();
    expect(navigateSpy).toHaveBeenCalledWith(['/configuracoes/integracoes/asaas']);

    cmp.missingIntegrationTarget.set('contract');
    cmp.confirmMissingIntegration();
    expect(navigateSpy).toHaveBeenCalledWith(['/configuracoes/contratos']);
  });

  it('MANAGER: mantém os avisos, sem link nem navegação pra /configuracoes', () => {
    const fixture = mountAs('MANAGER');
    const cmp = fixture.componentInstance as unknown as FormWithDialog;

    // Nenhum caminho clicável pra área fechada.
    expect(settingsLinks(fixture)).toEqual([]);

    // O aviso em si continua na tela — é o que impede o MANAGER de preencher
    // um formulário que não pode ser concluído.
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Nenhum template de contrato configurado.');
    expect(text).toContain('Nenhuma integração Asaas configurada.');
    expect(text).not.toContain('Configure agora');
    expect(text).toContain('Peça ao proprietário da conta para configurar');

    // Dialog: confirmar apenas fecha, sem navegar pra rota fechada.
    cmp.missingIntegrationTarget.set('asaas');
    fixture.detectChanges();
    expect(cmp.missingIntegrationConfirmLabel()).toBe('Entendi');
    expect(cmp.missingIntegrationMessage()).toContain('Peça ao proprietário da conta');
    // Sem navegação possível, confirmar e cancelar fariam a mesma coisa: um botão só.
    expect(dialogButtons(fixture)).toEqual(['Entendi']);
    cmp.confirmMissingIntegration();
    fixture.detectChanges();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(cmp.missingIntegrationTarget()).toBeNull();
    // O aviso do card segue visível depois de fechar o dialog.
    expect(fixture.nativeElement.textContent).toContain('Nenhuma integração Asaas configurada.');
  });
});

/**
 * Prévia de valor × total gravado pelo backend.
 *
 * REGRA — o fim do período é EXCLUSIVO: o dia da devolução não é cobrado, então
 * 05/08 → 12/08 são 7 diárias (05 a 11), não 8. Decisão do dono do produto
 * tomada em 2026-08-04 e registrada em `documentation/FIXES.md`, que elege esta
 * prévia como REFERÊNCIA do cálculo correto — quem se alinha é o backend.
 * `start == end` é o único caso com piso: a diferença dá zero, mas um aluguel de
 * um dia não pode custar R$ 0, então conta 1 diária. Mesma regra do backend em
 * `RentalPeriodPlanner.billableDays()` (`Math.max(1, end - start)`).
 *
 * A prévia cobra `rate * days` (DAILY), `rate * ceil(days/7)` (WEEKLY) e
 * `rate * ceil(days/30)` (MONTHLY) em cima desse número.
 *
 * ATENÇÃO ao histórico: em 08/08/2026 estes testes foram invertidos para o
 * inclusivo (`+1`) sem consultar a fila, e subiram para produção no `cce0203`.
 * Foi revertido. Se alguém propuser o `+1` de novo, o que está errado é a
 * proposta — confira `documentation/FIXES.md` antes de mexer nestes números.
 */
describe('RentalForm prévia de valor (fim exclusivo, referência do cálculo)', () => {
  type MoneyFormLike = {
    form: { patchValue: (v: Record<string, unknown>) => void };
    totalDays: () => number;
    billingUnits: () => number;
    totalAmountCents: () => number | null;
    totalAmountLabel: () => string;
  };

  function mount(): {
    fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>;
    cmp: MoneyFormLike;
  } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        {
          provide: VehiclesService,
          useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) },
        },
        {
          provide: DriverService,
          useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) },
        },
        { provide: RentalService, useValue: { getById: () => EMPTY, create: vi.fn() } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    return { fixture, cmp: fixture.componentInstance as unknown as MoneyFormLike };
  }

  /** Preenche período + frequência + tarifa e devolve o componente já atualizado. */
  function preview(
    startDate: string,
    endDate: string,
    billingFrequency: string,
    periodRateReais: number,
  ): MoneyFormLike {
    const { fixture, cmp } = mount();
    cmp.form.patchValue({ startDate, endDate, billingFrequency, periodRateReais });
    fixture.detectChanges();
    return cmp;
  }

  it('start == end conta 1 diária (piso: um aluguel de um dia não custa R$ 0)', () => {
    const cmp = preview('2026-08-08', '2026-08-08', 'DAILY', 100);

    expect(cmp.totalDays()).toBe(1);
    expect(cmp.billingUnits()).toBe(1);
    expect(cmp.totalAmountCents()).toBe(10_000);
  });

  it('start → start+1 conta 1 diária: o dia da devolução não é cobrado', () => {
    const cmp = preview('2026-08-08', '2026-08-09', 'DAILY', 100);

    expect(cmp.totalDays()).toBe(1);
    expect(cmp.billingUnits()).toBe(1);
    expect(cmp.totalAmountCents()).toBe(10_000);
    expect(cmp.totalAmountLabel()).toContain('100,00');
  });

  it('05/08 → 12/08 conta 7 diárias, não 8 (caso da FIXES.md: R$180/dia = R$1.260)', () => {
    const cmp = preview('2026-08-05', '2026-08-12', 'DAILY', 180);

    expect(cmp.totalDays()).toBe(7);
    expect(cmp.billingUnits()).toBe(7);
    expect(cmp.totalAmountCents()).toBe(126_000);
  });

  it('20/08 → 25/08 conta 5 diárias, não 6', () => {
    const cmp = preview('2026-08-20', '2026-08-25', 'DAILY', 150);

    expect(cmp.totalDays()).toBe(5);
    expect(cmp.totalAmountCents()).toBe(75_000);
  });

  it('faixa de 01/08 a 31/08 conta 30 diárias', () => {
    const cmp = preview('2026-08-01', '2026-08-31', 'DAILY', 100);

    expect(cmp.totalDays()).toBe(30);
    expect(cmp.billingUnits()).toBe(30);
    expect(cmp.totalAmountCents()).toBe(300_000);
  });

  it('SEMANAL: 05/08 → 12/08 são 7 dias = 1 semana (o inclusivo cobrava o dobro)', () => {
    const cmp = preview('2026-08-05', '2026-08-12', 'WEEKLY', 100);

    expect(cmp.totalDays()).toBe(7);
    expect(cmp.billingUnits()).toBe(1);
    expect(cmp.totalAmountCents()).toBe(10_000);
  });

  it('SEMANAL: 8 dias estouram a semana cheia e viram 2 semanas', () => {
    const cmp = preview('2026-08-08', '2026-08-16', 'WEEKLY', 100);

    expect(cmp.totalDays()).toBe(8);
    expect(cmp.billingUnits()).toBe(2);
    expect(cmp.totalAmountCents()).toBe(20_000);
  });

  it('MENSAL: 30 dias são 1 mês; 31 cruzam o limite e viram 2', () => {
    const umMes = preview('2026-08-01', '2026-08-31', 'MONTHLY', 2500);
    expect(umMes.totalDays()).toBe(30);
    expect(umMes.billingUnits()).toBe(1);
    expect(umMes.totalAmountCents()).toBe(250_000);

    const doisMeses = preview('2026-08-01', '2026-09-01', 'MONTHLY', 2500);
    expect(doisMeses.totalDays()).toBe(31);
    expect(doisMeses.billingUnits()).toBe(2);
    expect(doisMeses.totalAmountCents()).toBe(500_000);
  });

  // --- entrada inválida: comportamento PRESERVADO (0 dias, prévia "--") ------

  it('fim antes do início não vira erro nem 1 dia: zera a prévia', () => {
    const cmp = preview('2026-08-10', '2026-08-01', 'DAILY', 100);

    expect(cmp.totalDays()).toBe(0);
    expect(cmp.billingUnits()).toBe(0);
    expect(cmp.totalAmountCents()).toBeNull();
    expect(cmp.totalAmountLabel()).toBe('--');
  });

  it('período vazio zera a prévia', () => {
    const cmp = preview('', '', 'DAILY', 100);

    expect(cmp.totalDays()).toBe(0);
    expect(cmp.totalAmountCents()).toBeNull();
    expect(cmp.totalAmountLabel()).toBe('--');
  });

  it('data inválida (NaN) zera a prévia', () => {
    const cmp = preview('2026-13-45', '2026-08-31', 'DAILY', 100);

    expect(cmp.totalDays()).toBe(0);
    expect(cmp.totalAmountLabel()).toBe('--');
  });
});
