import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { expenseLabel } from './driver-finance.calc';
import { DriverFinanceClock } from './driver-finance.clock';
import {
  DRIVER_FINANCE_TODAY,
  DriverFinanceSource,
  HttpDriverFinanceSource,
} from './driver-finance.source';
import { DriverGoalsState, LedgerItem } from './driver-finance.types';
import { TODAY } from './driver-finance.testing';
import { LedgerEntrySheet } from './ledger-entry-sheet';

/**
 * The wire, against the backend contract of feat/driver-finance-api (bd54807f,
 * `Claude outputs/2026-10-21_CONTRACT_driver-finance-api.md`): URL, query and the BODY
 * that actually leaves the browser — the layer the screen specs (fake source) cannot see.
 */
const API = environment.apiUrl;
const LEDGER = `${API}/driver/ledger`;

/** A `DriverLedgerEntryResponseDto` as the server serialises it. */
const serverEntry = (over: Record<string, unknown> = {}) => ({
  id: '0b6f2c1e-0000-4000-8000-000000000001',
  kind: 'INCOME',
  category: 'RIDES',
  amountCents: 18640,
  occurredOn: TODAY,
  description: null,
  notes: null,
  rentalId: null,
  createdDate: '2026-10-10T12:00:00Z',
  modifyDate: '2026-10-10T12:00:00Z',
  app: 'UBER',
  rides: 9,
  hours: 6.5,
  km: 112,
  odometerKm: null,
  ...over,
});

const progress = (income: number, goal: number) => ({
  from: TODAY,
  to: TODAY,
  incomeCents: income,
  goalCents: goal,
  percent: goal ? Math.round((income / goal) * 100) : 0,
  reached: goal > 0 && income >= goal,
});

/** A `DriverGoalsResponseDto`. */
const serverGoals = (over: Record<string, unknown> = {}) => ({
  dailyGoalCents: 15050,
  workDaysPerWeek: 6,
  configured: true,
  weeklyGoalCents: 90300,
  monthlyGoalCents: 361200,
  today: progress(18640, 15050),
  week: progress(50000, 90300),
  month: progress(120000, 361200),
  weekDays: [{ date: '2026-10-05', incomeCents: 1000, goalCents: 15050, reached: false }],
  lastWeeks: [progress(1, 90300), progress(2, 90300), progress(3, 90300), progress(4, 90300)],
  ...over,
});

