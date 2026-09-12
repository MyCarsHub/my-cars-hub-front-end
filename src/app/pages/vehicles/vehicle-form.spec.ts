import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { signal } from '@angular/core';
import { VehicleForm } from './vehicle-form';
import { VehiclesService } from '../../services/vehicles.service';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { FipeService } from '../../services/fipe.service';
import { VEHICLE_LOOKUPS } from './vehicle-lookups.flags';

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
        { provide: VehiclesService, useValue: { create, getOne: vi.fn(), update: vi.fn(), plateLookupUnavailable: signal(false) } },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
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
          useValue: { getOne, update, createFinancing, create: vi.fn(), plateLookupUnavailable: signal(false) },
        },
        { provide: InsurancesService, useValue: { create: createInsurance } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID }, queryParamMap: { get: () => null } } },
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
      paymentMethod: 'CREDIT_CARD',
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
      paymentMethod: 'CREDIT_CARD',
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

  /**
   * FEAT-0053: o bloco de documentos é exclusivo do CADASTRO. Na edição (rota
   * com id) quem cuida dos anexos é o card do detalhe — o bloco não renderiza.
   */
  it('não renderiza o bloco de documentos na edição — sem slots de anexar nem picker', async () => {
    await setup(null);

    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('Documentos (opcional)');
    expect(fixture.nativeElement.querySelector('[data-doc-slot]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
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

/**
 * FIX (dano de dado): CRIAÇÃO com bloco filho que falha.
 *
 * O POST do veículo já passou; se o form continuar com `editingId` nulo, o
 * próximo submit dispara outro POST e o usuário fica com o veículo DUPLICADO.
 * O banner também precisa dizer que o veículo foi salvo — era justamente a
 * ausência dessa frase que levava o usuário a reenviar.
 */
describe('VehicleForm — criação com falha no bloco filho', () => {
  const NEW_ID = 'veh-novo';

  let create: ReturnType<typeof vi.fn>;
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
    isEdit: () => boolean;
  }

  function api(): FormApi {
    return fixture.componentInstance as unknown as FormApi;
  }

  function fillValidVehicle(): void {
    api().form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  function fillValidInsurance(): void {
    api().insuranceForm.patchValue({
      insurer: 'Porto Seguro',
      policyNumber: 'AP-99887',
      coverageType: 'COMPREHENSIVE',
      premiumAmount: 2400,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of({ id: NEW_ID }));
    update = vi.fn().mockReturnValue(of({ id: NEW_ID }));
    createFinancing = vi.fn().mockReturnValue(of({ id: 'fin-new' }));
    createInsurance = vi.fn().mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Veículo já possui seguro ativo.' },
          }),
      ),
    );

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: { create, update, createFinancing, getOne: vi.fn(), plateLookupUnavailable: signal(false) },
        },
        { provide: InsurancesService, useValue: { create: createInsurance } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
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
  });

  it('reenviar depois da falha do seguro NÃO cria um segundo veículo — vira edição do mesmo', () => {
    fillValidVehicle();
    api().toggleInsurance();
    fillValidInsurance();

    api().submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(createInsurance).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    // O veículo existe: o form assumiu o id e virou edição.
    expect(api().isEdit()).toBe(true);

    // Reenvio (o usuário insiste depois de ver o erro).
    api().submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe(NEW_ID);
    expect(createInsurance).toHaveBeenCalledTimes(2);
  });

  it('o banner diz que o veículo foi salvo e preserva o motivo do servidor', () => {
    fillValidVehicle();
    api().toggleInsurance();
    fillValidInsurance();

    api().submit();
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('app-alert-banner') as HTMLElement | null;
    const text = banner?.textContent ?? '';
    expect(text).toContain('O veículo foi salvo');
    expect(text).toContain('seguro não foi adicionado');
    expect(text).toContain('Veículo já possui seguro ativo.');
  });

  it('mesma garantia para o bloco de financiamento', () => {
    createFinancing.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Veículo já possui financiamento ativo.' },
          }),
      ),
    );

    fillValidVehicle();
    api().toggleFinancing();
    api().financingForm.patchValue({ contractDate: '2026-01-10', purchasePrice: 50000 });

    api().submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(api().isEdit()).toBe(true);

    const text = (fixture.nativeElement.querySelector('app-alert-banner') as HTMLElement | null)
      ?.textContent;
    expect(text).toContain('O veículo foi salvo');
    expect(text).toContain('Veículo já possui financiamento ativo.');
  });
});

/**
 * FEAT-0053: anexar documentos no CADASTRO. O bloco de pendentes guarda os
 * arquivos escolhidos e o `saveChildren` os envia como TERCEIRO elo, um por
 * chamada, depois de financiamento e seguro. Falha parcial mantém o veículo
 * criado (id promovido, banner "foi salvo") e o reenvio sobe SÓ o que faltou —
 * reenviar um `uploaded` duplicaria o documento, porque o backend acrescenta.
 */
