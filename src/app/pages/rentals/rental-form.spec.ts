import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { of, EMPTY } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
