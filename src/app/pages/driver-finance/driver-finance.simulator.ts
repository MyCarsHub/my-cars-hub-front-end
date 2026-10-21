import {
  RIDE_APPS,
  addDays,
  addMonths,
  daysBetween,
  goalTargets,
  minIso,
  monthEnd,
  monthStart,
  mondayOf,
  rentPerDay,
  totals,
  weekdayOf,
} from './driver-finance.calc';
import {
  DriverCalendarData,
  DriverDashboardData,
  DriverEfficiency,
  DriverGoals,
  DriverGoalsState,
  DriverRentalContext,
  GoalProgress,
  LedgerItem,
} from './driver-finance.types';

/*
 * An in-memory stand-in for the server's aggregates (`/driver/goals`, `/driver/dashboard`,
 * `/driver/calendar`), following the contract of feat/driver-finance-api rule for rule.
 *
 * ONLY the `/dev/driver` demo and the specs use it — production reads the real numbers.
 * Nothing in the screens imports it, so it never reaches the production bundle.
 */

function progress(items: readonly LedgerItem[], from: string, to: string, today: string, goal: number): GoalProgress {
  const income = totals(items, from, to, today).gross;
  return {
    from,
    to,
    incomeCents: income,
    goalCents: goal,
    percent: goal ? Math.round((income / goal) * 100) : 0,
    reached: goal > 0 && income >= goal,
  };
}

export function simulateGoals(
  items: readonly LedgerItem[],
  goal: DriverGoals | null,
  today: string,
): DriverGoalsState {
  const t = goal ? goalTargets(goal.dailyGoal, goal.workDaysPerWeek) : { day: 0, week: 0, month: 0 };
  const monday = mondayOf(today);
  return {
    goal,
    today: progress(items, today, today, today, t.day),
    week: progress(items, monday, addDays(monday, 6), today, t.week),
    month: progress(items, monthStart(today), monthEnd(today), today, t.month),
    weekDays: [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const date = addDays(monday, i);
      const income = date > today ? 0 : totals(items, date, date, today).gross;
      return { date, incomeCents: income, goalCents: t.day, reached: t.day > 0 && income >= t.day };
    }),
    lastWeeks: [4, 3, 2, 1].map((n) => {
      const from = addDays(monday, -7 * n);
      return progress(items, from, addDays(from, 6), today, t.week);
    }),
  };
}

function rentAccrued(rental: DriverRentalContext | null, from: string, to: string, today: string): number {
  if (!rental) return 0;
  const first = rental.startDate && rental.startDate > from ? rental.startDate : from;
  const last = minIso(to, today);
  if (last < first) return 0;
  return Math.round((daysBetween(first, last) + 1) * rentPerDay(rental.periodAmount, rental.periodDays));
}

/** RENTAL_FEE costs typed by the driver inside `from..to`. */
function rentalFees(items: readonly LedgerItem[], from: string, to: string): number {
  return items
    .filter((i) => i.type === 'EXPENSE' && i.category === 'RENTAL_FEE' && i.date >= from && i.date <= to)
    .reduce((s, i) => s + i.amount, 0);
}

/** The server's rent rule (faebbb59): max(estimate, typed RENTAL_FEE), never the sum. */
function effectiveRent(items: readonly LedgerItem[], rental: DriverRentalContext | null, from: string, to: string, today: string): number {
  return Math.max(rentAccrued(rental, from, to, today), rentalFees(items, from, to));
}

/** `rent` is the effective rent; the typed RENTAL_FEE leaves the costs so it counts once. */
function efficiency(items: readonly LedgerItem[], from: string, to: string, today: string, rent: number): DriverEfficiency {
  const t = totals(items, from, to, today);
  const fees = rentalFees(items, from, to);
  const income = items.filter((i) => i.type === 'INCOME' && i.date >= from && i.date <= to);
  const withRides = income.filter((i) => (i.rides ?? 0) > 0);
  const withHours = income.filter((i) => (i.hours ?? 0) > 0);
  const withKm = income.filter((i) => (i.km ?? 0) > 0);
  const sum = (list: LedgerItem[]) => list.reduce((s, i) => s + i.amount, 0);
  return {
    rides: t.rides,
    hours: t.hours,
    km: t.km,
    avgPerRideCents: t.rides ? Math.round(sum(withRides) / t.rides) : null,
    perHourCents: t.hours ? Math.round(sum(withHours) / t.hours) : null,
    perKmCents: t.km ? Math.round(sum(withKm) / t.km) : null,
    profitPerKmCents: t.km ? Math.round((t.gross - (t.expenses - fees) - rent) / t.km) : null,
  };
}

/**
 * The server's `previousWindow`: a whole calendar month is compared with the previous
 * calendar month; any other window with the same number of days right before it.
 */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  if (from === monthStart(from) && to === monthEnd(from)) {
    const start = addMonths(from, -1);
    return { from: start, to: monthEnd(start) };
  }
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

