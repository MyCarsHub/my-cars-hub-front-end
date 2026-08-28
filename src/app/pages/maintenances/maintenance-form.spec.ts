import { HttpErrorResponse } from '@angular/common/http';
import type { AbstractControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MaintenanceForm } from './maintenance-form';
import { formatBRL } from '../../types/dashboard.types';
import { formatQuantity } from './maintenance-cost';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type {
  CreateMaintenanceRequest,
  Maintenance,
  UpdateMaintenanceRequest,
} from '../../types/maintenance.types';

interface FormApi {
  patchValue: (value: Record<string, unknown>) => void;
  valid: boolean;
  invalid: boolean;
  get: (path: string) => AbstractControl | null;
  controls: Record<string, unknown> & {
    hodometerReading: { markAsDirty: () => void; setValue: (v: number | null) => void };
  };
}

interface ExposedForm {
  form: FormApi;
  submit: () => void;
  hodometerRequired: () => boolean;
  addItem: () => void;
  removeItem: (index: number) => void;
  items: { length: number };
  totalLabel: () => string;
  discountExceedsBase: () => boolean;
}

const BASE_VALUES = {
  vehicleId: 'veh-1',
  type: 'PREVENTIVE',
  description: 'Revisão dos 10.000 km',
  serviceDate: '2026-08-10',
};

const DONE_MAINTENANCE: Maintenance = {
  id: 'mnt-1',
  createdDate: '2026-01-01T00:00:00Z',
  modifyDate: null,
  companyId: 'co-1',
  vehicleId: 'veh-1',
  type: 'PREVENTIVE',
  description: 'Troca de óleo',
  serviceDate: '2026-01-01',
  hodometerReading: 45000,
  costCents: 20000,
  items: [],
  labourCostCents: 20000,
  discountCents: 0,
  surchargeCents: 0,
  surchargeNote: null,
  provider: null,
  invoiceNumber: null,
  nextServiceDate: null,
  nextServiceHodometer: null,
  status: 'DONE',
  notes: null,
};

function configure(existing: Maintenance | null) {
  const create = vi.fn().mockReturnValue(EMPTY);
  const update = vi.fn().mockReturnValue(EMPTY);
  const getOne = vi.fn().mockReturnValue(existing ? of(existing) : EMPTY);

  const activatedRoute = {
    snapshot: {
      paramMap: { get: (key: string) => (key === 'id' && existing ? existing.id : null) },
    },
  };

  TestBed.configureTestingModule({
    imports: [MaintenanceForm],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: activatedRoute },
      { provide: MaintenancesService, useValue: { getOne, create, update, remove: vi.fn() } },
      {
        provide: VehiclesService,
        useValue: {
          list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 })),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(MaintenanceForm);
  fixture.detectChanges();
  return {
    fixture,
    create,
    update,
    component: fixture.componentInstance as unknown as ExposedForm,
  };
}

describe('MaintenanceForm — hodômetro condicional ao status', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('permite manutenção agendada sem hodômetro e envia status SCHEDULED', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    fixture.detectChanges();

    expect(component.hodometerRequired()).toBe(false);
    expect(component.form.valid).toBe(true);

    component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.status).toBe('SCHEDULED');
    expect(payload.hodometerReading).toBeNull();
  });

  it('bloqueia manutenção realizada sem hodômetro', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'DONE' });
    fixture.detectChanges();

    expect(component.hodometerRequired()).toBe(true);
    expect(component.form.invalid).toBe(true);

    component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('volta a aceitar null quando o status muda de DONE para CANCELED', () => {
    const { fixture, component } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'DONE' });
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);

    component.form.patchValue({ status: 'CANCELED' });
    fixture.detectChanges();
    expect(component.hodometerRequired()).toBe(false);
    expect(component.form.valid).toBe(true);
  });

  it('no PUT preserva a leitura já gravada quando o campo não foi tocado', () => {
    const { component, update } = configure(DONE_MAINTENANCE);

    component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][1] as UpdateMaintenanceRequest;
    expect(payload.hodometerReading).toBe(45000);
    expect(payload.status).toBe('DONE');
  });

  it('no PUT envia null quando o usuário limpa o campo de uma manutenção não realizada', () => {
    const scheduled: Maintenance = {
      ...DONE_MAINTENANCE,
      status: 'SCHEDULED',
      hodometerReading: 45000,
    };
    const { fixture, component, update } = configure(scheduled);

    component.form.controls.hodometerReading.setValue(null);
    component.form.controls.hodometerReading.markAsDirty();
    fixture.detectChanges();

    component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][1] as UpdateMaintenanceRequest;
    expect(payload.hodometerReading).toBeNull();
    expect(payload.status).toBe('SCHEDULED');
  });
});

