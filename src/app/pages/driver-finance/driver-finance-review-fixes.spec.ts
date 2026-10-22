import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { DriverDashboard } from './driver-dashboard';
import { calendarModel, dayModel, periodModel } from './driver-dashboard.model';
import { previousWindow, simulateDashboard } from './driver-finance.simulator';
import { DriverEarnings } from './driver-earnings';
import { DriverExpenses } from './driver-expenses';
import { DriverFinanceClock } from './driver-finance.clock';
import {
  DRIVER_FINANCE_TODAY,
  DriverFinanceSource,
  HttpDriverFinanceSource,
  LEDGER_PAGE_SIZE,
  toCalendar,
  toDashboard,
} from './driver-finance.source';
import { DriverGoalsPage } from './driver-goals';
import { DriverRentalContext, LedgerItem } from './driver-finance.types';
import { FakeFinanceSource, TODAY, expense, income } from './driver-finance.testing';
import { parseHours, saveErrorMessage } from './ledger-entry-sheet';
import { FAB } from './driver-finance.ui';

/** One spec per finding of the cold review of 2026-10-21 (items 4–7, 10–14, 16). */
describe('driver finance — review fixes', () => {
  let source: FakeFinanceSource;
  let today = TODAY;

  function mount<T>(component: Type<T>): ComponentFixture<T> {
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        { provide: DriverFinanceSource, useValue: source },
        { provide: DRIVER_FINANCE_TODAY, useValue: () => today },
      ],
    });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture;
  }

  const q = <E extends HTMLElement>(sel: string) => document.body.querySelector<E>(sel);
  const qa = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel));
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const type = (fixture: ComponentFixture<unknown>, sel: string, value: string) => {
    const input = q<HTMLInputElement>(sel)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    source = new FakeFinanceSource();
    today = TODAY;
    document.body.innerHTML = '';
  });

  // N4: the server always sends `goals`; what reaches the screen is a driver WITHOUT a goal
  // (`configured: false`). A failing /dashboard is still fatal — it is the screen's source.
  it('4 · a driver without a goal: no ring, the rest renders, «Definir metas» link', () => {
    source.goalsValue = null;
    source.items = [income()];
    mount(DriverDashboard);
    expect(q('[data-state="error"]')).toBeNull();
    expect(text(q('[data-hero-net]'))).toBe('R$ 186,40');
    expect(q('[data-hero] [role="img"]')).toBeNull();
    expect(q('[data-goals] a')).not.toBeNull();
  });

  describe('6 · daily goal in pt-BR cents', () => {
    it('saves "150,50" as 15050 cents, not 15050 reais', () => {
      const fixture = mount(DriverGoalsPage);
      type(fixture, '[data-field="daily"]', '150,50');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.savedGoals[0].dailyGoal).toBe(15050);
    });

    it('opens a saved R$ 150,50 as "150,50" and saves it back unchanged', () => {
      source.goalsValue = { dailyGoal: 15050, workDaysPerWeek: 6 };
      const fixture = mount(DriverGoalsPage);
      expect(q<HTMLInputElement>('[data-field="daily"]')!.value).toBe('150,50');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.savedGoals).toEqual([{ dailyGoal: 15050, workDaysPerWeek: 6 }]);
    });
  });

  describe('7 · hours and ceilings', () => {
    it('reads "7,25", "7.5" and refuses garbage and more than 24h', () => {
      expect(parseHours('7,25')).toEqual({ value: 7.25, error: null });
      expect(parseHours('7.5')).toEqual({ value: 7.5, error: null });
      expect(parseHours('')).toEqual({ value: null, error: null });
      expect(parseHours('7,255').error).not.toBeNull();
      expect(parseHours('25').error).toBe('No máximo 24 horas.');
    });

    it('a ride detail over the ceiling blocks the save with a field message', () => {
      const fixture = mount(DriverEarnings);
      q('[data-action="first"]')!.click();
      fixture.detectChanges();
      type(fixture, '[data-field="amount"]', '100');
      type(fixture, '[data-field="rides"]', '2000');
      type(fixture, '[data-field="hours"]', '30');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.created).toHaveLength(0);
      expect(text(q('#ledger-rides-error'))).toBe('No máximo 1.000.');
      expect(text(q('#ledger-hours-error'))).toBe('No máximo 24 horas.');
    });

    it('hours typed with a dot are saved, with two decimals', () => {
      const fixture = mount(DriverEarnings);
      q('[data-action="first"]')!.click();
      fixture.detectChanges();
      type(fixture, '[data-field="amount"]', '100');
      type(fixture, '[data-field="hours"]', '7.25');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.created[0].hours).toBe(7.25);
    });

    it('a 400 reads as a problem with the values, not with the connection', () => {
      expect(saveErrorMessage(new HttpErrorResponse({ status: 400 }), 'salvar')).toContain(
        'Confira os valores',
      );
      expect(saveErrorMessage(new HttpErrorResponse({ status: 0 }), 'salvar')).toContain('conexão');
      source.writeError = new HttpErrorResponse({ status: 400 });
      const fixture = mount(DriverEarnings);
      q('[data-action="first"]')!.click();
      fixture.detectChanges();
      type(fixture, '[data-field="amount"]', '100');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(text(q('[role="dialog"] app-alert-banner'))).toContain('Confira os valores');
    });
  });

  describe('10 · an edit keeps what the UI does not show', () => {
    it('cost: category without a chip, notes and rentalId go back unchanged', () => {
      source.items = [expense({ category: 'FOOD', notes: 'Almoço', rentalId: 'r-9' })];
      const fixture = mount(DriverExpenses);
      qa('[data-row]')[0].click();
      fixture.detectChanges();
      expect(q('[data-category="FOOD"]')!.getAttribute('aria-checked')).toBe('true');
      type(fixture, '[data-field="amount"]', '50');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.updated[0].request).toMatchObject({
        category: 'FOOD',
        notes: 'Almoço',
        rentalId: 'r-9',
      });
    });

    it('income: category DELIVERIES and "no app" survive', () => {
      source.items = [income({ category: 'DELIVERIES', app: null, rentalId: 'r-1' })];
      const fixture = mount(DriverEarnings);
      qa('[data-row]')[0].click();
      fixture.detectChanges();
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.updated[0].request).toMatchObject({
        category: 'DELIVERIES',
        app: null,
        rentalId: 'r-1',
      });
    });
  });

  it('11 · "hoje" turns over with the page open and the list re-reads from the new day', () => {
    const fixture = mount(DriverEarnings);
    const before = source.listCalls.length;
    today = '2026-10-11';
    fixture.debugElement.injector.get(DriverFinanceClock).refresh();
    fixture.detectChanges();
    expect(source.listCalls.length).toBe(before + 1);
    expect(source.listCalls.at(-1)).toMatchObject({ to: '2026-10-11', from: '2026-09-12' });
  });

  describe('12 · rent', () => {
    const rental: DriverRentalContext = {
      vehicleLabel: 'Mobi',
      plate: null,
      periodAmount: 70000,
      periodDays: 7,
      startDate: '2026-10-08',
      nextCharge: null,
      charges: [],
    };

    it('the simulated server accrues only contract days that already happened', () => {
      // 08, 09, 10 of October: three days of R$ 100,00.
      const d = simulateDashboard([], '2026-10-01', '2026-10-31', TODAY, rental, null);
      expect(d.breakdown.rentAccruedCents).toBe(30000);
    });

    it('the split shows the rent once when the driver typed it as a RENTAL_FEE cost', () => {
      const items = [income({ amount: 100000 }), expense({ category: 'RENTAL_FEE', amount: 70000, odometerKm: null })];
      const model = periodModel(simulateDashboard(items, '2026-10-01', '2026-10-31', TODAY, rental, null));
      const row = (key: string) => model.split.rows.find((r) => r.key === key)?.value;
      expect(row('exp')).toBe('R$ 0,00');
      expect(row('rent')).toBe('R$ 700,00');
      expect(model.split.net).toBe('R$ 300,00');
    });
  });

  describe('re-review N3, N5, N6, N7, N8, N9 and the odometer ceiling', () => {
    it('N3 · "Por hora" divides only the earnings that carry hours', () => {
      source.items = [
        income({ id: 'a', amount: 20000, hours: 8 }),
        income({ id: 'b', amount: 20000, hours: null }),
      ];
      mount(DriverEarnings);
      expect(text(q('dl'))).toContain('R$ 25,00');
    });

    it('N8 · earnings without app get their own bar', () => {
      source.items = [income({ id: 'a', app: null, amount: 5000 }), income({ id: 'b', amount: 5000 })];
      mount(DriverEarnings);
      expect(text(document.body)).toContain('Sem app');
    });

    it('N5 · an edit keeps zeros as zeros', () => {
      source.items = [income({ rides: 0, km: 0, hours: 0 })];
      const fixture = mount(DriverEarnings);
      qa('[data-row]')[0].click();
      fixture.detectChanges();
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.updated[0].request).toMatchObject({ rides: 0, km: 0, hours: 0 });
    });

    it('item 7 · the odometer above 2.000.000 km is refused on the field', () => {
      const fixture = mount(DriverExpenses);
      q('[data-action="first"]')!.click();
      fixture.detectChanges();
      type(fixture, '[data-field="amount"]', '50');
      type(fixture, '#ledger-odometer', '2000001');
      q('[data-action="save"]')!.click();
      fixture.detectChanges();
      expect(source.created).toHaveLength(0);
      expect(text(q('#ledger-odometer-error'))).toBe('No máximo 2.000.000 km.');
    });

    it('N7 · the day turning over refreshes Metas in place, keeping what is typed', () => {
      const fixture = mount(DriverGoalsPage);
      type(fixture, '[data-field="daily"]', '180,00');
      today = '2026-10-11';
      source.today = today;
      fixture.debugElement.injector.get(DriverFinanceClock).refresh();
      fixture.detectChanges();
      expect(q('[data-state="loading"]')).toBeNull();
      expect(q<HTMLInputElement>('[data-field="daily"]')!.value).toBe('180,00');
    });

    it('N9 · a whole month is compared with the previous calendar month', () => {
      expect(previousWindow('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
      expect(previousWindow('2026-10-04', '2026-10-10')).toEqual({ from: '2026-09-27', to: '2026-10-03' });
    });
  });

  describe('re-review N1, N2 — the rent rule lives on the server (backend faebbb59)', () => {
    it('N1 · the split reads breakdown as sent: a RENTAL_FEE is not subtracted again', () => {
      const dash = toDashboard(
        {
          totals: { incomeCents: 100000, expenseCents: 70000, netCents: 30000, entryCount: 2 },
          expenseByCategory: [{ category: 'RENTAL_FEE', totalCents: 70000, entryCount: 1 }],
          breakdown: { incomeCents: 100000, expenseCents: 0, rentAccruedCents: 70000, leftCents: 30000 },
        },
        '2026-10-01',
        '2026-10-31',
      );
      const model = periodModel(dash);
      const row = (key: string) => model.split.rows.find((r) => r.key === key)?.value;
      expect(row('exp')).toBe('R$ 0,00');
      expect(row('rent')).toBe('R$ 700,00');
      expect(model.split.net).toBe('R$ 300,00');
    });

    it('N2 · the hero shows the server profit, rent counted once on a RENTAL_FEE day', () => {
      source.contextValue = {
        firstName: 'Carlos',
        licenseExpiry: null,
        rental: { vehicleLabel: 'Mobi', plate: null, periodAmount: 70000, periodDays: 7, startDate: '2026-10-01', nextCharge: null, charges: [] },
      };
      source.items = [income({ amount: 100000 }), expense({ category: 'RENTAL_FEE', amount: 70000, odometerKm: null })];
      mount(DriverDashboard);
      expect(text(q('[data-hero-net]'))).toBe('R$ 300,00');
    });

    it('calendar: OVERDUE_FEE, FAILED and DISPUTED read in Portuguese; truncated is flagged', () => {
      const cal = toCalendar(
        {
          month: '2026-10-01',
          totals: { incomeCents: 0, outflowCents: 0, dueCents: 0, balanceCents: 0 },
          truncated: true,
          days: [
            {
              date: '2026-10-13',
              incomeCents: 0,
              outflowCents: 1000,
              dueCents: 2000,
              items: [
                { id: 'a', type: 'CHARGE_DUE', label: 'OVERDUE_FEE', amountCents: 1000, status: 'PENDING' },
                { id: 'b', type: 'CHARGE_DUE', label: 'RENT', amountCents: 1000, status: 'FAILED' },
                { id: 'c', type: 'CHARGE_PAID', label: 'RENT', amountCents: 1000, status: 'DISPUTED' },
              ],
            },
          ],
        },
        '2026-10',
      );
      expect(cal.truncated).toBe(true);
      expect(calendarModel(cal, '2026-10-01', TODAY).truncated).toBe(true);
      const events = dayModel(cal, '2026-10-13', null).events;
      expect(events.map((e) => `${e.kind} / ${e.label}`)).toEqual([
        'Cobrança a vencer / Multa por atraso do aluguel',
        'Cobrança não emitida / Aluguel',
        'Pagamento em contestação / Aluguel',
      ]);
      expect(events.some((e) => e.label.includes('OVERDUE_FEE'))).toBe(false);
    });
  });

  it('13 · a failed period read keeps the Dashboard and offers a retry', () => {
    source.items = [income()];
    const fixture = mount(DriverDashboard);
    source.failList = true;
    q('[data-preset="year"]')!.click();
    fixture.detectChanges();
    expect(q('[data-window-error]')).not.toBeNull();
    expect(q('[data-hero]')).not.toBeNull();
    source.failList = false;
    q<HTMLButtonElement>('[data-window-error] button')!.click();
    fixture.detectChanges();
    expect(q('[data-window-error]')).toBeNull();
  });

  it('14 · cost per km uses the km of the period even with a category filter', () => {
    source.items = [
      expense({ id: 'a', category: 'FUEL', amount: 10000, odometerKm: 1000 }),
      expense({ id: 'b', category: 'CAR_WASH', amount: 3000, odometerKm: 1100, date: '2026-10-09' }),
    ];
    const fixture = mount(DriverExpenses);
    q('[data-category="CAR_WASH"]')!.click();
    fixture.detectChanges();
    // R$ 30,00 of washing over the 100 km the car ran in the period.
    expect(text(q('dl'))).toContain('R$ 0,30');
  });

  it('16 · radio groups move with the arrow keys and are one Tab stop', () => {
    source.items = [income()];
    const fixture = mount(DriverEarnings);
    const radios = qa('[role="radiogroup"] [role="radio"]');
    expect(radios.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
    radios[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(q('[data-period="30"]')!.getAttribute('aria-checked')).toBe('true');
  });
});

describe('5 · HttpDriverFinanceSource pages through the window', () => {
  it('asks the next page while pages come full, up to the total', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const src = TestBed.inject(HttpDriverFinanceSource);
    let result: LedgerItem[] | null = null;
    src.list({ from: '2026-08-01', to: TODAY }).subscribe((items) => (result = items));

    const row = (n: number) => ({
      id: `e${n}`,
      kind: 'INCOME',
      category: 'RIDES',
      amountCents: 100,
      occurredOn: TODAY,
    });
    const url = `${environment.apiUrl}/driver/ledger`;
    const first = http.expectOne((r) => r.url === url && r.params.get('page') === '0');
    expect(first.request.params.get('size')).toBe(String(LEDGER_PAGE_SIZE));
    expect(first.request.params.get('from')).toBe('2026-08-01');
    first.flush({ content: Array.from({ length: 100 }, (_, i) => row(i)), page: 0, size: 100, total: 130 });
    const second = http.expectOne((r) => r.url === url && r.params.get('page') === '1');
    second.flush({ content: Array.from({ length: 30 }, (_, i) => row(100 + i)), page: 1, size: 100, total: 130 });
    http.verify();
    expect(result).toHaveLength(130);
  });

  it('N6 · follows the size the server used and drops an id repeated across pages', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const src = TestBed.inject(HttpDriverFinanceSource);
    let result: LedgerItem[] | null = null;
    src.list({}).subscribe((items) => (result = items));
    const row = (n: number) => ({ id: `e${n}`, kind: 'INCOME', amountCents: 1, occurredOn: TODAY });
    const url = `${environment.apiUrl}/driver/ledger`;
    // The server capped the page at 50 although 100 was asked.
    http
      .expectOne((r) => r.url === url && r.params.get('page') === '0')
      .flush({ content: Array.from({ length: 50 }, (_, i) => row(i)), page: 0, size: 50, total: 60 });
    http
      .expectOne((r) => r.url === url && r.params.get('page') === '1')
      .flush({ content: [row(49), ...Array.from({ length: 10 }, (_, i) => row(50 + i))], page: 1, size: 50, total: 60 });
    http.verify();
    expect(result).toHaveLength(60);
  });

  it('N6 · an empty page stops the paging', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const src = TestBed.inject(HttpDriverFinanceSource);
    let result: LedgerItem[] | null = null;
    src.list({}).subscribe((items) => (result = items));
    http
      .expectOne((r) => r.url === `${environment.apiUrl}/driver/ledger`)
      .flush({ content: [], page: 0, size: 100, total: 999 });
    http.verify();
    expect(result).toEqual([]);
  });
});

describe('FAB «Lançar» do celular e o banner de cookies', () => {
  /*
   * O FAB é `fixed` no rodapé da VIEWPORT. Com o banner de cookies na tela ele ficava por
   * baixo dele; sobe o tanto que o banner publica em `--consent-banner-h`.
   */
  it('sobe acima do banner (soma --consent-banner-h ao bottom)', () => {
    expect(FAB).toContain('bottom-[calc(1rem+env(safe-area-inset-bottom)+var(--consent-banner-h,0px))]');
  });
});
