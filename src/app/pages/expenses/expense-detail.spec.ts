import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../services/api-error.service';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { ExpensesService } from '../../services/expenses.service';
import { NotificationService } from '../../services/notification.service';
import { Expense } from '../../types/expense.types';
import { ExpenseDetail } from './expense-detail';

const E: Expense = {
  id: 'e1',
  createdDate: null,
  modifyDate: null,
  companyId: 'c',
  vehicleId: 'v1',
  vehicleLabel: 'QWE4F21 · Chevrolet Onix',
  category: 'FUEL',
  categoryLabel: 'Abastecimento',
  description: 'Abastecimento no posto da Av. Brasil',
  expenseDate: '2026-11-08',
  amountCents: 25000,
};

describe('ExpenseDetail', () => {
  let remove: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  function setup(getOne = of(E)) {
    TestBed.resetTestingModule();
    remove = vi.fn().mockReturnValue(of(void 0));
    TestBed.configureTestingModule({
      imports: [ExpenseDetail],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'e1' } } } },
        { provide: ExpensesService, useValue: { getOne: () => getOne, remove } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    const fixture = TestBed.createComponent(ExpenseDetail);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  beforeEach(() => TestBed.resetTestingModule());

  it('mostra o valor em pt-BR no cartão laranja e o efeito no painel', () => {
    const { el } = setup();
    expect(text(el.querySelector('[data-expense-amount]'))).toBe('R$ 250,00');
    expect(el.querySelector('app-painted-card')?.getAttribute('data-tone')).toBe('orange');
    expect(text(el)).toContain('novembro de 2026');
    expect(text(el)).toContain('− R$ 250,00');
    expect(text(el)).toContain('Saída em 08/11/2026');
    expect(text(el)).toContain('Rentabilidade do carro');
  });

  it('gasto sem veículo diz que é da locadora toda', () => {
    const { el } = setup(of({ ...E, vehicleId: null, vehicleLabel: null }));
    expect(text(el)).toContain('Locadora toda');
    expect(text(el)).toContain('Só no total da locadora');
  });

  it('Editar e Excluir ficam no topo (desktop) E no fim (celular), no mesmo componente', () => {
    const { el } = setup();
    const top = el.querySelector('[data-actions-top]')!;
    const bottom = el.querySelector('[data-actions-bottom]')!;
    expect(top.className).toContain('hidden lg:flex');
    expect(bottom.className).toContain('lg:hidden');
    for (const area of [top, bottom]) {
      expect(area.querySelector('app-detail-actions')).not.toBeNull();
      expect(area.querySelector('a')?.getAttribute('href')).toBe('/gastos/e1/editar');
    }
  });

  it('Excluir abre a confirmação com o valor e NÃO apaga antes de confirmar', () => {
    const { fixture, el } = setup();
    el.querySelector<HTMLButtonElement>('[data-actions-top] button[aria-label="Excluir"]')!.click();
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog;
    expect(dialog.open()).toBe(true);
    expect(dialog.title()).toBe('Excluir este gasto?');
    expect(dialog.message().replace(/ /g, ' ')).toContain('R$ 250,00');
    expect(dialog.message()).toContain('Lucro do mês sobe');
    expect(remove).not.toHaveBeenCalled();
  });

  it('"Manter gasto" fecha sem apagar; confirmar apaga e volta à lista', () => {
    const { fixture, el } = setup();
    const dialog = () => fixture.debugElement.query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog;
    const open = () => {
      el.querySelector<HTMLButtonElement>('[data-actions-top] button[aria-label="Excluir"]')!.click();
      fixture.detectChanges();
    };
    expect(dialog().cancelLabel()).toBe('Manter gasto');

    open();
    dialog().cancelled.emit();
    fixture.detectChanges();
    expect(dialog().open()).toBe(false);
    expect(remove).not.toHaveBeenCalled();

    open();
    dialog().confirmed.emit();
    fixture.detectChanges();
    expect(remove).toHaveBeenCalledWith('e1');
    expect(navigate).toHaveBeenCalledWith(['/gastos']);
  });

  it('gasto inexistente mostra o erro e o caminho de volta', () => {
    const { el } = setup(throwError(() => new HttpErrorResponse({ status: 404 })) as never);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(el)).toContain('Voltar para a lista');
    expect(el.querySelector('[data-expense-amount]')).toBeNull();
  });
});
