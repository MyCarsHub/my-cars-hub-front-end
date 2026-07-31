import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { VehicleForm } from './vehicle-form';
import { VehiclesService } from '../../services/vehicles.service';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

/**
 * Pilot for the feedback standard (phase 1):
 * - backend `fieldErrors.plate` renders INLINE under the plate field;
 * - the same message is NOT repeated in the form banner;
 * - no toast fires — the screen claimed the error, so the interceptor safety net stays quiet.
 */
describe('VehicleForm — server field errors', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  function html(): string {
    return fixture.nativeElement.innerHTML as string;
  }

  function plateError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#veiculo-plate-error');
  }

  function fillValidForm(): void {
    const form = (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form;
    form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    create = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: VehiclesService, useValue: { create, getOne: vi.fn(), update: vi.fn() } },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a duplicate-plate 409 under the plate field, not as a banner or toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Placa já cadastrada para esta empresa.',
        fieldErrors: { plate: 'Placa já cadastrada para esta empresa.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    // (a) inline, under the field, with role=alert and wired to the input
    const inline = plateError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('Placa já cadastrada para esta empresa.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const input = fixture.nativeElement.querySelector('#veiculo-plate') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('veiculo-plate-error');

    // not duplicated in the form-level banner
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    // (c) and never a toast — the safety net must stay quiet
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('renders a business error with no field in the form banner', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Limite de veículos do plano atingido.' },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    expect(html()).toContain('Limite de veículos do plano atingido.');
    expect(plateError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('clears the stale server error when the user edits the plate', () => {
    create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'dup', fieldErrors: { plate: 'Placa já cadastrada.' } },
          }),
      ),
    );

    fillValidForm();
    submit();
    expect(plateError()).not.toBeNull();

    const form = (
      fixture.componentInstance as unknown as {
        form: { controls: { plate: { setValue: (v: string) => void } } };
      }
    ).form;
    form.controls.plate.setValue('XYZ9K88');
    fixture.detectChanges();

    expect(plateError()).toBeNull();
  });
});

/**
 * FEATURE: adicionar financiamento a um veículo JÁ EXISTENTE pela tela de edição.
 *
 * Regra de negócio confirmada no backend (`VehicleService.createFinancing`):
 * `POST /v1/vehicles/{id}/financings` aceita veículo existente, mas responde 409
 * quando já há um financiamento ACTIVE — e não existe endpoint de atualização.
 * Logo: a edição ADICIONA quando não há nenhum ativo, e apenas EXIBE (somente
 * leitura, com link) quando já há.
 */
