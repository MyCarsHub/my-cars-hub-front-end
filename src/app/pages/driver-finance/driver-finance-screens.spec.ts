import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../services/notification.service';
import { DriverDashboard } from './driver-dashboard';
import { DriverEarnings } from './driver-earnings';
import { DriverExpenses } from './driver-expenses';
import { DRIVER_FINANCE_TODAY, DriverFinanceSource } from './driver-finance.source';
import { DriverGoalsPage } from './driver-goals';
import { FakeFinanceSource, TODAY, expense, income } from './driver-finance.testing';

/**
 * The owner's acceptance criteria for the finance screens (design_handoff_motorista
 * README, «Aceite»): launch in ≤ 3 touches from the Dashboard, edit and delete through the
 * same popup, and the four states (skeleton, erro com «Tentar novamente», vazio, vazio com
 * filtros) on Ganhos and Custos.
 */
describe('driver finance screens', () => {
  let source: FakeFinanceSource;

  function mount<T>(component: Type<T>): ComponentFixture<T> {
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        { provide: DriverFinanceSource, useValue: source },
        { provide: DRIVER_FINANCE_TODAY, useValue: () => TODAY },
      ],
    });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture;
  }

  const doc = () => document.body;
  const q = <E extends HTMLElement>(sel: string) => doc().querySelector<E>(sel);
  const qa = (sel: string) => Array.from(doc().querySelectorAll<HTMLElement>(sel));
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function typeAmount(fixture: ComponentFixture<unknown>, value: string): void {
    const input = q<HTMLInputElement>('[data-field="amount"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    source = new FakeFinanceSource();
    document.body.innerHTML = '';
  });

  describe('Dashboard — lançar em até 3 toques', () => {
    it('Lançar → valor → Salvar grava um ganho de hoje', () => {
      const fixture = mount(DriverDashboard);
      const success = vi.spyOn(TestBed.inject(NotificationService), 'success');

      // 1º toque
      q('[data-action="launch"]')!.click();
      fixture.detectChanges();
      expect(q('[role="dialog"]')).not.toBeNull();
      // 2º toque: o valor (o foco já está nele)
      typeAmount(fixture, '150,50');
      // 3º toque
      q('[data-action="save"]')!.click();
      fixture.detectChanges();

      expect(source.created).toHaveLength(1);
      expect(source.created[0]).toMatchObject({ type: 'INCOME', amount: 15050, date: TODAY, app: 'UBER' });
      expect(q('[role="dialog"]')).toBeNull();
      expect(success).toHaveBeenCalledWith('Ganho de R$ 150,50 lançado.');
    });

    it('a aba Custo do mesmo popup grava um custo', () => {
      const fixture = mount(DriverDashboard);
      q('[data-action="launch"]')!.click();
      fixture.detectChanges();
      q('[data-tab="EXPENSE"]')!.click();
      fixture.detectChanges();
      typeAmount(fixture, '80');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.created[0]).toMatchObject({ type: 'EXPENSE', amount: 8000, category: 'FUEL' });
    });

    it('sem valor não salva e diz por quê', () => {
      const fixture = mount(DriverDashboard);
      q('[data-action="launch"]')!.click();
      fixture.detectChanges();
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.created).toHaveLength(0);
      expect(text(q('#ledger-amount-error'))).toBe('Informe o valor.');
    });

    it('mostra o lucro de hoje a partir do ledger', () => {
      source.items = [income({ amount: 26060 }), expense({ amount: 12000 })];
      mount(DriverDashboard);
      expect(text(q('[data-hero-net]'))).toBe('R$ 140,60');
    });

    it('erro na carga mostra o aviso com «Tentar novamente»', () => {
      source.mode = 'error';
      const fixture = mount(DriverDashboard);
      expect(text(q('[data-state="error"]'))).toContain('Não foi possível carregar seus números.');
      source.mode = 'ok';
      q<HTMLButtonElement>('[data-state="error"] button')!.click();
      fixture.detectChanges();
      expect(q('[data-hero]')).not.toBeNull();
      expect(q('[data-state="error"]')).toBeNull();
    });
  });

  describe('Ganhos', () => {
    it('editar abre o mesmo popup preenchido e salva por PUT', () => {
      source.items = [income()];
      const fixture = mount(DriverEarnings);
      qa('[data-row]')[0].click();
      fixture.detectChanges();
      expect(text(q('[role="dialog"] h2'))).toBe('Editar ganho');
      expect(q<HTMLInputElement>('[data-field="amount"]')!.value).toBe('186,40');
      typeAmount(fixture, '200');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.updated).toEqual([
        { id: 'g1', request: expect.objectContaining({ amount: 20000, rides: 9, km: 112 }) },
      ]);
      expect(text(q('[data-total]'))).toBe('R$ 200,00');
    });

    it('excluir sai do mesmo popup e some da lista', () => {
      source.items = [income(), income({ id: 'g2', amount: 7420, app: '99' })];
      const fixture = mount(DriverEarnings);
      qa('[data-row]')[0].click();
      fixture.detectChanges();
      expect(text(q('[data-action="remove"]'))).toBe('Excluir ganho');
      q('[data-action="remove"]')!.click();
      fixture.detectChanges();
      expect(source.removed).toHaveLength(1);
      expect(qa('[data-row]')).toHaveLength(1);
    });

    it('carregando: esqueleto, sem lista', () => {
      source.mode = 'never';
      mount(DriverEarnings);
      expect(q('[data-state="loading"]')).not.toBeNull();
      expect(q('[data-row]')).toBeNull();
    });

    it('erro: aviso com «Tentar novamente» que recarrega', () => {
      source.mode = 'error';
      source.items = [income()];
      const fixture = mount(DriverEarnings);
      expect(text(q('[data-state="error"]'))).toContain('Não foi possível carregar seus ganhos.');
      source.mode = 'ok';
      q<HTMLButtonElement>('[data-state="error"] button')!.click();
      fixture.detectChanges();
      expect(qa('[data-row]')).toHaveLength(1);
    });

    it('vazio: convite para o primeiro ganho, sem FAB nem botão duplicado', () => {
      mount(DriverEarnings);
      expect(text(q('[data-state="empty"]'))).toContain('Você ainda não lançou nenhum ganho.');
      expect(q('[data-action="first"]')).not.toBeNull();
      expect(q('[data-action="new"]')).toBeNull();
      expect(q('[data-action="fab"]')).toBeNull();
    });

    it('vazio com filtros: «Limpar filtros» volta para 30 dias', () => {
      source.items = [income({ date: '2026-09-25' })];
      const fixture = mount(DriverEarnings);
      expect(q('[data-state="no-match"]')).not.toBeNull();
      q('[data-action="clear"]')!.click();
      fixture.detectChanges();
      expect(qa('[data-row]')).toHaveLength(1);
      expect(q('[data-period="30"]')!.getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('Custos', () => {
    it('editar e excluir pelo mesmo popup', () => {
      source.items = [expense(), expense({ id: 'c2', category: 'TOLL_PARKING', amount: 1890 })];
      const fixture = mount(DriverExpenses);
      qa('[data-row]')[0].click();
      fixture.detectChanges();
      expect(text(q('[role="dialog"] h2'))).toBe('Editar custo');
      expect(text(q('#ledger-odometer-hint'))).toBe('Último registro: 48.320 km.');
      q('[data-action="remove"]')!.click();
      fixture.detectChanges();
      expect(source.removed).toHaveLength(1);
      expect(qa('[data-row]')).toHaveLength(1);
    });

    it('carregando, erro, vazio e vazio com filtros', () => {
      source.mode = 'never';
      let fixture = mount(DriverExpenses);
      expect(q('[data-state="loading"]')).not.toBeNull();
      fixture.destroy();
      TestBed.resetTestingModule();
      document.body.innerHTML = '';

      source.mode = 'error';
      fixture = mount(DriverExpenses);
      expect(text(q('[data-state="error"]'))).toContain('Tentar novamente');
      fixture.destroy();
      TestBed.resetTestingModule();
      document.body.innerHTML = '';

      source.mode = 'ok';
      fixture = mount(DriverExpenses);
      expect(text(q('[data-state="empty"]'))).toContain('Você ainda não lançou nenhum custo.');
      fixture.destroy();
      TestBed.resetTestingModule();
      document.body.innerHTML = '';

      source.items = [expense()];
      fixture = mount(DriverExpenses);
      q('[data-category="CAR_WASH"]')!.click();
      fixture.detectChanges();
      expect(text(q('[data-state="no-match"]'))).toContain('Nenhum custo com esses filtros.');
      q('[data-action="clear"]')!.click();
      fixture.detectChanges();
      expect(qa('[data-row]')).toHaveLength(1);
    });
  });

  describe('Metas', () => {
    it('semanal = dia × dias; mensal = semanal × 4; salva em centavos', () => {
      const fixture = mount(DriverGoalsPage);
      const input = q<HTMLInputElement>('[data-field="daily"]')!;
      input.value = '250';
      input.dispatchEvent(new Event('input'));
      q('[data-days="5"]')!.click();
      fixture.detectChanges();
      expect(text(q('[data-week-goal]'))).toBe('R$ 1.250,00');
      expect(text(q('[data-month-goal]'))).toBe('R$ 5.000,00');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.savedGoals).toEqual([{ dailyGoal: 25000, workDaysPerWeek: 5 }]);
    });

    it('meta zero não salva', () => {
      const fixture = mount(DriverGoalsPage);
      const input = q<HTMLInputElement>('[data-field="daily"]')!;
      input.value = '';
      input.dispatchEvent(new Event('input'));
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.savedGoals).toHaveLength(0);
      expect(text(q('#goal-daily-error'))).toBe('Informe um valor maior que zero.');
    });
  });
});