describe('VehicleForm — documentos no cadastro', () => {
  const NEW_ID = 'veh-novo';

  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let uploadDocument: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  const crlvFile = new File(['crlv'], 'crlv.pdf', { type: 'application/pdf' });
  const fotoFile = new File(['foto'], 'foto.png', { type: 'image/png' });

  interface FormApi {
    form: { patchValue: (v: unknown) => void };
    submit: () => void;
    isEdit: () => boolean;
  }

  function api(): FormApi {
    return fixture.componentInstance as unknown as FormApi;
  }

  function fillValidVehicle(): void {
    api().form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  /**
   * O gesto completo no bloco COMPARTILHADO (FIX-0232): toca no slot do tipo e
   * escolhe UM arquivo — o seletor múltiplo morreu com a regra de um por tipo.
   */
  function pick(kind: 'CRLV' | 'OTHER', file: File): void {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const slot = host.querySelector<HTMLButtonElement>(`[data-doc-slot="${kind}"] > button`);
    if (!slot) throw new Error(`slot ${kind} não está na tela`);
    slot.click();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('o seletor de arquivos não está na tela');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function pendingRows(): NodeListOf<HTMLElement> {
    return fixture.nativeElement.querySelectorAll('[data-doc-slot] ul > li');
  }

  function bannerText(): string {
    return (
      (fixture.nativeElement.querySelector('app-alert-banner') as HTMLElement | null)
        ?.textContent ?? ''
    );
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of({ id: NEW_ID }));
    update = vi.fn().mockReturnValue(of({ id: NEW_ID }));
    uploadDocument = vi.fn().mockReturnValue(of({ id: 'doc-ok' }));
    notifySuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: { create, update, uploadDocument, getOne: vi.fn(), plateLookupUnavailable: signal(false) },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: notifySuccess },
        },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  });

  it('envia os arquivos escolhidos (um por tipo), um por chamada e na ordem, e navega para o detalhe', () => {
    fillValidVehicle();
    pick('CRLV', crlvFile);
    pick('OTHER', fotoFile);
    expect(pendingRows().length).toBe(2);

    api().submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(uploadDocument.mock.calls[0]).toEqual([NEW_ID, 'CRLV', crlvFile]);
    expect(uploadDocument.mock.calls[1]).toEqual([NEW_ID, 'OTHER', fotoFile]);
    expect(notifySuccess).toHaveBeenCalledWith('2 documentos anexados ao veículo.');
    expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
  });

  it('falha de um upload mantém o veículo criado e o reenvio sobe SÓ o que faltou', () => {
    let fotoFalha = true;
    uploadDocument.mockImplementation((_id: string, _kind: string, file: File) =>
      file === fotoFile && fotoFalha
        ? throwError(
            () =>
              new HttpErrorResponse({
                status: 500,
                error: { message: 'Falha no armazenamento.' },
              }),
          )
        : of({ id: 'doc-ok' }),
    );

    fillValidVehicle();
    pick('CRLV', crlvFile);
    pick('OTHER', fotoFile);

    api().submit();
    fixture.detectChanges();

    // O veículo existe; o form virou edição e ninguém navegou.
    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(api().isEdit()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(bannerText()).toContain('O veículo foi salvo, mas 1 documento não foi enviado.');
    expect(bannerText()).toContain('Falha no armazenamento.');
    expect(TestBed.inject(NotificationService).error).not.toHaveBeenCalled();

    // Reenvio: vira PUT do mesmo veículo e reenvia APENAS o arquivo que falhou.
    fotoFalha = false;
    api().submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe(NEW_ID);
    expect(uploadDocument).toHaveBeenCalledTimes(3);
    expect(uploadDocument.mock.calls[2]).toEqual([NEW_ID, 'OTHER', fotoFile]);
    expect(navigate).toHaveBeenCalledWith(['/veiculos', NEW_ID]);
  });

  /**
   * FIX-0232 — UM arquivo por tipo: escolher de novo SUBSTITUI o pendente,
   * nunca acrescenta (a antiga dedup por nome+tamanho fica subsumida).
   */
  it('substitui o pendente ao escolher outro arquivo do mesmo tipo — e é o novo que sobe', () => {
    const crlvNovo = new File(['novo'], 'crlv-2026.pdf', { type: 'application/pdf' });
    fillValidVehicle();
    pick('CRLV', crlvFile);
    pick('CRLV', crlvNovo);

    expect(pendingRows().length).toBe(1);
    expect((pendingRows()[0].textContent ?? '')).toContain('crlv-2026.pdf');

    api().submit();
    fixture.detectChanges();

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadDocument.mock.calls[0]).toEqual([NEW_ID, 'CRLV', crlvNovo]);
  });

  it('recusa arquivo fora da allowlist com a mensagem das regras compartilhadas no banner', () => {
    const exe = new File(['x'], 'virus.exe', { type: 'application/octet-stream' });
    pick('CRLV', exe);

    expect(pendingRows().length).toBe(0);
    expect(bannerText()).toContain('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
  });
});

/**
 * FIX: submit inválido — o banner deve sumir sozinho quando o formulário volta
 * a ser válido (antes ficava preso até o próximo submit) e o foco deve ir para
 * o primeiro campo inválido (antes ficava no botão de submit).
 */