/**
 * Feedback standard (phase 3): backend `fieldErrors` land inline under the field,
 * are not repeated in the banner, and never fire a toast.
 */
describe('MaintenanceForm — erros de campo vindos do backend', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<MaintenanceForm>>;

  function hodometerError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#maint-hodo-error');
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    create = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MaintenanceForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: MaintenancesService, useValue: { getOne: vi.fn(), create, update: vi.fn() } },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 })),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MaintenanceForm);
    fixture.detectChanges();
    (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o fieldError do hodômetro embaixo do campo, sem banner e sem toast', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'Hodômetro menor que a última leitura do veículo.',
        fieldErrors: { hodometerReading: 'Hodômetro menor que a última leitura do veículo.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    submit();

    const inline = hodometerError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('Hodômetro menor que a última leitura do veículo.');
    expect(inline?.getAttribute('role')).toBe('alert');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('mostra erro de negócio sem campo no banner do formulário', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Veículo já possui manutenção em andamento.' },
    });
    create.mockReturnValue(throwError(() => error));

    submit();

    expect(fixture.nativeElement.innerHTML).toContain('Veículo já possui manutenção em andamento.');
    expect(hodometerError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

/**
 * FEAT-0025 — seção "Custos": FormArray de peças + mão de obra/desconto/acréscimo,
 * com total calculado no cliente e NUNCA digitado.
 */
describe('MaintenanceForm — seção Custos', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function setItem(
    component: ExposedForm,
    index: number,
    name: string,
    quantity: string,
    unitPriceReais: string,
  ): void {
    component.form.get(`items.${index}.name`)?.setValue(name);
    component.form.get(`items.${index}.quantity`)?.setValue(quantity);
    component.form.get(`items.${index}.unitPriceReais`)?.setValue(unitPriceReais);
  }

  function totalText(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';
  }

  it('não expõe nenhum campo de custo total digitável', () => {
    const { fixture, component } = configure(null);

    expect('costReais' in component.form.controls).toBe(false);
    expect(fixture.nativeElement.querySelector('#maint-cost')).toBeNull();
  });

  it('abre sem nenhuma linha de peça e mostra o estado vazio', () => {
    const { fixture, component } = configure(null);

    expect(component.items.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Nenhuma peça lançada');
  });

  it('soma duas peças e a mão de obra no total exibido, sem round-trip', () => {
    const { fixture, component, create, update } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    component.addItem();
    component.addItem();
    setItem(component, 0, 'Filtro de óleo', '2', '50');
    setItem(component, 1, 'Óleo 5W30', '3,5', '40');
    component.form.get('labourReais')?.setValue('80');
    fixture.detectChanges();

    // 2 × R$ 50,00 = R$ 100,00 | 3,5 × R$ 40,00 = R$ 140,00 | + R$ 80,00 de mão de obra
    expect(totalText(fixture)).toBe(formatBRL(32_000));
    expect(component.totalLabel()).toBe(formatBRL(32_000));
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('com a lista de peças vazia o total é a mão de obra, e o formulário salva', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    component.form.get('labourReais')?.setValue('150');
    fixture.detectChanges();

    expect(component.items.length).toBe(0);
    expect(totalText(fixture)).toBe(formatBRL(15_000));
    expect(component.form.valid).toBe(true);

    component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.items).toEqual([]);
    expect(payload.labourCostCents).toBe(15_000);
    expect('costCents' in payload).toBe(false);
  });

  it('permite remover a ÚLTIMA peça — zero peça é estado salvável', () => {
    const { fixture, component } = configure(null);

    component.addItem();
    fixture.detectChanges();
    expect(component.items.length).toBe(1);

    component.removeItem(0);
    fixture.detectChanges();

    expect(component.items.length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Nenhuma peça lançada');
  });

  it('envia quantidade FRACIONÁRIA digitada com vírgula', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    component.addItem();
    setItem(component, 0, 'Óleo 5W30', '3,5', '40');
    fixture.detectChanges();

    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.items?.[0]).toEqual({
      name: 'Óleo 5W30',
      quantity: 3.5,
      unitPriceCents: 4000,
    });
  });

  it('recusa a 4ª casa decimal na quantidade', () => {
    const { fixture, component } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    component.addItem();
    setItem(component, 0, 'Óleo', '3,5555', '40');
    fixture.detectChanges();

    expect(component.form.get('items.0.quantity')?.errors).toEqual({ quantityFormat: true });
    expect(component.form.invalid).toBe(true);
  });

  it('bloqueia o envio quando o desconto supera peças + mão de obra + acréscimos', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    component.form.get('labourReais')?.setValue('100');
    component.form.get('discountReais')?.setValue('500');
    fixture.detectChanges();

    expect(component.discountExceedsBase()).toBe(true);

    component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('empilha no celular e vira tabela a partir de lg', () => {
    const { fixture, component } = configure(null);

    component.addItem();
    fixture.detectChanges();

    // `[formGroupName]` é property binding e nunca vira atributo no DOM; o botão de
    // remover é a âncora estável de dentro da linha.
    const remove = fixture.nativeElement.querySelector(
      'button[aria-label="Remover peça 1"]',
    ) as HTMLElement;
    expect(remove).not.toBeNull();
    expect(remove.className).toContain('min-h-[44px]');

    const row = remove.closest('[class*="lg:grid-cols-"]') as HTMLElement;
    expect(row).not.toBeNull();
    // cartão empilhado por padrão…
    expect(row.className).toContain('rounded-xl');
    expect(row.className).toContain('space-y-3');
    // …e linha de tabela só a partir de lg
    expect(row.className).toContain('lg:grid');
    expect(row.className).toContain('lg:grid-cols-[minmax(0,1fr)_7rem_10rem_9rem_3.5rem]');
  });
});

/**
 * O contrato de erro do backend é `items[<i>].<atributo>`; `applyFieldErrors` já o
 * resolve para o caminho do controle, então a mensagem tem de cair na LINHA certa.
 */
describe('MaintenanceForm — fieldError do backend dentro do FormArray', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('posiciona items[0].name no controle da primeira peça', async () => {
    const create = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MaintenanceForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: MaintenancesService, useValue: { getOne: vi.fn(), create, update: vi.fn() } },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 })),
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MaintenanceForm);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as ExposedForm;

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    component.addItem();
    component.addItem();
    component.form.get('items.0.name')?.setValue('Filtro');
    component.form.get('items.0.quantity')?.setValue('1');
    component.form.get('items.0.unitPriceReais')?.setValue('10');
    component.form.get('items.1.name')?.setValue('Óleo');
    component.form.get('items.1.quantity')?.setValue('1');
    component.form.get('items.1.unitPriceReais')?.setValue('20');
    fixture.detectChanges();

    create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: 'Dados inválidos.',
              fieldErrors: { 'items[0].name': 'Nome da peça já usado nesta manutenção.' },
            },
          }),
      ),
    );

    component.submit();
    fixture.detectChanges();

    const first = component.form.get('items.0.name');
    const second = component.form.get('items.1.name');
    expect(first?.errors?.['serverError']).toEqual({
      message: 'Nome da peça já usado nesta manutenção.',
    });
    expect(second?.errors).toBeNull();

    const alerts = Array.from(
      fixture.nativeElement.querySelectorAll('[role="alert"]'),
    ) as HTMLElement[];
    const texts = alerts.map((el) => el.textContent?.trim());
    expect(texts).toContain('Nome da peça já usado nesta manutenção.');
  });
});

