import {
  RENT_EXPENSE_CATEGORY,
  RIDE_APPS,
  WEEKDAY_LONG,
  WEEKDAY_PLURAL,
  WEEKDAY_SHORT,
  addDays,
  appLabel,
  brl,
  brl0,
  brlShort,
  byDay,
  daysBetween,
  ddmm,
  ddmmyyyy,
  decimal,
  expenseLabel,
  integer,
  monthEnd,
  mondayOf,
  percent,
  plural,
  totals,
  weekdayOf,
} from './driver-finance.calc';
import {
  DriverCalendarData,
  DriverDashboardData,
  DriverEfficiency,
  DriverGoalsState,
  DriverRentalContext,
  LedgerItem,
  RideApp,
} from './driver-finance.types';

/*
 * The Dashboard's view models, as pure functions. The prototype's layout and copy
 * (`Motorista Dashboard.dc.html`), the SERVER's numbers: today, efficiency, breakdown,
 * weekdays, average per ride by app, goals and the calendar come from
 * `/v1/driver/dashboard`, `/v1/driver/goals` and `/v1/driver/calendar`. Only what the
 * server does not compute is derived here from the recent ledger: the rent coverage since
 * the last charge and the km of the week.
 */

export interface DashboardInput {
  /** The ledger of the last 31 days (rent coverage, km of the week, week fallback). */
  items: readonly LedgerItem[];
  goals: DriverGoalsState | null;
  rental: DriverRentalContext | null;
  today: string;
}

/** Rent the driver typed himself as a cost (`RENTAL_FEE`) inside `from..to`. */
export function rentFeesIn(items: readonly LedgerItem[], from: string, to: string): number {
  return items
    .filter(
      (i) =>
        i.type === 'EXPENSE' &&
        i.category === RENT_EXPENSE_CATEGORY &&
        i.date >= from &&
        i.date <= to,
    )
    .reduce((t, i) => t + i.amount, 0);
}

// ---------------------------------------------------------------- hero

export function heroModel(today: DriverDashboardData['today'], goals: DriverGoalsState | null) {
  const pct = goals?.goal ? Math.min(100, goals.today.percent) : null;
  const parts = [`Ganhou ${brl(today.incomeCents)}`, `gastou ${brl(today.expenseCents)}`];
  if (today.rentAccruedCents > 0) parts.push(`aluguel do dia ${brl(today.rentAccruedCents)}`);
  return {
    net: brl(today.profitCents),
    line: parts.join(' · '),
    pct,
    deg: pct === null ? 0 : Math.round(pct * 3.6),
    aria:
      goals?.goal && pct !== null
        ? `${goals.today.percent}% da meta diária de ${brl0(goals.goal.dailyGoal)}`
        : '',
    stats: [
      { value: integer(today.rides), label: 'corridas' },
      { value: `${integer(today.km)} km`, label: 'rodados' },
      { value: `${decimal(today.hours)} h`, label: 'online' },
      {
        value: today.avgPerRideCents !== null ? brl(today.avgPerRideCents) : '—',
        label: 'por corrida',
      },
    ],
  };
}

// ---------------------------------------------------------------- alerts

export interface DashboardAlert {
  key: string;
  tone: 'amber' | 'rose';
  label: string;
  value: string;
}

/** Only alerts the app can prove: the next charge and the CNH. Fines and inspections live
 *  on screens of their own and are not read here. */
export function alertsModel(
  rental: DriverRentalContext | null,
  licenseExpiry: string | null,
  today: string,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const next = rental?.nextCharge;
  if (next) {
    const days = daysBetween(today, next.dueDate);
    if (days >= 0 && days <= 7) {
      alerts.push({
        key: 'charge',
        tone: 'amber',
        label: days === 0 ? 'Cobrança vence hoje' : `Cobrança em ${plural(days, 'dia', 'dias')}`,
        value: `${brl(next.amount)} · ${ddmm(next.dueDate)}`,
      });
    }
  }
  if (licenseExpiry) {
    const days = daysBetween(today, licenseExpiry);
    if (days < 0) {
      alerts.push({ key: 'cnh', tone: 'rose', label: 'CNH vencida', value: `venceu em ${ddmm(licenseExpiry)}` });
    } else if (days <= 30) {
      alerts.push({ key: 'cnh', tone: 'amber', label: 'CNH a vencer (30d)', value: `vence em ${ddmm(licenseExpiry)}` });
    }
  }
  return alerts;
}

// ---------------------------------------------------------------- week

export const WEEK_CHART_HEIGHT = 120;
const LABEL_SPACE = 18;

