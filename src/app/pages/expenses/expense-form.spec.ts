import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../services/api-error.service';
import { ExpensesService } from '../../services/expenses.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import { Expense } from '../../types/expense.types';
import { ExpenseForm } from './expense-form';

type FormApi = {
  form: {
    patchValue: (v: unknown) => void;
    controls: Record<string, { value: unknown; valid: boolean; errors: unknown }>;
    valid: boolean;
  };
  submit: () => void;
};

const SAVED: Expense = {
  id: 'new-1',
  createdDate: null,
  modifyDate: null,
  companyId: 'c',
  vehicleId: null,
  vehicleLabel: null,
  category: 'FUEL',
  categoryLabel: 'Abastecimento',
  description: 'x',
  expenseDate: '2026-11-08',
  amountCents: 1,
};

describe('ExpenseForm', () => {
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  function setup(id: string | null = null, existing?: Expense) {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of(SAVED));
    update = vi.fn().mockReturnValue(of(SAVED));
    TestBed.configureTestingModule({
      imports: [ExpenseForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => id } } } },
        {
          provide: ExpensesService,
          useValue: { create, update, getOne: vi.fn().mockReturnValue(of(existing)) },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(
              of({ content: [{ id: 'v1', plate: 'QWE4F21', brand: 'CHEVROLET', model: 'ONIX' }] }),
            ),
          },
        },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(ExpenseForm);
    fixture.detectChanges();
    const api = fixture.componentInstance as unknown as FormApi;
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, api, el };
  }

  /** Digita no campo de valor como o navegador: escreve o texto e dispara `input`. */
  function type(el: HTMLElement, fixture: { detectChanges: () => void }, text: string) {
    const input = el.querySelector<HTMLInputElement>('#expense-amount')!;
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text.slice(-1) }));
    fixture.detectChanges();
    return input;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('o campo de valor mascara pt-BR ao digitar e o controle guarda TEXTO', () => {
    const { fixture, api, el } = setup();
    const input = type(el, fixture, '1250,5');
    expect(input.value).toBe('1.250,5');
    expect(api.form.controls['amountReais'].value).toBe('1.250,5');
    expect(typeof api.form.controls['amountReais'].value).toBe('string');
  });

  it('o validador lê o texto mascarado como preenchido (e vazio continua obrigatório)', () => {
    const { fixture, api, el } = setup();
    expect(api.form.controls['amountReais'].errors).toEqual({ required: true });
    type(el, fixture, '250,00');
    expect(api.form.controls['amountReais'].valid).toBe(true);
  });

  it('o corpo enviado leva centavos inteiros, a data, a categoria e veículo nulo', () => {
    const { fixture, api, el } = setup();
    api.form.patchValue({
      category: 'ACCOUNTING_ADMIN',
      expenseDate: '2026-11-01',
      description: '  Honorário do contador ',
      vehicleId: '',
    });
    type(el, fixture, '1.250,50');
    api.submit();
    expect(create).toHaveBeenCalledWith({
      vehicleId: null,
      category: 'ACCOUNTING_ADMIN',
      description: 'Honorário do contador',
      expenseDate: '2026-11-01',
      amountCents: 125050,
    });
    expect(navigate).toHaveBeenCalledWith(['/gastos', 'new-1']);
  });

  it('com veículo escolhido, o id vai no corpo', () => {
    const { fixture, api, el } = setup();
    api.form.patchValue({ vehicleId: 'v1', description: 'Posto' });
    type(el, fixture, '250,00');
    api.submit();
    expect(create.mock.calls[0][0].vehicleId).toBe('v1');
    expect(create.mock.calls[0][0].amountCents).toBe(25000);
  });

  it('a descrição é obrigatória em TODA categoria, inclusive Outros', () => {
    const { fixture, api, el } = setup();
    type(el, fixture, '10,00');
    for (const category of ['FUEL', 'OTHER']) {
      api.form.patchValue({ category, description: '   ' });
      api.submit();
      expect(api.form.controls['description'].errors).toHaveProperty('required');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('valor acima do teto de R$ 100.000.000,00 é recusado antes de ir à API', () => {
    const { fixture, api, el } = setup();
    api.form.patchValue({ description: 'x' });
    type(el, fixture, '100.000.000,01');
    api.submit();
    expect(api.form.controls['amountReais'].errors).toEqual({ max: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('mostra o efeito no painel conforme o valor digitado', () => {
    const { fixture, el } = setup();
    expect(el.querySelector('[data-effect-profit]')?.textContent).toContain('informe o valor');
    type(el, fixture, '250,00');
    expect(el.querySelector('[data-effect-expenses]')?.textContent?.trim().replace(/ /g, ' ')).toBe('+ R$ 250,00');
    expect(el.querySelector('[data-effect-profit]')?.textContent?.trim().replace(/ /g, ' ')).toBe('diminui R$ 250,00');
  });

  it('editar carrega o gasto (centavos viram texto pt-BR) e salva com PUT no id', () => {
    const { api } = setup('e9', { ...SAVED, id: 'e9', vehicleId: 'v1', amountCents: 125050, description: 'Posto', expenseDate: '2026-11-03' });
    expect(api.form.controls['amountReais'].value).toBe('1.250,50');
    api.submit();
    expect(update).toHaveBeenCalledWith('e9', expect.objectContaining({ amountCents: 125050, vehicleId: 'v1' }));
    expect(create).not.toHaveBeenCalled();
  });

  it('campos com pelo menos 16px: sem classe de texto menor que base nos controles', () => {
    const { el } = setup();
    for (const c of Array.from(el.querySelectorAll('input, select'))) {
      expect(c.className).toContain('text-base');
      expect(c.className).not.toMatch(/\btext-(xs|sm)\b/);
    }
  });
});
