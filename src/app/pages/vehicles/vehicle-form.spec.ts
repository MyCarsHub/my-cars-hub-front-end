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
  it('não renderiza o bloco de documentos na edição — sem botões de anexar nem picker', async () => {
    await setup(null);

    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('Documentos (opcional)');
    expect(html).not.toContain('Anexar CRLV');
    expect(html).not.toContain('Anexar outro arquivo');
    expect(fixture.nativeElement.querySelector('[data-pending-doc]')).toBeNull();
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
          useValue: { create, update, createFinancing, getOne: vi.fn() },
        },
        { provide: InsurancesService, useValue: { create: createInsurance } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
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
    openDocumentPicker: (kind: 'CRLV' | 'OTHER') => void;
    onDocumentsSelected: (event: Event) => void;
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

  /** Simula o gesto completo: toque no tipo + retorno do seletor nativo. */
  function pick(kind: 'CRLV' | 'OTHER', files: File[]): void {
    api().openDocumentPicker(kind);
    api().onDocumentsSelected({ target: { files, value: '' } } as unknown as Event);
    fixture.detectChanges();
  }

  function pendingRows(): NodeListOf<HTMLElement> {
    return fixture.nativeElement.querySelectorAll('[data-pending-doc]');
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
          useValue: { create, update, uploadDocument, getOne: vi.fn() },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
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

  it('envia os N arquivos escolhidos, um por chamada e na ordem, e navega para o detalhe', () => {
    fillValidVehicle();
    pick('CRLV', [crlvFile]);
    pick('OTHER', [fotoFile]);
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
    pick('CRLV', [crlvFile]);
    pick('OTHER', [fotoFile]);

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

  it('não enfileira o mesmo arquivo duas vezes — dedup por nome+tamanho, nomeado no erro', () => {
    pick('CRLV', [crlvFile]);
    // Mesmo arquivo de novo (outro gesto) + um repetido DENTRO da mesma seleção.
    pick('CRLV', [crlvFile, fotoFile, fotoFile]);

    expect(pendingRows().length).toBe(2);
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).toContain('Já na lista:');
    expect(html).toContain('crlv.pdf');
  });

  it('recusa arquivo fora da allowlist na seleção, nomeando o recusado', () => {
    const exe = new File(['x'], 'virus.exe', { type: 'application/octet-stream' });
    pick('CRLV', [exe, crlvFile]);

    // Só o válido entra; o recusado é nomeado no erro do bloco.
    expect(pendingRows().length).toBe(1);
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).toContain('virus.exe');
    expect(html).toContain('Aceitos PDF, JPG, PNG, WebP e HEIC/HEIF');
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
          useValue: { create: vi.fn(), getOne: vi.fn(), update: vi.fn() },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
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
          useValue: { create, update, getOne, createFinancing: vi.fn() },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => routeId } } } },
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
