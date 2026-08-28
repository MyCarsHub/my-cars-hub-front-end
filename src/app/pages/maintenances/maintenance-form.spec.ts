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
  controls: Record<string, unknown>;
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

/**
 * Os três helpers abaixo vivem no escopo do MÓDULO de propósito.
 *
 * Enquanto eles existiam só dentro do bloco "digitação pt-BR", qualquer outro bloco que
 * precisasse mexer num campo numérico caía de volta no `setValue` — que escreve direto
 * no modelo e passa POR FORA do `ValueAccessor`, exatamente onde o defeito mora. Um
 * helper difícil de alcançar é um convite ao atalho que apagou o bug da vista.
 */

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

    // APAGA pelo DOM, como o usuário apaga: seleciona tudo e digita nada. O `setValue`
    // que estava aqui marcava o controle sujo por fora do ValueAccessor e não provava
    // que limpar o CAMPO limpa a leitura.
    const hodo = inputFor(fixture, 'hodometerReading');
    expect(hodo.value).toBe('45.000');
    type(fixture, hodo, '');

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

  /**
   * DIGITADA, não `setValue`. A guarda era provada escrevendo direto no modelo, o que
   * passa por fora do ValueAccessor — justamente a camada onde o defeito mora. Com
   * `1.500` digitado, o teste prova as duas coisas de uma vez: que o campo lê R$
   * 1.500,00 e que a guarda dispara. Se o valor fosse lido como R$ 1,50 (150 centavos),
   * ele NÃO superaria os R$ 100,00 de mão de obra, a guarda não dispararia — e a versão
   * antiga do teste ficaria verde exatamente no cenário corrompido.
   */
  it('bloqueia o envio quando o desconto DIGITADO supera peças + mão de obra + acréscimos', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    fixture.detectChanges();

    type(fixture, inputFor(fixture, 'labourReais'), '100');
    type(fixture, inputFor(fixture, 'discountReais'), '1.500');

    expect(component.discountExceedsBase()).toBe(true);
    // O formulário é VÁLIDO: R$ 1.500,00 é um desconto bem formado. Quem barra é a
    // guarda de negócio, não a gramática — e é isso que este teste separa.
    expect(component.form.valid).toBe(true);

    component.submit();
    fixture.detectChanges();

    expect(create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'O desconto não pode ser maior que peças + mão de obra + acréscimos.',
    );
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

  function ready() {
    const ctx = configure(null);
    ctx.component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    ctx.fixture.detectChanges();
    return ctx;
  }

  /**
   * VARREDURA, não lista.
   *
   * A guarda anterior iterava um array com os cinco nomes já migrados. Ela provava que
   * aqueles cinco estavam certos e não podia, por construção, notar um sexto — e havia
   * um sexto: o hodômetro, `type="number"` na MESMA tela, corrompendo em produção
   * enquanto o teste passava verde. O ponto cego não fechou naquele conserto, mudou de
   * forma: de "nenhum teste dirige o DOM" para "o teste do DOM só olha onde o autor já
   * olhou".
   *
   * O critério destes dois testes é: um campo NOVO esquecido amanhã tem de falhar
   * sozinho, sem ninguém lembrar de acrescentar o nome dele a lugar nenhum.
   */
  it('VARREDURA: nenhum input do formulário é type="number"', () => {
    const { fixture, component } = ready();
    component.addItem();
    fixture.detectChanges();

    const all = Array.from(fixture.nativeElement.querySelectorAll('input')) as HTMLInputElement[];

    // Anti-vácuo: uma varredura sobre zero elementos passa verde sem ter olhado nada.
    // Se o template deixar de renderizar, é AQUI que o teste avisa — e não com um
    // silêncio que parece aprovação.
    expect(all.length, 'a varredura não encontrou input nenhum — o formulário renderizou?')
      .toBeGreaterThan(10);

    const offenders = all
      .filter((el) => el.getAttribute('type') === 'number')
      .map((el) => el.getAttribute('formcontrolname') ?? el.getAttribute('id') ?? '(sem nome)');

    expect(
      offenders,
      'type="number" passa o valor por parseFloat: "150.000" vira 150. ' +
        'Migre para type="text" + inputmode e um validador da gramática pt-BR.',
    ).toEqual([]);
  });

  /**
   * O lado positivo da varredura, e igualmente sem lista de nomes.
   *
   * Quem é "campo numérico" é decidido PERGUNTANDO AO FORMULÁRIO, não consultando o
   * autor: um campo é numérico quando recusa `45.99` (fora da gramática pt-BR) e aceita
   * `1.500` (ponto como milhar). Texto livre — descrição, fornecedor, nota, nome da peça
   * — aceita as duas. Data recusa as duas. A sonda isola exatamente os campos regidos
   * por `utils/ptbr-number`, em qualquer precisão: 0 (hodômetro), 2 (dinheiro) e 3
   * (quantidade).
   */
  it('VARREDURA: todo campo regido pela gramática pt-BR é type=text com inputmode', () => {
    const { fixture, component } = ready();
    component.addItem();
    fixture.detectChanges();

    const all = Array.from(fixture.nativeElement.querySelectorAll('input')) as HTMLInputElement[];
    const named = all.filter((el) => el.getAttribute('formcontrolname'));
    expect(named.length, 'nenhum input com formControlName — o formulário renderizou?')
      .toBeGreaterThan(10);

    const numeric: HTMLInputElement[] = [];
    for (const el of named) {
      const name = el.getAttribute('formcontrolname') as string;
      // `[formGroupName]` é property binding e NUNCA vira atributo no DOM, então não dá
      // para descobrir a linha do FormArray pelo elemento: resolve-se no nível do form
      // e, se não existir lá, na primeira linha de peça.
      const control = component.form.get(name) ?? component.form.get(`items.0.${name}`);
      if (!control) continue;

      type(fixture, el, '45.99');
      const rejectsEnUs = control.invalid;
      type(fixture, el, '1.500');
      const acceptsGrouped = control.valid;

      if (rejectsEnUs && acceptsGrouped) numeric.push(el);
    }

    // Anti-vácuo de novo, e por baixo: a sonda tem de ter ENCONTRADO campos numéricos.
    // Zero significaria que ela parou de funcionar, não que a tela está limpa.
    // Deliberadamente `>=`, nunca uma igualdade: um campo numérico NOVO entra na
    // varredura sozinho e é cobrado pelos mesmos atributos, sem ninguém editar o teste.
    expect(numeric.length, 'a sonda não reconheceu nenhum campo numérico').toBeGreaterThanOrEqual(
      7,
    );

    for (const el of numeric) {
      const name = el.getAttribute('formcontrolname');
      expect(el.getAttribute('type'), `${name} precisa ser type="text"`).toBe('text');
      // Sem inputmode o celular perde o teclado numérico — e este formulário é usado
      // sobretudo no celular. `decimal` onde há vírgula, `numeric` no km inteiro.
      expect(['decimal', 'numeric'], `${name} precisa declarar inputmode`).toContain(
        el.getAttribute('inputmode'),
      );
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

  /**
   * DESCONTO e ACRÉSCIMO tinham ZERO cobertura digitada: os cinco campos migrados eram
   * provados por `labourReais`, `quantity` e `unitPriceReais`, e estes dois passavam
   * apenas por `setValue`, que não encosta no ValueAccessor. Eles seguram dinheiro
   * exatamente como os outros três.
   */
  it('DESCONTO digitado `1.500` vale R$ 1.500,00, NUNCA R$ 1,50', () => {
    const { fixture, component, create } = ready();
    const discount = inputFor(fixture, 'discountReais');

    type(fixture, inputFor(fixture, 'labourReais'), '2.000');
    type(fixture, discount, '1.500');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.discountCents).toBe(150_000);
    expect(payload.discountCents).not.toBe(150);
    expect(messageFor(discount)).toBeNull();
  });

  it('DESCONTO digitado `45.99` é recusado com mensagem, e não vira outro número', () => {
    const { fixture, component, create } = ready();
    const discount = inputFor(fixture, 'discountReais');

    type(fixture, discount, '45.99');

    expect(messageFor(discount)).toContain('1.500,50');
    expect(component.form.invalid).toBe(true);

    component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('ACRÉSCIMO digitado `1.500,50` vale R$ 1.500,50', () => {
    const { fixture, component, create } = ready();
    const surcharge = inputFor(fixture, 'surchargeReais');

    type(fixture, surcharge, '1.500,50');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.surchargeCents).toBe(150_050);
    expect(messageFor(surcharge)).toBeNull();
  });

  it('ACRÉSCIMO digitado `1.500` vale R$ 1.500,00, NUNCA R$ 1,50', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'surchargeReais'), '1.500');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.surchargeCents).toBe(150_000);
    expect(payload.surchargeCents).not.toBe(150);
  });

  it('ACRÉSCIMO com 3 casas é recusado com mensagem — recusa, não arredondamento', () => {
    const { fixture, component, create } = ready();
    const surcharge = inputFor(fixture, 'surchargeReais');

    type(fixture, surcharge, '1500,555');

    expect(messageFor(surcharge)).toContain('2 casas');
    component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * HODÔMETRO — o campo que ainda corrompia na MESMA tela depois do conserto pt-BR.
   * `150.000` é literalmente o que a tela de detalhe imprime como "150.000 km".
   */
  it('HODÔMETRO digitado `150.000` vale 150000 km, NUNCA 150', () => {
    const { fixture, component, create } = ready();
    const hodo = inputFor(fixture, 'hodometerReading');

    type(fixture, hodo, '150.000');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.hodometerReading).toBe(150_000);
    expect(payload.hodometerReading).not.toBe(150);
    expect(messageFor(hodo)).toBeNull();
  });

  it('HODÔMETRO digitado `150000` vale 150000 km', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'hodometerReading'), '150000');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.hodometerReading).toBe(150_000);
  });

  /**
   * O espelho silencioso: com `type="number"`, `150,000` fazia o sanitizador do
   * navegador ZERAR `el.value` e o accessor escrevia `null` — o campo se limpava
   * sozinho na frente do usuário. Agora o texto FICA e a recusa é visível.
   */
  it('HODÔMETRO digitado `150,000` é recusado com mensagem, e o campo NÃO se apaga', () => {
    const { fixture, component, create } = ready();
    const hodo = inputFor(fixture, 'hodometerReading');

    type(fixture, hodo, '150,000');

    expect(hodo.value).toBe('150,000');
    expect(messageFor(hodo)).toContain('sem casas decimais');
    expect(component.form.invalid).toBe(true);

    component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('HODÔMETRO digitado `150.500` vale 150500 km, e não 150,5', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'hodometerReading'), '150.500');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.hodometerReading).toBe(150_500);
    expect(payload.hodometerReading).not.toBe(150.5);
  });

  it('HODÔMETRO com casa decimal (`150,5`) é recusado — km é inteiro', () => {
    const { fixture, component, create } = ready();
    const hodo = inputFor(fixture, 'hodometerReading');

    type(fixture, hodo, '150,5');

    expect(messageFor(hodo)).toContain('sem casas decimais');
    component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('HODÔMETRO PREVISTO digitado `200.000` vale 200000 km, NUNCA 200', () => {
    const { fixture, component, create } = ready();

    type(fixture, inputFor(fixture, 'nextServiceHodometer'), '200.000');
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.nextServiceHodometer).toBe(200_000);
    expect(payload.nextServiceHodometer).not.toBe(200);
  });

  /**
   * O critério de aceite do hodômetro, igual ao dos custos: LER da tela de detalhe,
   * COPIAR e REDIGITAR. O detalhe usa `Intl.NumberFormat('pt-BR')`, então a string
   * abaixo é literalmente a que ele renderiza antes do " km".
   */
  it('ROUND-TRIP: o hodômetro que o detalhe mostra, o formulário lê de volta igual', () => {
    const { fixture, component, create } = ready();
    const shown = new Intl.NumberFormat('pt-BR').format(150_000);
    expect(shown).toBe('150.000');

    type(fixture, inputFor(fixture, 'hodometerReading'), shown);
    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.hodometerReading).toBe(150_000);
  });

  it('HODÔMETRO vazio continua válido numa manutenção agendada — não é obrigatório', () => {
    const { fixture, component, create } = ready();
    const hodo = inputFor(fixture, 'hodometerReading');

    type(fixture, hodo, '');

    expect(messageFor(hodo)).toBeNull();
    expect(component.form.valid).toBe(true);

    component.submit();

    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.hodometerReading).toBeNull();
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