export function simulateDashboard(
  items: readonly LedgerItem[],
  from: string,
  to: string,
  today: string,
  rental: DriverRentalContext | null,
  goal: DriverGoals | null,
): DriverDashboardData {
  const cur = totals(items, from, to, today);
  const { from: prevFrom, to: prevTo } = previousWindow(from, to);
  const rent = effectiveRent(items, rental, from, to, today);
  const fees = rentalFees(items, from, to);
  const td = totals(items, today, today, today);
  const rentToday = effectiveRent(items, rental, today, today, today);
  const todayOther = totals(items, today, today, today).expenses - rentalFees(items, today, today);
  const inWindow = items.filter((i) => i.date >= from && i.date <= to);

  const byCategory = new Map<string, { totalCents: number; entryCount: number }>();
  for (const i of inWindow.filter((x) => x.type === 'EXPENSE')) {
    const c = byCategory.get(i.category) ?? { totalCents: 0, entryCount: 0 };
    c.totalCents += i.amount;
    c.entryCount++;
    byCategory.set(i.category, c);
  }

  const apps = [...RIDE_APPS, null].map((app) => {
    const rows = inWindow.filter((i) => i.type === 'INCOME' && i.app === app);
    const rides = rows.reduce((s, i) => s + (i.rides ?? 0), 0);
    const withRides = rows.filter((i) => (i.rides ?? 0) > 0).reduce((s, i) => s + i.amount, 0);
    return {
      app,
      totalCents: rows.reduce((s, i) => s + i.amount, 0),
      rides,
      entryCount: rows.length,
      avgPerRideCents: rides ? Math.round(withRides / rides) : null,
    };
  });

  const sums = [0, 0, 0, 0, 0, 0, 0, 0];
  const worked = [0, 0, 0, 0, 0, 0, 0, 0];
  let workedDays = 0;
  for (let d = from; d <= minIso(to, today); d = addDays(d, 1)) {
    const income = totals(items, d, d, today).gross;
    if (income <= 0) continue;
    const iso = weekdayOf(d) === 0 ? 7 : weekdayOf(d);
    sums[iso] += income;
    worked[iso]++;
    workedDays++;
  }
  const days = [1, 2, 3, 4, 5, 6, 7].map((isoDay) => ({
    isoDay,
    avgIncomeCents: worked[isoDay] ? Math.round(sums[isoDay] / worked[isoDay]) : 0,
    workedDays: worked[isoDay],
  }));
  const best = days.reduce((b, d) => (d.avgIncomeCents > (b?.avgIncomeCents ?? 0) ? d : b), null as (typeof days)[0] | null);

  const odometers = inWindow.map((i) => i.odometerKm ?? 0).filter((k) => k > 0);
  const span = odometers.length > 1 ? Math.max(...odometers) - Math.min(...odometers) : null;
  const lastOdo = items
    .filter((i) => i.type === 'EXPENSE' && i.odometerKm)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.odometerKm ?? null;

  return {
    from,
    to,
    totals: {
      incomeCents: cur.gross,
      expenseCents: cur.expenses,
      netCents: cur.gross - cur.expenses,
      entryCount: inWindow.length,
    },
    expenseByCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
    today: {
      date: today,
      incomeCents: td.gross,
      expenseCents: todayOther,
      rentAccruedCents: rentToday,
      profitCents: td.gross - todayOther - rentToday,
      rides: td.rides,
      hours: td.hours,
      km: td.km,
      avgPerRideCents: td.rides ? Math.round(td.gross / td.rides) : null,
    },
    goals: simulateGoals(items, goal, today),
    efficiency: efficiency(items, from, to, today, rent),
    previousEfficiency: efficiency(items, prevFrom, prevTo, today, effectiveRent(items, rental, prevFrom, prevTo, today)),
    breakdown: {
      incomeCents: cur.gross,
      expenseCents: cur.expenses - fees,
      rentAccruedCents: rent,
      leftCents: cur.gross - (cur.expenses - fees) - rent,
    },
    incomeByApp: apps.filter((a) => a.entryCount > 0),
    weekdays: {
      days,
      bestIsoDay: best ? best.isoDay : null,
      avgPerWorkedDayCents: workedDays ? Math.round(cur.gross / workedDays) : 0,
    },
    expenseStats: {
      lastOdometerKm: lastOdo,
      odometerSpanKm: span,
      costPerKmCents: span ? Math.round(cur.expenses / span) : null,
    },
  };
}

export function simulateCalendar(
  items: readonly LedgerItem[],
  rental: DriverRentalContext | null,
  month: string,
): DriverCalendarData {
  const first = `${month}-01`;
  const last = monthEnd(first);
  const days: DriverCalendarData['days'] = [];
  const totalsOut = { incomeCents: 0, outflowCents: 0, dueCents: 0, balanceCents: 0 };
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const day = { date: d, incomeCents: 0, outflowCents: 0, dueCents: 0, items: [] as DriverCalendarData['days'][0]['items'] };
    for (const i of items.filter((x) => x.date === d)) {
      if (i.type === 'INCOME') day.incomeCents += i.amount;
      else day.outflowCents += i.amount;
      day.items.push({
        id: i.id,
        type: i.type === 'INCOME' ? 'LEDGER_INCOME' : 'LEDGER_EXPENSE',
        label: i.category,
        amountCents: i.amount,
        status: null,
      });
    }
    for (const c of rental?.charges ?? []) {
      if (c.dueDate !== d) continue;
      if (c.paid) day.outflowCents += c.amount;
      else day.dueCents += c.amount;
      day.items.push({
        id: `charge-${d}`,
        type: c.paid ? 'CHARGE_PAID' : 'CHARGE_DUE',
        label: 'RENT',
        amountCents: c.amount,
        status: c.paid ? 'PAID' : 'PENDING',
      });
    }
    if (day.items.length) {
      days.push(day);
      totalsOut.incomeCents += day.incomeCents;
      totalsOut.outflowCents += day.outflowCents;
      totalsOut.dueCents += day.dueCents;
    }
  }
  totalsOut.balanceCents = totalsOut.incomeCents - totalsOut.outflowCents - totalsOut.dueCents;
  return { month: first, totals: totalsOut, days, truncated: false };
}