/** «Minha semana»: the goals' `weekDays` when the server sent them, else the ledger. */
export function weekModel({ items, goals, today }: DashboardInput) {
  const start = mondayOf(today);
  const fromLedger = byDay(items);
  const target = goals?.goal?.dailyGoal ?? 0;
  const list = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(start, i);
    const future = date > today;
    const server = goals?.weekDays.find((d) => d.date === date);
    const gross = future ? 0 : (server?.incomeCents ?? fromLedger.get(date)?.income ?? 0);
    return { date, future, gross, isToday: date === today };
  });
  const max = Math.max(target * 1.25, ...list.map((d) => d.gross), 1);
  const usable = WEEK_CHART_HEIGHT - LABEL_SPACE;
  const weekGross = list.reduce((t, d) => t + d.gross, 0);
  const weekGoal = goals?.goal ? goals.week.goalCents : 0;
  let text = `${brl(weekGross)} na semana até agora.`;
  if (weekGoal) {
    const left = Math.max(0, weekGoal - weekGross);
    const remaining = list.filter((d) => d.future && weekdayOf(d.date) !== 0).length;
    text =
      left === 0
        ? `Meta da semana batida: ${brl(weekGross)} de ${brl(weekGoal)}.`
        : `${brl(weekGross)} de ${brl(weekGoal)} na semana. Faltam ${brl(left)}` +
          (remaining
            ? `: ${brl(left / (remaining + 1))} por dia contando hoje e os ${plural(remaining, 'dia', 'dias')} que restam.`
            : ' para a meta da semana.');
  }
  return {
    range: `${ddmm(start)} – ${ddmm(addDays(start, 6))}`,
    goalBottom: target ? Math.round((target / max) * usable) + LABEL_SPACE : null,
    goalLabel: target ? `Meta diária de ${brl0(target)}` : '',
    text,
    days: list.map((d) => ({
      date: d.date,
      future: d.future,
      label: WEEKDAY_SHORT[weekdayOf(d.date)],
      value: d.future ? '' : d.gross ? brlShort(d.gross) : '0',
      height: d.future ? 4 : Math.max(4, Math.round((d.gross / max) * usable)),
      tone: d.future ? 'future' : d.isToday ? 'today' : target && d.gross >= target ? 'hit' : 'base',
      isToday: d.isToday,
      aria: `${WEEKDAY_LONG[weekdayOf(d.date)]}, ${ddmm(d.date)}: ${brl(d.gross)}`,
    })),
  };
}

// ---------------------------------------------------------------- rent coverage

/** Not computed by the server: what came in since the last charge against the rent. */
export function coverModel({ items, rental, today }: DashboardInput) {
  if (!rental || !rental.periodAmount) return null;
  const nextDue = rental.nextCharge?.dueDate ?? null;
  const lastPast = [...rental.charges].reverse().find((c) => c.dueDate <= today)?.dueDate ?? null;
  const lastDue = lastPast ?? (nextDue ? addDays(nextDue, -rental.periodDays) : null);
  if (!lastDue) return null;
  const since = totals(items, addDays(lastDue, 1), today, today);
  // Paying the rent (a RENTAL_FEE cost) does not "un-cover" it.
  const fees = rentFeesIn(items, addDays(lastDue, 1), today);
  const earned = Math.max(0, since.gross - (since.expenses - fees));
  const pct = percent(earned, rental.periodAmount);
  const left = Math.max(0, rental.periodAmount - earned);
  const due = nextDue ?? addDays(lastDue, rental.periodDays);
  const daysToDue = Math.max(1, daysBetween(today, due));
  return {
    title: rental.periodDays === 7 ? 'Aluguel da semana' : 'Aluguel do período',
    pct,
    tone: pct >= 100 ? 'done' : pct >= 60 ? 'mid' : 'low',
    sub: `${brl(earned)} de ${brl(rental.periodAmount)}`,
    text:
      left === 0
        ? 'Aluguel coberto. O que entrar daqui para frente é seu.'
        : `Faltam ${brl(left)} para cobrir a cobrança de ${ddmm(due)}. Separe cerca de ${brl(
            left / daysToDue,
          )} por dia nos próximos ${plural(daysToDue, 'dia', 'dias')}.`,
    next: rental.nextCharge
      ? `${brl(rental.nextCharge.amount)} · ${WEEKDAY_LONG[weekdayOf(rental.nextCharge.dueDate)]
          .split('-')[0]
          .toLowerCase()}, ${ddmm(rental.nextCharge.dueDate)}`
      : null,
  };
}

// ---------------------------------------------------------------- period numbers

function delta(current: number | null, previous: number | null) {
  if (!current || !previous) return { text: 'sem período anterior', good: null as boolean | null };
  const p = Math.round((current / previous - 1) * 100);
  return { text: `${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs anterior`, good: p >= 0 };
}