describe('VehicleForm — banner de validação e foco no submit inválido', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  interface FormApi {
    form: {
      patchValue: (v: unknown) => void;
      controls: { yearManufacture: { setValue: (v: unknown) => void } };
    };
    financingForm: { patchValue: (v: unknown) => void };
    toggleFinancing: () => void;
    submit: () => void;
  }

  function api(): FormApi {
    return fixture.componentInstance as unknown as FormApi;
  }

  function banner(): HTMLElement | null {
    return fixture.nativeElement.querySelector('app-alert-banner');
  }

  function fillValidVehicle(): void {
    api().form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: { create: vi.fn(), getOne: vi.fn(), update: vi.fn(), plateLookupUnavailable: signal(false) },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        // Marcas NÃO vazias: esta suíte precisa validar o modo FIPE de verdade —
        // lista vazia cai para manual e o foco nunca visitaria os selects.
        {
          provide: FipeService,
          useValue: {
            brands: () => of([{ code: '21', name: 'Fiat' }]),
            models: () => of([]),
            years: () => of([]),
          },
        },
        { provide: VEHICLE_LOOKUPS, useValue: { fipeCatalog: true, plateLookup: true } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  });

  it('mostra o banner e foca o primeiro campo inválido (placa) no submit inválido', () => {
    api().submit();
    fixture.detectChanges();

    expect(banner()).not.toBeNull();
    expect(fixture.nativeElement.innerHTML).toContain(
      'Verifique os campos destacados e tente novamente.',
    );
    expect(document.activeElement?.id).toBe('veiculo-plate');
  });

  it('foca o primeiro inválido em ordem de documento quando a placa está ok', () => {
    fillValidVehicle();
    api().form.controls.yearManufacture.setValue(null);
    fixture.detectChanges();

    api().submit();
    fixture.detectChanges();

    expect(document.activeElement?.id).toBe('veiculo-year-manufacture');
  });

  it('em modo FIPE, marca vazia foca o SELECT de marca (não tem ng-invalid nem app-primary-input)', () => {
    // Só a placa ok: brand/model vazios, e a tela está no modo FIPE (padrão).
    api().form.patchValue({ plate: 'ABC1D23' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).not.toBeNull();

    api().submit();
    fixture.detectChanges();

    expect(document.activeElement?.id).toBe('veiculo-fipe-brand');
  });

  it('limpa o banner assim que o formulário volta a ser válido, sem novo submit', () => {
    api().submit();
    fixture.detectChanges();
    expect(banner()).not.toBeNull();

    fillValidVehicle();
    fixture.detectChanges();

    expect(banner()).toBeNull();
  });

  it('faz o mesmo para o bloco de financiamento: foca o campo e solta o banner', () => {
    fillValidVehicle();
    api().toggleFinancing();
    fixture.detectChanges();

    api().submit();
    fixture.detectChanges();

    expect(fixture.nativeElement.innerHTML).toContain('Verifique os campos do financiamento.');
    expect(document.activeElement?.id).toBe('financiamento-contract-date');

    api().financingForm.patchValue({ contractDate: '2026-01-10', purchasePrice: 50000 });
    fixture.detectChanges();

    expect(banner()).toBeNull();
  });
});

/**
 * FEAT-0059 — "Valor total (R$)" (`purchasePrice` do VEÍCULO, centavos na API),
 * no mesmo idioma de `ipvaAmount`: nulável, reais no form, `toCents()` no submit.
 * O ponto CRÍTICO é a edição: o PUT é full-replace, então o form de edição
 * precisa carregar E reenviar o valor — sem isso, salvar uma edição qualquer
 * apagaria em silêncio um valor já gravado pela API.
 */
describe('VehicleForm — valor total do veículo (FEAT-0059)', () => {
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  interface FormApi {
    form: {
      patchValue: (v: unknown) => void;
      getRawValue: () => { purchasePrice: number | null };
    };
    submit: () => void;
  }

  function api(): FormApi {
    return fixture.componentInstance as unknown as FormApi;
  }

  function fillValidVehicle(): void {
    api().form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  async function setup(routeId: string | null, vehicle?: Record<string, unknown>): Promise<void> {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of({ id: 'veh-novo' }));
    update = vi.fn().mockReturnValue(of({ id: 'veh-1' }));
    getOne = vi.fn().mockReturnValue(of(vehicle));

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: { create, update, getOne, createFinancing: vi.fn(), plateLookupUnavailable: signal(false) },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => routeId }, queryParamMap: { get: () => null } } } },
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

  function editVehicle(purchasePrice: number | null): Record<string, unknown> {
    return {
      id: 'veh-1',
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
      purchasePrice,
      ipvaAmount: null,
      ipvaDueDate: null,
      ipvaStatus: null,
      fuel: null,
      activeFinancing: null,
    };
  }

  it('cadastro: converte reais para centavos no POST, idioma do ipvaAmount', async () => {
    await setup(null);

    // O campo existe no template, fora do bloco de financiamento.
    expect(fixture.nativeElement.querySelector('#veiculo-purchase-price')).not.toBeNull();

    fillValidVehicle();
    api().form.patchValue({ purchasePrice: 45000.5 });
    api().submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ purchasePrice: 4_500_050 });
    expect(navigate).toHaveBeenCalledWith(['/veiculos', 'veh-novo']);
  });

  it('cadastro: campo vazio vai como null, nunca 0', async () => {
    await setup(null);

    fillValidVehicle();
    api().submit();

    expect(create.mock.calls[0][0].purchasePrice).toBeNull();
  });

  it('edição: carrega centavos como reais e o PUT reenvia o valor — full-replace não pode apagar', async () => {
    await setup('veh-1', editVehicle(4_500_050));

    // 4_500_050 centavos → 45000.5 reais no form.
    expect(api().form.getRawValue().purchasePrice).toBe(45000.5);

    // Salvar SEM tocar no campo: o valor volta intacto no payload do PUT.
    api().submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe('veh-1');
    expect(update.mock.calls[0][1]).toMatchObject({ purchasePrice: 4_500_050 });
  });

  it('edição: veículo sem valor continua sem valor depois de salvar', async () => {
    await setup('veh-1', editVehicle(null));

    expect(api().form.getRawValue().purchasePrice).toBeNull();
    api().submit();
    expect(update.mock.calls[0][1].purchasePrice).toBeNull();
  });
});