describe('VehicleForm — financiamento na edição', () => {
  const VEHICLE_ID = 'veh-1';

  let getOne: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let createFinancing: ReturnType<typeof vi.fn>;
  let createInsurance: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  interface FormApi {
    form: { patchValue: (v: unknown) => void };
    financingForm: { patchValue: (v: unknown) => void };
    insuranceForm: { patchValue: (v: unknown) => void };
    toggleFinancing: () => void;
    toggleInsurance: () => void;
    submit: () => void;
  }

  function api(): FormApi {
    return fixture.componentInstance as unknown as FormApi;
  }

  function vehicle(activeFinancing: unknown) {
    return {
      id: VEHICLE_ID,
      plate: 'ABC1D23',
      type: 'CAR',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      chassis: null,
      hodometer: 1000,
      licensingExpiration: null,
      renavam: null,
      color: null,
      purchaseDate: null,
      ipvaAmount: null,
      ipvaDueDate: null,
      ipvaStatus: null,
      fuel: null,
      activeFinancing,
    };
  }

  async function setup(activeFinancing: unknown): Promise<void> {
    getOne = vi.fn().mockReturnValue(of(vehicle(activeFinancing)));
    update = vi.fn().mockReturnValue(of({ id: VEHICLE_ID }));
    createFinancing = vi.fn().mockReturnValue(of({ id: 'fin-new' }));
    createInsurance = vi.fn().mockReturnValue(of({ id: 'ins-new' }));

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: { getOne, update, createFinancing, create: vi.fn() },
        },
        { provide: InsurancesService, useValue: { create: createInsurance } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID } } },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('cria o financiamento a partir da edição quando o veículo não tem nenhum ativo', async () => {
    await setup(null);

    api().toggleFinancing();
    api().financingForm.patchValue({
      contractDate: '2026-01-10',
      purchasePrice: 50000,
      downPayment: 10000,
      installments: 24,
      installmentAmount: 1800.5,
    });
    api().submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(createFinancing).toHaveBeenCalledTimes(1);

    const [vehicleId, payload] = createFinancing.mock.calls[0];
    expect(vehicleId).toBe(VEHICLE_ID);
    expect(payload).toMatchObject({
      contractDate: '2026-01-10',
      purchasePrice: 5_000_000,
      downPayment: 1_000_000,
      installments: 24,
      installmentAmount: 180_050,
    });

    expect(TestBed.inject(NotificationService).success).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/veiculos', VEHICLE_ID]);
  });

  it('valida o bloco de financiamento na edição — não salva nada com o bloco incompleto', async () => {
    await setup(null);

    api().toggleFinancing();
    // contractDate vazio e purchasePrice 0 → grupo inválido.
    api().submit();
    fixture.detectChanges();

    expect(update).not.toHaveBeenCalled();
    expect(createFinancing).not.toHaveBeenCalled();
    expect(fixture.nativeElement.innerHTML).toContain('Verifique os campos do financiamento.');
  });

  it('não oferece adicionar quando já existe financiamento ativo — mostra resumo e link', async () => {
    await setup({
      id: 'fin-1',
      vehicleId: VEHICLE_ID,
      contractDate: '2025-03-04',
      purchasePrice: 4_000_000,
      downPayment: null,
      totalFinanced: null,
      installments: 36,
      installmentAmount: 120_000,
      status: 'ACTIVE',
      paidOffDate: null,
      createdDate: '2025-03-04T00:00:00Z',
      modifyDate: null,
    });

    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('Adicionar financiamento');
    expect(html).toContain('Contrato');
    expect(html).toContain('04/03/2025');
    expect(html).toContain('36');
    expect(fixture.nativeElement.querySelector('a[href="/financiamentos/fin-1"]')).not.toBeNull();

    api().submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(createFinancing).not.toHaveBeenCalled();
  });

  it('mostra no banner o 409 de financiamento ativo vindo do servidor', async () => {
    await setup(null);
    createFinancing.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Veículo já possui financiamento ativo.' },
          }),
      ),
    );

    api().toggleFinancing();
    api().financingForm.patchValue({ contractDate: '2026-01-10', purchasePrice: 50000 });
    api().submit();
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Veículo já possui financiamento ativo.');
    expect(TestBed.inject(NotificationService).error).not.toHaveBeenCalled();
  });

  /**
   * Bloco de SEGURO: mesmo contrato do financiamento — opcional, valores em
   * reais convertidos para centavos, e o 409 de apólice ativa vai para o banner.
   */
  it('cria a apólice de seguro junto com a edição do veículo', async () => {
    await setup(null);

    api().toggleInsurance();
    api().insuranceForm.patchValue({
      insurer: 'Porto Seguro',
      policyNumber: 'AP-99887',
      coverageType: 'COMPREHENSIVE',
      premiumAmount: 2400.5,
      deductibleAmount: 3000,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      paymentMethod: '12x no cartão',
    });
    api().submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(createInsurance).toHaveBeenCalledTimes(1);

    const [vehicleId, payload] = createInsurance.mock.calls[0];
    expect(vehicleId).toBe(VEHICLE_ID);
    expect(payload).toMatchObject({
      insurer: 'Porto Seguro',
      policyNumber: 'AP-99887',
      coverageType: 'COMPREHENSIVE',
      premiumAmount: 240_050,
      deductibleAmount: 300_000,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      paymentMethod: '12x no cartão',
    });

    expect(navigate).toHaveBeenCalledWith(['/veiculos', VEHICLE_ID]);
  });

  it('não salva nada com o bloco de seguro incompleto', async () => {
    await setup(null);

    api().toggleInsurance();
    api().submit();
    fixture.detectChanges();

    expect(update).not.toHaveBeenCalled();
    expect(createInsurance).not.toHaveBeenCalled();
    expect(fixture.nativeElement.innerHTML).toContain('Verifique os campos do seguro.');
  });

  it('mostra no banner o 409 de apólice ativa vindo do servidor', async () => {
    await setup(null);
    createInsurance.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Veículo já possui seguro ativo.' },
          }),
      ),
    );

    api().toggleInsurance();
    api().insuranceForm.patchValue({
      insurer: 'Porto Seguro',
      policyNumber: 'AP-99887',
      coverageType: 'COMPREHENSIVE',
      premiumAmount: 2400,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
    api().submit();
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Veículo já possui seguro ativo.');
    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(NotificationService).error).not.toHaveBeenCalled();
  });
});