/** ISO weekday (1 = segunda … 7 = domingo) → index of `WEEKDAY_*` (0 = domingo). */
const isoToJs = (iso: number) => iso % 7;

/**
 * «Como estão seus números» from `/v1/driver/dashboard`.
 *
 * One correction on top of the server: when the driver typed the rent as a `RENTAL_FEE`
 * cost, the server's `breakdown` holds it in `expenseCents` AND accrues the estimated rent
 * in `rentAccruedCents`. The split shows the rent once — the larger of the two — and moves
 * the typed rent out of "Despesas".
 */
export function periodModel(dash: DriverDashboardData) {
  const eff = dash.efficiency;
  const prev: DriverEfficiency | null = dash.previousEfficiency;
  const tile = (
    label: string,
    v: number | null,
    pv: number | null,
    hint: string,
    accent = false,
  ) => ({ label, value: v !== null ? brl(v) : '—', hint, accent, delta: delta(v, pv) });
  const tiles = [
    tile('Média por corrida', eff.avgPerRideCents, prev?.avgPerRideCents ?? null, 'quanto cada corrida rende em média', true),
    tile('Ganho por hora', eff.perHourCents, prev?.perHourCents ?? null, 'só as horas online'),
    tile('Ganho por km', eff.perKmCents, prev?.perKmCents ?? null, 'antes das despesas'),
    tile('Lucro por km', eff.profitPerKmCents, prev?.profitPerKmCents ?? null, 'depois de despesas e aluguel'),
  ];

  const b = dash.breakdown;
  const fee =
    dash.expenseByCategory.find((c) => c.category === RENT_EXPENSE_CATEGORY)?.totalCents ?? 0;
  const otherExpenses = b.expenseCents - fee;
  const rent = Math.max(fee, b.rentAccruedCents);
  const net = b.incomeCents - otherExpenses - rent;
  const base = Math.max(b.incomeCents, otherExpenses + rent, 1);
  const per100 = (v: number) => (b.incomeCents ? `R$ ${Math.round((v / b.incomeCents) * 100)}` : '—');
  const rows = [
    { key: 'net', label: 'Sobrou', per100: per100(Math.max(0, net)), value: brl(net), width: (Math.max(0, net) / base) * 100 },
    { key: 'exp', label: 'Despesas', per100: per100(otherExpenses), value: brl(otherExpenses), width: (otherExpenses / base) * 100 },
  ];
  if (rent > 0) {
    rows.push({ key: 'rent', label: 'Aluguel', per100: per100(rent), value: brl(rent), width: (rent / base) * 100 });
  }
  const split = {
    net: brl(net),
    positive: net >= 0,
    gross: brl(b.incomeCents),
    rows,
    aria:
      `De ${brl(b.incomeCents)} ganhos: despesas ${brl(otherExpenses)}` +
      (rent > 0 ? `, aluguel ${brl(rent)}` : '') +
      `, sobrou ${brl(net)}.`,
  };

  const days = dash.weekdays.days;
  const maxAvg = Math.max(1, ...days.map((d) => d.avgIncomeCents));
  const best = dash.weekdays.bestIsoDay;
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((iso) => {
    const d = days.find((x) => x.isoDay === iso);
    const avg = d?.avgIncomeCents ?? 0;
    return {
      label: WEEKDAY_SHORT[isoToJs(iso)],
      value: avg ? brlShort(avg) : '—',
      height: Math.round((avg / maxAvg) * 90),
      best: iso === best && avg > 0,
    };
  });
  const bestAvg = days.find((d) => d.isoDay === best)?.avgIncomeCents ?? 0;
  const worked = days.reduce((t, d) => t + d.workedDays, 0);
  const perDay = dash.weekdays.avgPerWorkedDayCents;
  const insight =
    best !== null && bestAvg && perDay && worked >= 2
      ? `Nas ${WEEKDAY_PLURAL[isoToJs(best)]} você ganha em média ${brl(bestAvg)}, ${Math.round(
          (bestAvg / perDay - 1) * 100,
        )}% acima da sua média de ${brl(perDay)} por dia trabalhado.`
      : 'Ainda não há dias suficientes neste período.';

  const withRides = dash.incomeByApp.filter((a) => a.avgPerRideCents !== null && a.rides > 0);
  const maxApp = Math.max(1, ...withRides.map((a) => a.avgPerRideCents ?? 0));
  const order = (app: RideApp | null) => (app ? RIDE_APPS.indexOf(app) : RIDE_APPS.length);
  const byApp = [...withRides]
    .sort((x, y) => order(x.app) - order(y.app))
    .map((a) => ({
      app: a.app,
      label: appLabel(a.app),
      value: brl(a.avgPerRideCents ?? 0),
      width: Math.round(((a.avgPerRideCents ?? 0) / maxApp) * 100),
      note: `${plural(a.rides, 'corrida', 'corridas')} · ${brl(a.totalCents)}`,
    }));

  return {
    empty: dash.totals.entryCount === 0,
    tiles,
    split,
    weekdays,
    insight,
    byApp,
    range: `${ddmmyyyy(dash.from)} — ${ddmmyyyy(dash.to)}`,
  };
}