/**
 * FIX-0250 — o formulário de edição respeita a venda.
 *
 * `/veiculos/:id/editar` continua acessível por deep-link num veículo VENDIDO.
 * Não há corrupção (o backend recusa o PUT com 409 via `assertNotSold`), mas
 * preencher a tela inteira para levar erro no "Salvar" é trabalho jogado fora:
 * a regra passa a aparecer ANTES, com a MESMA frase do detalhe.
 */
describe('VehicleForm — veículo vendido é somente-leitura (FIX-0250)', () => {
  const VEHICLE_ID = 'veh-1';

  const SALE = {
    id: 'sale-1',
    buyerName: 'Maria Compradora',
    saleDate: '2026-08-20',
    saleValueCents: 4_500_000,
    createdDate: '2026-08-20T10:00:00',
  };

  let getOne: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let createFinancing: ReturnType<typeof vi.fn>;
  let createInsurance: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  interface SoldFormApi {
    form: {
      disabled: boolean;
      patchValue: (v: unknown) => void;
      getRawValue: () => { plate: string };
    };
    financingForm: { disabled: boolean };
    insuranceForm: { disabled: boolean };
    submit: () => void;
    toggleFinancing: () => void;
    toggleInsurance: () => void;
    showFinancing: () => boolean;
    sold: () => boolean;
  }

  function api(): SoldFormApi {
    return fixture.componentInstance as unknown as SoldFormApi;
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function submitButton(): HTMLButtonElement {
    const btn = host().querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!btn) throw new Error('o botão de salvar não está na tela');
    return btn;
  }

  function soldVehicle(sale: unknown) {
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
      purchasePrice: null,
      ipvaAmount: null,
      ipvaDueDate: null,
      ipvaStatus: null,
      fuel: null,
      activeFinancing: null,
      sale,
    };
  }

  async function setup(sale: unknown): Promise<void> {
    getOne = vi.fn().mockReturnValue(of(soldVehicle(sale)));
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
          useValue: { getOne, update, createFinancing, create: vi.fn(), plateLookupUnavailable: signal(false) },
        },
        { provide: InsurancesService, useValue: { create: createInsurance } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID }, queryParamMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('mostra o aviso com a MESMA frase do detalhe e desabilita o salvar', async () => {
    await setup(SALE);

    const notice = host().querySelector('[data-sold-notice]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(
      'Veículo vendido em 20/08/2026. Desfaça a venda para voltar a operar.',
    );

    // Desabilitado, NÃO escondido — e com o motivo no title.
    const salvar = submitButton();
    expect(salvar.disabled).toBe(true);
    expect(salvar.getAttribute('title')).toContain('Veículo vendido em 20/08/2026');
  });

  it('deixa os TRÊS formulários inertes (veículo, financiamento e seguro)', async () => {
    await setup(SALE);

    expect(api().form.disabled).toBe(true);
    expect(api().financingForm.disabled).toBe(true);
    expect(api().insuranceForm.disabled).toBe(true);
  });

  /**
   * O MODELO desabilitado não basta, e foi esse buraco que deixou passar a
   * placa editável: o input da placa é CRU (`[value]` + `(input)`), não
   * `formControlName`, e o `appFieldControl` só escreve id/aria/classe — não
   * propaga `disabled`. Então `form.disable()` NÃO o alcança. Esta asserção
   * olha o DOM RENDERIZADO: todo campo de entrada precisa estar `disabled`.
   */
  it('nenhum campo RENDERIZADO aceita digitação — inclusive a placa (input cru)', async () => {
    await setup(SALE);

    const campos = Array.from(
      host().querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    );
    // Sanidade: a tela realmente renderizou campos (senão a varredura é vazia
    // e o teste passaria sem provar nada).
    expect(campos.length).toBeGreaterThan(5);

    const habilitados = campos.filter((el) => !el.disabled).map((el) => el.id || el.tagName);
    expect(habilitados).toEqual([]);

    // A placa, nomeada: é o campo cru que o `form.disable()` não alcança.
    const placa = host().querySelector<HTMLInputElement>('#veiculo-plate');
    expect(placa).not.toBeNull();
    expect(placa?.disabled).toBe(true);
  });

  /** O handler do input cru também recusa por dentro (caminho programático). */
  it('onPlateInput não escreve no controle quando o veículo está vendido', async () => {
    await setup(SALE);

    const antes = api().form.getRawValue().plate;
    const input = document.createElement('input');
    input.value = 'XYZ9K88';
    (
      fixture.componentInstance as unknown as { onPlateInput: (e: Event) => void }
    ).onPlateInput({ target: input } as unknown as Event);
    fixture.detectChanges();

    expect(api().form.getRawValue().plate).toBe(antes);
  });

  it('os botões de adicionar financiamento e seguro ficam desabilitados, com motivo', async () => {
    await setup(SALE);

    const botoes = Array.from(host().querySelectorAll('button')).filter((b) =>
      /Adicionar (financiamento|seguro)/.test(b.textContent ?? ''),
    );
    expect(botoes).toHaveLength(2);
    for (const botao of botoes) {
      expect(botao.disabled).toBe(true);
      expect(botao.getAttribute('title')).toContain('Veículo vendido em 20/08/2026');
    }
  });

  /**
   * A guarda tem de estar no COMPONENTE: um `disabled` no botão não impede
   * submit por Enter no campo nem chamada programática, e o backend responderia
   * 409 depois da viagem.
   */
  it('submit() não chama a API no veículo vendido', async () => {
    await setup(SALE);

    api().submit();

    expect(update).not.toHaveBeenCalled();
    expect(createFinancing).not.toHaveBeenCalled();
    expect(createInsurance).not.toHaveBeenCalled();
  });

  it('não abre os blocos opcionais de financiamento/seguro quando vendido', async () => {
    await setup(SALE);

    api().toggleFinancing();
    fixture.detectChanges();

    expect(api().showFinancing()).toBe(false);
  });

  /** CONTROLE POSITIVO: sem venda, a mesma tela continua editável e salva. */
  it('veículo NÃO vendido continua editável e salvando normalmente', async () => {
    await setup(null);

    expect(host().querySelector('[data-sold-notice]')).toBeNull();
    expect(api().sold()).toBe(false);
    expect(api().form.disabled).toBe(false);
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().getAttribute('title')).toBeNull();
    // E a placa — o campo cru — continua digitável.
    expect(host().querySelector<HTMLInputElement>('#veiculo-plate')?.disabled).toBe(false);

    api().submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe(VEHICLE_ID);
  });
});