describe('HttpDriverFinanceSource — wire contract', () => {
  let http: HttpTestingController;
  let source: HttpDriverFinanceSource;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DRIVER_FINANCE_TODAY, useValue: () => TODAY },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    source = TestBed.inject(HttpDriverFinanceSource);
  });

  afterEach(() => http.verify());

  describe('ledger', () => {
    it('lists with kind (not type), category, from/to and the 100 page ceiling', () => {
      let items: LedgerItem[] = [];
      source
        .list({ from: '2026-10-01', to: TODAY, type: 'EXPENSE', category: 'CAR_WASH' })
        .subscribe((r) => (items = r));
      const req = http.expectOne((r) => r.url === LEDGER);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('kind')).toBe('EXPENSE');
      expect(req.request.params.has('type')).toBe(false);
      expect(req.request.params.get('category')).toBe('CAR_WASH');
      expect(req.request.params.get('from')).toBe('2026-10-01');
      expect(req.request.params.get('to')).toBe(TODAY);
      expect(req.request.params.get('page')).toBe('0');
      expect(req.request.params.get('size')).toBe('100');
      req.flush({
        content: [serverEntry({ kind: 'EXPENSE', category: 'CAR_WASH', app: null, rides: null, hours: null, km: null, odometerKm: 48320 })],
        page: 0,
        size: 100,
        total: 1,
      });
      expect(items).toEqual([
        expect.objectContaining({ type: 'EXPENSE', category: 'CAR_WASH', amount: 18640, date: TODAY, odometerKm: 48320, app: null }),
      ]);
    });

    it('hasAny asks one entry of that kind', () => {
      source.hasAny('EXPENSE').subscribe();
      const req = http.expectOne((r) => r.url === LEDGER);
      expect(req.request.params.get('kind')).toBe('EXPENSE');
      expect(req.request.params.get('size')).toBe('1');
      req.flush({ content: [], page: 0, size: 1, total: 0 });
    });

    it('creates an income with the server keys and no expense-only field', () => {
      source
        .create({
          date: TODAY,
          type: 'INCOME',
          category: 'RIDES',
          amount: 15050,
          app: '99',
          rides: 4,
          hours: 7.25,
          km: 41,
          odometerKm: null,
          notes: 'Dinheiro',
          rentalId: 'r-1',
        })
        .subscribe();
      const req = http.expectOne(LEDGER);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        kind: 'INCOME',
        category: 'RIDES',
        amountCents: 15050,
        occurredOn: TODAY,
        description: 'Dinheiro',
        rentalId: 'r-1',
        app: '99',
        rides: 4,
        hours: 7.25,
        km: 41,
      });
      req.flush(serverEntry({ app: '99' }), { status: 201, statusText: 'Created' });
    });

    it('updates an expense by PUT with the odometer and no ride field', () => {
      source
        .update('abc', {
          date: '2026-10-09',
          type: 'EXPENSE',
          category: 'FOOD',
          amount: 3500,
          app: null,
          rides: null,
          hours: null,
          km: null,
          odometerKm: 48320,
          notes: 'Almoço',
          rentalId: null,
        })
        .subscribe();
      const req = http.expectOne(`${LEDGER}/abc`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({
        kind: 'EXPENSE',
        category: 'FOOD',
        amountCents: 3500,
        occurredOn: '2026-10-09',
        description: 'Almoço',
        rentalId: null,
        odometerKm: 48320,
      });
      req.flush(serverEntry({ kind: 'EXPENSE', category: 'FOOD', app: null }));
    });

    it('deletes by id', () => {
      source.remove('abc').subscribe();
      const req = http.expectOne(`${LEDGER}/abc`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('reads notes from description and keeps rentalId', () => {
      let items: LedgerItem[] = [];
      source.list({}).subscribe((r) => (items = r));
      http
        .expectOne((r) => r.url === LEDGER)
        .flush({ content: [serverEntry({ description: 'Gorjeta', notes: 'Gorjeta', rentalId: 'r-9' })], page: 0, size: 100, total: 1 });
      expect(items[0]).toMatchObject({ notes: 'Gorjeta', rentalId: 'r-9' });
    });
  });

  describe('goals', () => {
    it('reads dailyGoalCents and the progress', () => {
      let state: DriverGoalsState | null = null;
      source.goals().subscribe((r) => (state = r));
      const req = http.expectOne(`${API}/driver/goals`);
      expect(req.request.method).toBe('GET');
      req.flush(serverGoals());
      expect(state!.goal).toEqual({ dailyGoal: 15050, workDaysPerWeek: 6 });
      expect(state!.today).toMatchObject({ incomeCents: 18640, goalCents: 15050, reached: true });
      expect(state!.lastWeeks).toHaveLength(4);
    });

    it('configured:false is "never defined"', () => {
      let state: DriverGoalsState | null = null;
      source.goals().subscribe((r) => (state = r));
      http.expectOne(`${API}/driver/goals`).flush(serverGoals({ configured: false, dailyGoalCents: 0 }));
      expect(state!.goal).toBeNull();
    });

    it('saves with PUT { dailyGoalCents, workDaysPerWeek }', () => {
      source.saveGoals({ dailyGoal: 15050, workDaysPerWeek: 5 }).subscribe();
      const req = http.expectOne(`${API}/driver/goals`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ dailyGoalCents: 15050, workDaysPerWeek: 5 });
      req.flush(serverGoals({ workDaysPerWeek: 5 }));
    });
  });

  describe('dashboard and calendar', () => {
    it('reads the dashboard aggregates of from..to', () => {
      let rides = -1;
      let best: number | null = null;
      source.dashboard('2026-10-01', '2026-10-31').subscribe((d) => {
        rides = d.efficiency.rides;
        best = d.weekdays.bestIsoDay;
      });
      const req = http.expectOne((r) => r.url === `${API}/driver/dashboard`);
      expect(req.request.params.get('from')).toBe('2026-10-01');
      expect(req.request.params.get('to')).toBe('2026-10-31');
      req.flush({
        from: '2026-10-01',
        to: '2026-10-31',
        totals: { incomeCents: 1, expenseCents: 0, netCents: 1, entryCount: 1 },
        today: { date: TODAY, incomeCents: 0, expenseCents: 0, rentAccruedCents: 9286, profitCents: -9286, rides: 0, hours: 0, km: 0, avgPerRideCents: null },
        goals: serverGoals(),
        efficiency: { rides: 73, hours: 48, km: 858, avgPerRideCents: 1912, perHourCents: 2884, perKmCents: 162, profitPerKmCents: 50 },
        previousEfficiency: null,
        breakdown: { incomeCents: 1, expenseCents: 0, rentAccruedCents: 0, leftCents: 1 },
        incomeByApp: [{ app: null, totalCents: 1, rides: 0, entryCount: 1, avgPerRideCents: null }],
        weekdays: { days: [], bestIsoDay: 4, avgPerWorkedDayCents: 0 },
        expenseStats: { lastOdometerKm: 48320, odometerSpanKm: null, costPerKmCents: null },
      });
      expect(rides).toBe(73);
      expect(best).toBe(4);
    });

    it('asks the calendar by month and drops item types it does not know', () => {
      let count = -1;
      source.calendar('2026-10').subscribe((c) => (count = c.days[0].items.length));
      const req = http.expectOne((r) => r.url === `${API}/driver/calendar`);
      expect(req.request.params.get('month')).toBe('2026-10');
      req.flush({
        month: '2026-10-01',
        totals: { incomeCents: 0, outflowCents: 0, dueCents: 65000, balanceCents: -65000 },
        days: [
          {
            date: '2026-10-13',
            incomeCents: 0,
            outflowCents: 0,
            dueCents: 65000,
            items: [
              { id: 'c1', type: 'CHARGE_DUE', label: 'RENT', amountCents: 65000, status: 'PENDING' },
              { id: 'x', type: 'SOMETHING_NEW', label: '?', amountCents: 1, status: null },
            ],
          },
        ],
      });
      expect(count).toBe(1);
    });
  });
});