/**
 * FIX pt-BR — a suíte que faltava, e a razão pela qual o defeito passou.
 *
 * Nenhum teste desta tela digitava num `<input>`: eram 15 `setValue` e zero
 * `dispatchEvent`. `setValue` escreve direto no MODELO e passa por fora do
 * `ValueAccessor`, que é justamente onde o defeito morava — o `NumberValueAccessor` do
 * `type="number"` entregava `1.500` como `1.5`. Por isso o teste chamado "envia
 * quantidade FRACIONÁRIA digitada com vírgula" passava verde provando apenas que a
 * FUNÇÃO de parse aceitava vírgula, nunca que o CAMPO aceitava.
 *
 * Aqui todo caso entra pelo DOM: `element.value = ...` seguido de
 * `dispatchEvent(new Event('input'))`. Um teste que não passa pelo ValueAccessor não
 * prova nada sobre digitação.
 */
describe('MaintenanceForm — digitação pt-BR pelo DOM (nunca setValue)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  /** Digita de verdade: escreve no elemento e dispara o evento que o Angular escuta. */
  function type(
    fixture: { detectChanges: () => void },
    input: HTMLInputElement,
    text: string,
  ): void {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function inputFor(fixture: { nativeElement: HTMLElement }, control: string): HTMLInputElement {
    const el = fixture.nativeElement.querySelector(
      `input[formcontrolname="${control}"]`,
    ) as HTMLInputElement | null;
    expect(el, `input de ${control} não encontrado`).not.toBeNull();
    return el as HTMLInputElement;
  }

  /** A mensagem visível daquele campo — a prova de que a recusa NÃO é silenciosa. */
  function messageFor(input: HTMLInputElement): string | null {
    const alert = input.closest('app-form-field')?.querySelector('[role="alert"]');
    return alert?.textContent?.trim() ?? null;
  }

  function ready() {
    const ctx = configure(null);
    ctx.component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    ctx.fixture.detectChanges();
    return ctx;
  }

  it('os cinco campos de custo são type=text com inputmode=decimal (mobile-first)', () => {
    const { fixture, component } = ready();
    component.addItem();
    fixture.detectChanges();

    for (const name of [
      'quantity',
      'unitPriceReais',
      'labourReais',
      'discountReais',
      'surchargeReais',
    ]) {
      const el = inputFor(fixture, name);
      // type="number" é o veículo do defeito: ele passa o valor por parseFloat.
      expect(el.getAttribute('type'), name).toBe('text');
      // …e sem inputmode o celular perderia o teclado numérico.
      expect(el.getAttribute('inputmode'), name).toBe('decimal');
    }
  });

  it('DINHEIRO digitado `1500,50` vale R$ 1.500,50', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'labourReais'), '1500,50');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.labourCostCents).toBe(150_050);
  });

  it('DINHEIRO digitado `1.500,50` vale R$ 1.500,50', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'labourReais'), '1.500,50');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.labourCostCents).toBe(150_050);
  });

  /**
   * O caso que motivou o P0. Com `type="number"`, `1.500` chegava como `1.5` e gravava
   * R$ 1,50 — sem recusa, sem mensagem, só um total pequeno.
   */
  it('DINHEIRO digitado `1.500` vale R$ 1.500,00, NUNCA R$ 1,50', () => {
    const { fixture, component, create } = ready();
    const labour = inputFor(fixture, 'labourReais');

    type(fixture, labour, '1.500');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.labourCostCents).toBe(150_000);
    expect(payload.labourCostCents).not.toBe(150);
    expect(messageFor(labour)).toBeNull();
  });

  it('DINHEIRO digitado `1500` vale R$ 1.500,00', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'labourReais'), '1500');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.labourCostCents).toBe(150_000);
  });

  it('DINHEIRO digitado `45,99` vale R$ 45,99', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'labourReais'), '45,99');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.labourCostCents).toBe(4599);
  });

  /** O ponto fora de grupo de 3 é recusado — mas EM VOZ ALTA, com o que fazer. */
  it('DINHEIRO digitado `45.99` é recusado com mensagem, e não vira outro número', () => {
    const { fixture, component, create } = ready();
    const labour = inputFor(fixture, 'labourReais');

    type(fixture, labour, '45.99');

    const message = messageFor(labour);
    expect(message).not.toBeNull();
    expect(message).toContain('1.500,50');
    expect(component.form.invalid).toBe(true);

    component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('DINHEIRO com 3 casas é recusado com mensagem — recusa, não arredondamento', () => {
    const { fixture, component, create } = ready();
    const labour = inputFor(fixture, 'labourReais');

    type(fixture, labour, '1500,555');

    expect(messageFor(labour)).toContain('2 casas');
    component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('QUANTIDADE digitada `3,5` continua valendo 3,5', () => {
    const { fixture, component, create } = ready();
    component.addItem();
    fixture.detectChanges();

    type(fixture, inputFor(fixture, 'name'), 'Óleo 5W30');
    type(fixture, inputFor(fixture, 'quantity'), '3,5');
    type(fixture, inputFor(fixture, 'unitPriceReais'), '40,00');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.items?.[0]).toEqual({
      name: 'Óleo 5W30',
      quantity: 3.5,
      unitPriceCents: 4000,
    });
  });

  /** A tela de detalhe imprime `1.000` para mil. Redigitar isso tem de dar mil. */
  it('QUANTIDADE digitada `1.000` vale mil, não 1', () => {
    const { fixture, component, create } = ready();
    component.addItem();
    fixture.detectChanges();

    type(fixture, inputFor(fixture, 'name'), 'Parafuso');
    type(fixture, inputFor(fixture, 'quantity'), '1.000');
    type(fixture, inputFor(fixture, 'unitPriceReais'), '0,10');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.items?.[0]?.quantity).toBe(1000);
    expect(payload.items?.[0]?.quantity).not.toBe(1);
  });

  /**
   * O critério de aceite: LER da tela de detalhe, COPIAR e REDIGITAR no formulário.
   * As strings abaixo são literalmente as que o detalhe renderiza — `formatCurrency`
   * é `formatBRL`, e a quantidade sai de `formatQuantity`.
   */
  it('ROUND-TRIP: o que o detalhe mostra, o formulário lê de volta igual', () => {
    const { fixture, component, create } = ready();
    component.addItem();
    fixture.detectChanges();

    const shownQuantity = formatQuantity(1000); // "1.000"
    const shownUnitPrice = formatBRL(150_050); // "R$ 1.500,50"
    const shownLabour = formatBRL(32_000); // "R$ 320,00"
    expect(shownQuantity).toBe('1.000');

    type(fixture, inputFor(fixture, 'name'), 'Parafuso');
    type(fixture, inputFor(fixture, 'quantity'), shownQuantity);
    type(fixture, inputFor(fixture, 'unitPriceReais'), shownUnitPrice);
    type(fixture, inputFor(fixture, 'labourReais'), shownLabour);
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.items?.[0]?.quantity).toBe(1000);
    expect(payload.items?.[0]?.unitPriceCents).toBe(150_050);
    expect(payload.labourCostCents).toBe(32_000);
  });

  it('o total ao vivo acompanha o que foi DIGITADO, e arredonda HALF_UP por linha', () => {
    const { fixture, component } = ready();
    component.addItem();
    component.addItem();
    fixture.detectChanges();

    const quantities = Array.from(
      fixture.nativeElement.querySelectorAll('input[formcontrolname="quantity"]'),
    ) as HTMLInputElement[];
    const prices = Array.from(
      fixture.nativeElement.querySelectorAll('input[formcontrolname="unitPriceReais"]'),
    ) as HTMLInputElement[];

    // Duas linhas de 0,5 × R$ 0,05 = 2,5 centavos cada. HALF_UP POR LINHA → 3 + 3 = 6.
    // Arredondar a soma daria 5, e é essa divergência com o backend que a regra evita.
    for (let i = 0; i < 2; i += 1) {
      type(fixture, quantities[i], '0,5');
      type(fixture, prices[i], '0,05');
    }
    type(fixture, inputFor(fixture, 'labourReais'), '0,00');

    expect(component.totalLabel()).toBe(formatBRL(6));
  });

  it('campo vazio é recusado com mensagem — nunca vira zero em silêncio', () => {
    const { fixture, component, create } = ready();
    const labour = inputFor(fixture, 'labourReais');

    type(fixture, labour, '');

    expect(messageFor(labour)).not.toBeNull();
    component.submit();
    expect(create).not.toHaveBeenCalled();
  });
});