/**
 * FEAT-0080 — o elo do formulário com o gate de ativação:
 * - a faixa só existe sob `?ativacao=1` (criação);
 * - "Pular por enquanto" registra o pulo e vai ao dashboard;
 * - o POST de criação avisa o cache (`markHasVehicles`) — quebrado, o gate
 *   devolveria o usuário ao cadastro DEPOIS de cadastrar.
 */
describe('VehicleForm — gate de ativação (FEAT-0080)', () => {
  let create: ReturnType<typeof vi.fn>;
  let markHasVehicles: ReturnType<typeof vi.fn>;
  let skip: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn().mockReturnValue(of({ id: 'v-9' }));
    markHasVehicles = vi.fn();
    skip = vi.fn();
  });

  function render(ativacao: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: VehiclesService, useValue: { create, getOne: vi.fn(), update: vi.fn(), plateLookupUnavailable: signal(false) } },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => null },
              queryParamMap: {
                get: (key: string) => (ativacao && key === 'ativacao' ? '1' : null),
              },
            },
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
        { provide: FleetActivationService, useValue: { markHasVehicles, skip } },
      ],
    });

    const fixture = TestBed.createComponent(VehicleForm);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    return { fixture, navigate };
  }

  function fillValid(fixture: { componentInstance: unknown }): void {
    (
      fixture.componentInstance as { form: { patchValue: (v: unknown) => void } }
    ).form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
  }

  it('mostra a faixa com "Pular por enquanto" sob ?ativacao=1 — e só aí', () => {
    const withBanner = render(true);
    const banner = withBanner.fixture.nativeElement.querySelector('[data-activation-notice]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Cadastre seu primeiro veículo para destravar o painel.');
    expect(banner?.textContent).toContain('Pular por enquanto');

    const without = render(false);
    expect(without.fixture.nativeElement.querySelector('[data-activation-notice]')).toBeNull();
  });

  it('"Pular por enquanto" registra o pulo (senão o gate devolve para cá) e navega ao dashboard', () => {
    const { fixture, navigate } = render(true);

    const skipBtn = Array.from(
      fixture.nativeElement.querySelectorAll(
        '[data-activation-notice] button',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.includes('Pular por enquanto'));
    expect(skipBtn).toBeTruthy();
    skipBtn!.click();

    expect(skip).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(create).not.toHaveBeenCalled();
  });

  it('o POST de criação chama markHasVehicles() — o gate para de interceptar na hora', () => {
    const { fixture, navigate } = render(true);
    fillValid(fixture);

    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(markHasVehicles).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/veiculos', 'v-9']);
  });

  it('POST que falha NÃO marca o cache', () => {
    create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } })),
    );
    const { fixture } = render(true);
    fillValid(fixture);

    (fixture.componentInstance as unknown as { submit: () => void }).submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(markHasVehicles).not.toHaveBeenCalled();
  });
});

/**
 * FEAT-0082 — busca pela placa, contrato congelado (FEAT-0081). Cada status
 * tem tradução própria e NENHUM deles bloqueia o cadastro manual: a resposta
 * vira nota discreta, nunca banner de erro nem toast.
 */
