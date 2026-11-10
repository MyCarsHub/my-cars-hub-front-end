import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { ExpensesService } from '../../services/expenses.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import { Expense } from '../../types/expense.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { shiftMonth } from '../../utils/expenses-view';
import { ExpensesList } from './expenses-list';

function exp(over: Partial<Expense>): Expense {
  return {
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
    ...over,
  };
}

const ROWS: Expense[] = [
  exp({ id: 'e1' }),
  exp({ id: 'e2', description: 'Tanque cheio', amountCents: 23000, vehicleLabel: 'RIO2A18 · Fiat Argo', vehicleId: 'v2' }),
  exp({
    id: 'e3',
    category: 'ACCOUNTING_ADMIN',
    categoryLabel: 'Contador/administrativo',
    description: 'Honorário do contador',
    vehicleId: null,
    vehicleLabel: null,
    amountCents: 45000,
  }),
];

describe('ExpensesList', () => {
  let listMonth: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;

  function create(rows: Expense[] | 'error') {
    TestBed.resetTestingModule();
    listMonth = vi.fn().mockReturnValue(
      rows === 'error' ? throwError(() => new Error('boom')) : of(rows),
    );
    remove = vi.fn().mockReturnValue(of(void 0));
    success = vi.fn();
    TestBed.configureTestingModule({
      imports: [ExpensesList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ExpensesService, useValue: { listMonth, remove } },
        { provide: VehiclesService, useValue: { list: vi.fn().mockReturnValue(of({ content: [] })) } },
        { provide: NotificationService, useValue: { success, error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ExpensesList);
    fixture.detectChanges();
    return fixture;
  }

  const host = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  beforeEach(() => TestBed.resetTestingModule());

  it('mostra os três números do mês em pt-BR: total, maior categoria e só da locadora', () => {
    const el = host(create(ROWS));
    expect(text(el.querySelector('[data-kpi="total"]'))).toContain('R$ 930,00');
    expect(text(el.querySelector('[data-kpi="total"]'))).toContain('3 lançamentos');
    expect(text(el.querySelector('[data-kpi="biggest"]'))).toContain('Abastecimento');
    expect(text(el.querySelector('[data-kpi="biggest"]'))).toContain('R$ 480,00 em 2 lançamentos');
    expect(text(el.querySelector('[data-kpi="company-wide"]'))).toContain('R$ 450,00');
  });

  it('diz que o gasto baixa o Lucro e conta pela data do gasto', () => {
    const note = text(host(create(ROWS)).querySelector('[data-expenses-note]'));
    expect(note).toContain('diminui o Lucro');
    expect(note).toContain('data do gasto');
  });

  it('uma linha por gasto, com o rodapé somando o que aparece', () => {
    const el = host(create(ROWS));
    expect(el.querySelectorAll('[data-expense-id]').length).toBe(3);
    expect(text(el.querySelector('[data-expenses-footer]'))).toContain('Mostrando 3 de 3');
    expect(text(el.querySelector('[data-expenses-footer]'))).toContain('R$ 930,00');
  });

  it('gasto sem veículo aparece como Locadora toda', () => {
    const row = host(create(ROWS)).querySelector('[data-expense-id="e3"]');
    expect(text(row)).toContain('Locadora toda');
  });

  it('sem divisórias nem cor na linha: a cor mora só no chip da categoria', () => {
    const el = host(create(ROWS));
    for (const li of Array.from(el.querySelectorAll('[data-expense-id]'))) {
      expect(li.className).not.toMatch(/\bborder|divide-/);
      expect(li.className).not.toMatch(/\bbg-(rose|amber|emerald|primary|blue)/);
    }
    expect(el.querySelector('[data-expense-category]')?.className).toMatch(/bg-surface-sunken/);
  });

  it('ação de linha é o menu kebab com Editar e Excluir', () => {
    const fixture = create(ROWS);
    const el = host(fixture);
    const menus = el.querySelectorAll('app-actions-menu');
    expect(menus.length).toBe(3);
    menus[0].querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    const labels = Array.from(menus[0].querySelectorAll('[role="menuitem"]')).map((n) => text(n));
    expect(labels).toEqual(['Editar', 'Excluir']);
    expect(menus[0].querySelector('a[role="menuitem"]')?.getAttribute('href')).toBe('/gastos/e1/editar');
  });

  it('estado vazio: texto, zeros nos números e o convite a lançar o primeiro', () => {
    const el = host(create([]));
    const empty = el.querySelector('[data-expenses-empty]');
    expect(empty).not.toBeNull();
    expect(text(empty)).toContain('Nenhum gasto em');
    expect(text(empty)).toContain('Lançar primeiro gasto');
    expect(text(el.querySelector('[data-kpi="total"]'))).toContain('R$ 0,00');
    expect(text(el.querySelector('[data-kpi="biggest"]'))).toContain('Sem lançamentos');
    expect(el.querySelector('[data-expense-id]')).toBeNull();
  });

  it('com lançamentos NÃO mostra o estado vazio', () => {
    expect(host(create(ROWS)).querySelector('[data-expenses-empty]')).toBeNull();
  });

  it('a busca filtra a lista e "nenhum resultado" não é o estado vazio do mês', () => {
    const fixture = create(ROWS);
    const el = host(fixture);
    const input = el.querySelector<HTMLInputElement>('#expenses-search')!;
    input.value = 'contador';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-expense-id]').length).toBe(1);

    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-expenses-no-match]')).not.toBeNull();
    expect(el.querySelector('[data-expenses-empty]')).toBeNull();
  });

  it('o mês corrente trava o "próximo"; voltar recarrega o mês anterior', () => {
    const fixture = create(ROWS);
    const el = host(fixture);
    expect(el.querySelector<HTMLButtonElement>('[data-month-next]')!.disabled).toBe(true);
    const current = todayInBusinessTz().slice(0, 7);
    expect(listMonth).toHaveBeenLastCalledWith(current);

    el.querySelector<HTMLButtonElement>('[data-month-prev]')!.click();
    fixture.detectChanges();
    expect(listMonth).toHaveBeenLastCalledWith(shiftMonth(current, -1));
    expect(el.querySelector<HTMLButtonElement>('[data-month-next]')!.disabled).toBe(false);
  });

  it('Excluir só chama o back-end depois de confirmar; cancelar não exclui', () => {
    const fixture = create(ROWS);
    const el = host(fixture);
    const dialog = () => fixture.debugElement.query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog;
    const askFirst = () => {
      const menu = el.querySelectorAll('app-actions-menu')[0];
      if (!menu.querySelector('[role="menuitem"]')) {
        menu.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
        fixture.detectChanges();
      }
      menu.querySelector<HTMLButtonElement>('button[role="menuitem"]')!.click();
      fixture.detectChanges();
    };

    askFirst();
    expect(dialog().open()).toBe(true);
    expect(dialog().message()).toContain('Não dá para desfazer');
    expect(remove).not.toHaveBeenCalled();

    dialog().cancelled.emit();
    fixture.detectChanges();
    expect(dialog().open()).toBe(false);
    expect(remove).not.toHaveBeenCalled();

    askFirst();
    dialog().confirmed.emit();
    fixture.detectChanges();
    expect(remove).toHaveBeenCalledWith('e1');
    expect(success).toHaveBeenCalled();
    expect(listMonth).toHaveBeenCalledTimes(2); // recarrega o mês depois de excluir
  });

  it('erro de carga mostra o banner e não finge que o mês está vazio', () => {
    const el = host(create('error'));
    expect(el.querySelector('app-alert-banner')).not.toBeNull();
    expect(el.querySelector('[data-expenses-empty]')).toBeNull();
  });

  it('excluir a unica linha da ultima pagina volta uma pagina (sem lista em branco)', () => {
    const many = Array.from({ length: 21 }, (_, i) => exp({ id: `m${i}`, description: `g${i}` }));
    const fixture = create(many);
    const el = host(fixture);
    const inst = fixture.componentInstance as unknown as { next: () => void; page: () => number };
    inst.next();
    fixture.detectChanges();
    expect(inst.page()).toBe(1);
    expect(el.querySelectorAll('[data-expense-id]').length).toBe(1);

    listMonth.mockReturnValue(of(many.slice(0, 20)));
    const dialog = fixture.debugElement.query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog;
    (fixture.componentInstance as unknown as { askDelete: (e: Expense) => void }).askDelete(many[20]);
    dialog.confirmed.emit();
    fixture.detectChanges();
    expect(inst.page()).toBe(0);
    expect(el.querySelectorAll('[data-expense-id]').length).toBe(20);
  });

  it('excluir com 404 (ja apagado em outro lugar) mostra o erro e atualiza a lista', () => {
    const fixture = create(ROWS);
    remove.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    listMonth.mockClear();
    listMonth.mockReturnValue(of(ROWS.slice(1)));
    const dialog = fixture.debugElement.query(By.directive(ConfirmDialog)).componentInstance as ConfirmDialog;
    (fixture.componentInstance as unknown as { askDelete: (e: Expense) => void }).askDelete(ROWS[0]);
    dialog.confirmed.emit();
    fixture.detectChanges();
    expect(listMonth).toHaveBeenCalledTimes(1);
    expect(host(fixture).querySelector('[data-expense-id="e1"]')).toBeNull();
    expect(host(fixture).querySelector('app-alert-banner')).not.toBeNull();
  });
});