// ---------------------------------------------------------------- calendar

export interface CalendarCell {
  date: string | null;
  day: number;
  income: number;
  out: number;
  due: boolean;
  count: number;
  isToday: boolean;
}

/** The month grid from `/v1/driver/calendar` (which only lists days with movement). */
export function calendarModel(cal: DriverCalendarData | null, month: string, today: string) {
  const first = `${month.slice(0, 7)}-01`;
  const last = monthEnd(first);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < weekdayOf(first); i++) {
    cells.push({ date: null, day: 0, income: 0, out: 0, due: false, count: 0, isToday: false });
  }
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const day = cal?.days.find((x) => x.date === d);
    cells.push({
      date: d,
      day: Number(d.slice(8, 10)),
      income: day?.incomeCents ?? 0,
      out: (day?.outflowCents ?? 0) + (day?.dueCents ?? 0),
      due: (day?.dueCents ?? 0) > 0,
      count: day?.items.length ?? 0,
      isToday: d === today,
    });
  }
  const t = cal?.totals ?? { incomeCents: 0, outflowCents: 0, dueCents: 0, balanceCents: 0 };
  return {
    cells,
    totalIn: t.incomeCents,
    totalOut: t.outflowCents + t.dueCents,
    balance: t.balanceCents,
  };
}

export interface DayEvent {
  kind: string;
  label: string;
  value: string;
  tone: 'in' | 'out' | 'due';
  /** Ledger entry id: the row opens the edit popup. `null` for charges and fines. */
  ledgerId: string | null;
}

export function dayModel(cal: DriverCalendarData | null, date: string, rental: DriverRentalContext | null) {
  const day = cal?.days.find((d) => d.date === date);
  const events: DayEvent[] = (day?.items ?? []).map((item) => {
    switch (item.type) {
      case 'LEDGER_INCOME':
        return { kind: 'Ganho', label: expenseLabel(item.label), value: `+ ${brl(item.amountCents)}`, tone: 'in', ledgerId: item.id };
      case 'LEDGER_EXPENSE':
        return { kind: 'Despesa', label: expenseLabel(item.label), value: `- ${brl(item.amountCents)}`, tone: 'out', ledgerId: item.id };
      case 'CHARGE_PAID':
        return { kind: 'Aluguel pago', label: rentLabel(rental), value: `- ${brl(item.amountCents)}`, tone: 'out', ledgerId: null };
      case 'CHARGE_DUE':
        return {
          kind: item.status === 'PAST_DUE' ? 'Cobrança em atraso' : 'Cobrança a vencer',
          label: rentLabel(rental),
          value: `- ${brl(item.amountCents)}`,
          tone: 'due',
          ledgerId: null,
        };
      default:
        return { kind: 'Multa a vencer', label: item.label || 'Multa', value: `- ${brl(item.amountCents)}`, tone: 'due', ledgerId: null };
    }
  });
  return {
    title: `${WEEKDAY_LONG[weekdayOf(date)]}, ${ddmmyyyy(date)}`,
    income: brl(day?.incomeCents ?? 0),
    out: brl((day?.outflowCents ?? 0) + (day?.dueCents ?? 0)),
    events,
  };
}

function rentLabel(rental: DriverRentalContext | null): string {
  return rental ? `Aluguel · ${rental.vehicleLabel}` : 'Aluguel';
}

// ---------------------------------------------------------------- goals + car

export function goalsModel(goals: DriverGoalsState | null) {
  if (!goals?.goal) return null;
  const row = (label: string, p: DriverGoalsState['week']) => {
    const pct = Math.min(100, p.percent);
    return { label, value: `${brl0(p.incomeCents)} de ${brl0(p.goalCents)}`, pct, hit: p.reached };
  };
  return [row('Semana', goals.week), row('Mês', goals.month)];
}

export function carModel({ items, rental, today }: DashboardInput) {
  if (!rental) return null;
  const km = totals(items, mondayOf(today), today, today).km;
  const per = rental.periodDays === 7 ? 'por semana' : `a cada ${plural(rental.periodDays, 'dia', 'dias')}`;
  return {
    label: rental.vehicleLabel,
    plate: rental.plate,
    rent: rental.periodAmount ? `${brl(rental.periodAmount)} ${per}` : '',
    km: `${integer(km)} km`,
  };
}