describe('VehicleForm — busca pela placa (FEAT-0082)', () => {
  let plateLookup: ReturnType<typeof vi.fn>;
  let plateLookupUnavailable: ReturnType<typeof signal<boolean>>;
  let notifyError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plateLookup = vi.fn();
    plateLookupUnavailable = signal(false);
    notifyError = vi.fn();
  });

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: {
            create: vi.fn(),
            getOne: vi.fn(),
            update: vi.fn(),
            plateLookup,
            plateLookupUnavailable,
          },
        },
        { provide: VEHICLE_LOOKUPS, useValue: { fipeCatalog: true, plateLookup: true } },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
    return fixture;
  }

  function typePlate(fixture: { nativeElement: HTMLElement; detectChanges: () => void }, plate: string): void {
    const input = fixture.nativeElement.querySelector('#veiculo-plate') as HTMLInputElement;
    input.value = plate;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function lookupButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('[data-plate-lookup]');
  }

  function note(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.querySelector('[data-plate-lookup-note]')?.textContent?.trim() ?? '';
  }

  function failWith(status: number, headers?: HttpHeaders): void {
    plateLookup.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status, error: { message: 'boom' }, headers })),
    );
  }

  it('o botão só existe com placa completa e válida', () => {
    const fixture = render();
    expect(lookupButton(fixture)).toBeNull();

    typePlate(fixture, 'ABC1');
    expect(lookupButton(fixture)).toBeNull();

    typePlate(fixture, 'ABC1D23');
    expect(lookupButton(fixture)).not.toBeNull();
  });

  it('501 já visto na sessão → botão VISÍVEL porém desabilitado (não some sob o cursor)', () => {
    plateLookupUnavailable.set(true);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');

    const button = lookupButton(fixture);
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    button!.click();
    expect(plateLookup).not.toHaveBeenCalled();
  });

  it('200 → preenche marca/modelo/anos/cor/combustível, tudo segue editável', () => {
    plateLookup.mockReturnValue(
      of({
        plate: 'ABC1D23',
        brand: 'Fiat',
        model: 'Argo Drive 1.0',
        manufactureYear: 2021,
        modelYear: 2022,
        fuel: 'Gasolina',
        color: 'Prata',
      }),
    );
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();

    const form = (fixture.componentInstance as unknown as { form: { getRawValue: () => Record<string, unknown>; hasError: (e: string) => boolean } }).form;
    const raw = form.getRawValue();
    expect(raw['brand']).toBe('Fiat');
    expect(raw['model']).toBe('Argo Drive 1.0');
    expect(raw['yearManufacture']).toBe(2021);
    expect(raw['yearModel']).toBe(2022);
    expect(raw['color']).toBe('Prata');
    expect(raw['fuel']).toBe('GASOLINA');
    expect(note(fixture)).toContain('Confira e ajuste');
    // yearRangeValidator continua satisfeito (2022 = 2021 + 1).
    expect(form.hasError('yearModelRange')).toBe(false);
    // Editável: os inputs manuais estão visíveis (modo manual) e habilitados.
    const brandInput = fixture.nativeElement.querySelector(
      'app-primary-input[formcontrolname="brand"] input',
    ) as HTMLInputElement | null;
    expect(brandInput).not.toBeNull();
    expect(brandInput!.disabled).toBe(false);
  });

  it('204 (não encontrada) → nota discreta e formulário intacto', () => {
    plateLookup.mockReturnValue(of(null));
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();

    expect(note(fixture)).toContain('não encontrada');
    const raw = (fixture.componentInstance as unknown as { form: { getRawValue: () => Record<string, unknown> } }).form.getRawValue();
    expect(raw['brand']).toBe('');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
  });

  it('402 (papel sem permissão) → nota fala de papel, JAMAIS de plano/upgrade', () => {
    failWith(402);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();

    const text = note(fixture);
    expect(text).toContain('papel');
    expect(text.toLowerCase()).not.toContain('plano');
    expect(text.toLowerCase()).not.toContain('upgrade');
    expect(text.toLowerCase()).not.toContain('assinatura');
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('429 → nota com os segundos do Retry-After', () => {
    failWith(429, new HttpHeaders({ 'Retry-After': '42' }));
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();

    expect(note(fixture)).toContain('42');
  });

  it('503 (provedor fora) → nota de tentar de novo, formulário manual intacto', () => {
    failWith(503);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();

    expect(note(fixture)).toContain('Tente novamente');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(fixture.nativeElement.querySelector('#veiculo-plate')).not.toBeNull();
    // SILENT_HTTP_ERRORS: 5xx é do componente — nada de toast vermelho.
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('501 → nota de uma linha, botão desabilitado, sem retry na sessão e sem toast', () => {
    failWith(501);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    // O VehiclesService REAL marca a sessão no 501 (provado no spec do serviço);
    // aqui o serviço é mock, então o sinal é virado à mão.
    plateLookupUnavailable.set(true);
    fixture.detectChanges();

    expect(note(fixture)).toContain('indisponível');
    const button = lookupButton(fixture);
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    button!.click();
    expect(plateLookup).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
  });

  it('digitar após o 501 PRESERVA a nota de indisponibilidade — botão desabilitado nunca fica mudo', () => {
    failWith(501);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    plateLookupUnavailable.set(true);
    fixture.detectChanges();
    expect(note(fixture)).toContain('indisponível');

    // Digitar limpa notas de busca (placa anterior), mas a indisponibilidade
    // vale a sessão inteira e é rederivada — senão sobra botão morto sem texto.
    typePlate(fixture, 'XYZ9A88');
    expect(note(fixture)).toContain('indisponível');
    expect(lookupButton(fixture)!.disabled).toBe(true);
  });

  it('digitar outra placa limpa a nota da busca anterior', () => {
    plateLookup.mockReturnValue(of(null));
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();
    expect(note(fixture)).toContain('não encontrada');

    // A nota descrevia a placa A; digitando a placa B ela precisa sumir.
    typePlate(fixture, 'XYZ9A88');
    expect(note(fixture)).toBe('');
  });

  it('400 → nota de placa inválida, sem banner', () => {
    failWith(400);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    lookupButton(fixture)!.click();
    fixture.detectChanges();

    expect(note(fixture)).toContain('inválida');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
  });

  it('sem duplo disparo: cliques com busca em voo não repetem a chamada', () => {
    plateLookup.mockReturnValue(NEVER);
    const fixture = render();
    typePlate(fixture, 'ABC1D23');
    const button = lookupButton(fixture)!;
    button.click();
    fixture.detectChanges();
    button.click();
    button.click();

    expect(plateLookup).toHaveBeenCalledTimes(1);
  });
});

/**
 * FEAT-0084 — listas encadeadas FIPE com escape hatch obrigatório. Os selects
 * apenas PREENCHEM os controls existentes; o submit não muda e a FIPE nunca
 * bloqueia o cadastro (falha → modo manual em silêncio).
 */
describe('VehicleForm — catálogo FIPE (FEAT-0084)', () => {
  const BRANDS = [{ code: '21', name: 'Fiat' }];
  const MODELS = [{ code: '473', name: 'Argo Drive 1.0' }];
  const YEARS = [
    { code: '2022-1', name: '2022 Gasolina' },
    { code: '32000-1', name: 'Zero KM' },
  ];

  let brands: ReturnType<typeof vi.fn>;
  let models: ReturnType<typeof vi.fn>;
  let years: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let fipeNotifyError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fipeNotifyError = vi.fn();
    brands = vi.fn().mockReturnValue(of(BRANDS));
    models = vi.fn().mockReturnValue(of(MODELS));
    years = vi.fn().mockReturnValue(of(YEARS));
    create = vi.fn().mockReturnValue(of({ id: 'v-1' }));
  });

  function render(routeId: string | null = null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: {
            create,
            update: vi.fn(),
            getOne: vi.fn().mockReturnValue(
              of({ id: 'v-1', plate: 'ABC1D23', type: 'CAR', brand: 'Fiat', model: 'Uno', yearManufacture: 2020, yearModel: 2020, hodometer: 0 }),
            ),
            plateLookup: vi.fn(),
            plateLookupUnavailable: signal(false),
          },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands, models, years } },
        { provide: VEHICLE_LOOKUPS, useValue: { fipeCatalog: true, plateLookup: true } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => routeId }, queryParamMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: fipeNotifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
    return fixture;
  }

  function select(fixture: { nativeElement: HTMLElement; detectChanges: () => void }, selector: string, value: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function rawForm(fixture: { componentInstance: unknown }): Record<string, unknown> {
    return (fixture.componentInstance as { form: { getRawValue: () => Record<string, unknown> } }).form.getRawValue();
  }

  it('cadastro abre no modo FIPE e a cadeia marca → modelo → ano preenche os controls', () => {
    const fixture = render();

    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).not.toBeNull();
    expect(brands).toHaveBeenCalledTimes(1);

    select(fixture, '[data-fipe-brand]', '21');
    expect(models).toHaveBeenCalledWith('21');
    expect(rawForm(fixture)['brand']).toBe('Fiat');

    select(fixture, '[data-fipe-model]', '473');
    expect(years).toHaveBeenCalledWith('21', '473');
    expect(rawForm(fixture)['model']).toBe('Argo Drive 1.0');

    select(fixture, '[data-fipe-year]', '2022-1');
    expect(rawForm(fixture)['yearManufacture']).toBe(2022);
    expect(rawForm(fixture)['yearModel']).toBe(2022);
    // yearRangeValidator satisfeito: mesmo ano nos dois campos.
    const form = (fixture.componentInstance as unknown as { form: { hasError: (e: string) => boolean } }).form;
    expect(form.hasError('yearModelRange')).toBe(false);
  });

  it('ano sem número ("Zero KM") não mexe nos campos de ano', () => {
    const fixture = render();
    const before = rawForm(fixture)['yearModel'];

    select(fixture, '[data-fipe-brand]', '21');
    select(fixture, '[data-fipe-model]', '473');
    select(fixture, '[data-fipe-year]', '32000-1');

    expect(rawForm(fixture)['yearModel']).toBe(before);
  });

  it('escape hatch: alternar para manual preserva os valores e o submit segue com texto livre', () => {
    const fixture = render();
    select(fixture, '[data-fipe-brand]', '21');

    (fixture.nativeElement.querySelector('[data-fipe-manual-toggle]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Inputs livres visíveis, valor da FIPE preservado e editável.
    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).toBeNull();
    const component = fixture.componentInstance as unknown as {
      form: { patchValue: (v: unknown) => void; getRawValue: () => Record<string, unknown> };
      submit: () => void;
    };
    expect(component.form.getRawValue()['brand']).toBe('Fiat');

    // Carro fora da FIPE: digita tudo e o submit não muda.
    component.form.patchValue({
      plate: 'XYZ9A88',
      brand: 'Troller',
      model: 'T4 fora de catálogo',
      yearManufacture: 2019,
      yearModel: 2019,
      hodometer: 100,
    });
    component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['brand']).toBe('Troller');
    expect(payload['model']).toBe('T4 fora de catálogo');
  });

  it('falha ao carregar marcas → cai para manual em silêncio, sem banner', () => {
    brands.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const fixture = render();

    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-primary-input')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    // A volta ao catálogo continua ofertada — a falha pode ter sido pontual.
    expect(fixture.nativeElement.querySelector('[data-fipe-catalog-toggle]')).not.toBeNull();
    // SILENT_HTTP_ERRORS: a queda para manual é silenciosa DE VERDADE — sem toast.
    expect(fipeNotifyError).not.toHaveBeenCalled();
  });

  it('modelos VAZIOS para a marca → cai para manual com nota, sem beco sem saída', () => {
    models.mockReturnValue(of([]));
    const fixture = render();
    select(fixture, '[data-fipe-brand]', '21');

    // Sem isto o select de modelo ficava habilitado, sem opções, com o
    // control obrigatório — o usuário não tinha para onde ir.
    expect(fixture.nativeElement.querySelector('[data-fipe-model]')).toBeNull();
    const noteText = fixture.nativeElement.querySelector('[data-fipe-note]')?.textContent;
    expect(noteText).toContain('modelos');
    expect(rawForm(fixture)['brand']).toBe('Fiat');
  });

  it('anos VAZIOS para o modelo → cai para manual com nota', () => {
    years.mockReturnValue(of([]));
    const fixture = render();
    select(fixture, '[data-fipe-brand]', '21');
    select(fixture, '[data-fipe-model]', '473');

    expect(fixture.nativeElement.querySelector('[data-fipe-year]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-fipe-note]')?.textContent).toContain('anos');
    expect(rawForm(fixture)['model']).toBe('Argo Drive 1.0');
  });

  it('reentrar no modo FIPE após "modelos vazios" recomeça a cadeia do zero', () => {
    models.mockReturnValueOnce(of([]));
    const fixture = render();
    select(fixture, '[data-fipe-brand]', '21');
    // Primeira passada: sem modelos → caiu para manual.
    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).toBeNull();

    (fixture.nativeElement.querySelector('[data-fipe-catalog-toggle]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Sem o reset, a marca continuava escolhida com fipeModels() vazio:
    // select de modelo habilitado, sem opções, control obrigatório.
    const brandSelect = fixture.nativeElement.querySelector('[data-fipe-brand]') as HTMLSelectElement;
    expect(brandSelect.value).toBe('');
    const modelSelect = fixture.nativeElement.querySelector('[data-fipe-model]') as HTMLSelectElement;
    expect(modelSelect.disabled).toBe(true);
  });

  it('catálogo VAZIO (200 com []) → manual com nota de uma linha, sem toast', () => {
    brands.mockReturnValue(of([]));
    const fixture = render();

    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).toBeNull();
    const noteText = fixture.nativeElement.querySelector('[data-fipe-note]')?.textContent?.trim();
    expect(noteText).toContain('indisponível');
    expect(fipeNotifyError).not.toHaveBeenCalled();
  });

  it('edição abre em modo manual com os valores carregados', () => {
    const fixture = render('v-1');

    expect(fixture.nativeElement.querySelector('[data-fipe-brand]')).toBeNull();
    expect(rawForm(fixture)['brand']).toBe('Fiat');
    expect(rawForm(fixture)['model']).toBe('Uno');
  });
});