describe('category and app mapping — chip → body sent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LedgerEntrySheet],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DRIVER_FINANCE_TODAY, useValue: () => TODAY },
        { provide: DriverFinanceSource, useExisting: HttpDriverFinanceSource },
        DriverFinanceClock,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    document.body.innerHTML = '';
  });

  afterEach(() => http.verify());

  function launch(type: 'INCOME' | 'EXPENSE', chip: string): unknown {
    const fixture = TestBed.createComponent(LedgerEntrySheet);
    fixture.detectChanges();
    fixture.componentInstance.openCreate(type);
    fixture.detectChanges();
    const amount = document.querySelector<HTMLInputElement>('[data-field="amount"]')!;
    amount.value = '10';
    amount.dispatchEvent(new Event('input'));
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (b) => b.textContent?.trim() === chip,
    );
    expect(button, `chip «${chip}»`).toBeDefined();
    button!.click();
    fixture.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    const req = http.expectOne(LEDGER);
    const body = req.request.body;
    req.flush(serverEntry());
    return body;
  }

  const CATEGORIES: [string, string][] = [
    ['Combustível', 'FUEL'],
    ['Lavagem', 'CAR_WASH'],
    ['Pedágio', 'TOLL_PARKING'],
    ['Manutenção', 'MAINTENANCE'],
    ['Estacionamento', 'PARKING'],
    ['Outros', 'OTHER_EXPENSE'],
  ];
  for (const [label, wire] of CATEGORIES) {
    it(`custo «${label}» sai como ${wire}`, () => {
      expect(launch('EXPENSE', label)).toMatchObject({ kind: 'EXPENSE', category: wire });
    });
  }

  const APPS: [string, string][] = [
    ['Uber', 'UBER'],
    ['99', '99'],
    ['inDrive', 'INDRIVE'],
    ['Outro', 'OUTRO'],
  ];
  for (const [label, wire] of APPS) {
    it(`ganho no app «${label}» sai como ${wire}, categoria RIDES`, () => {
      expect(launch('INCOME', label)).toMatchObject({ kind: 'INCOME', category: 'RIDES', app: wire });
    });
  }

  const SERVER_ONLY: [string, string][] = [
    ['FOOD', 'Alimentação'],
    ['FINE', 'Multa'],
    ['RENTAL_FEE', 'Aluguel'],
    ['OTHER_EXPENSE', 'Outros'],
    ['DELIVERIES', 'Entregas'],
    ['OTHER_INCOME', 'Outros ganhos'],
  ];
  for (const [wire, label] of SERVER_ONLY) {
    it(`categoria do servidor ${wire} aparece como «${label}»`, () => {
      expect(expenseLabel(wire)).toBe(label);
    });
  }
});