/**
 * Chaves DESLIGADAS (padrão de produção desde 2026-09-12, ordem do dono):
 * o formulário é o de antes das integrações — marca/modelo/anos digitados à
 * mão, NENHUM vestígio de FIPE ou busca por placa na tela e NENHUMA
 * requisição disparada. Não é controle desabilitado: é ausência.
 */
describe('VehicleForm — chaves de lookup desligadas (padrão)', () => {
  let create: ReturnType<typeof vi.fn>;
  let plateLookup: ReturnType<typeof vi.fn>;
  let brands: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn().mockReturnValue(of({ id: 'v-1' }));
    plateLookup = vi.fn();
    brands = vi.fn().mockReturnValue(of([{ code: '21', name: 'Fiat' }]));
  });

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: {
            create,
            getOne: vi.fn(),
            update: vi.fn(),
            plateLookup,
            plateLookupUnavailable: signal(false),
          },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FipeService, useValue: { brands, models: vi.fn(), years: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
        // SEM provider de VEHICLE_LOOKUPS: vale o padrão do flags file (tudo false).
      ],
    });
    const fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
    return fixture;
  }

  it('nenhum vestígio: inputs manuais no lugar dos selects, sem toggle, sem live regions, sem request', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-primary-input[formcontrolname="brand"]')).not.toBeNull();
    expect(host.querySelector('app-primary-input[formcontrolname="model"]')).not.toBeNull();
    expect(host.querySelector('[data-fipe-brand]')).toBeNull();
    expect(host.querySelector('[data-fipe-catalog-toggle]')).toBeNull();
    expect(host.querySelector('[data-fipe-manual-toggle]')).toBeNull();
    expect(host.querySelector('[data-fipe-note]')).toBeNull();
    expect(host.querySelector('[data-fipe-loading-status]')).toBeNull();
    expect(brands).not.toHaveBeenCalled();
  });

  it('placa válida NÃO faz aparecer o botão de busca (nem desabilitado) e nada é requisitado', () => {
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector('#veiculo-plate') as HTMLInputElement;
    input.value = 'ABC1D23';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(host.querySelector('[data-plate-lookup]')).toBeNull();
    expect(host.querySelector('[data-plate-lookup-note]')).toBeNull();
    expect(plateLookup).not.toHaveBeenCalled();
  });

  it('o submit é o de antes das integrações: tudo digitado à mão, yearRangeValidator ativo', () => {
    const fixture = render();
    const component = fixture.componentInstance as unknown as {
      form: {
        patchValue: (v: unknown) => void;
        hasError: (e: string) => boolean;
      };
      submit: () => void;
    };

    // Validador de anos continua o mesmo.
    component.form.patchValue({ yearManufacture: 2022, yearModel: 2020 });
    expect(component.form.hasError('yearModelRange')).toBe(true);

    component.form.patchValue({
      plate: 'ABC1D23',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      hodometer: 1000,
    });
    component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['brand']).toBe('Fiat');
    expect(payload['model']).toBe('Mobi');
    expect(payload['yearManufacture']).toBe(2022);
    expect(payload['yearModel']).toBe(2022);
  });
});
