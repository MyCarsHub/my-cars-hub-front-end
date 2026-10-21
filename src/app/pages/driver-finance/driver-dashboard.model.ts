import {
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
  goalTargets,
  integer,
  monthEnd,
  monthStart,
  mondayOf,
  percent,
  plural,
  rentPerDay,
  totals,
  weekdayOf,
} from './driver-finance.calc';
import {
  DriverGoals,
  DriverRentalContext,
  LedgerItem,
  RideApp,
} from './driver-finance.types';

/*
 * The Dashboard's view models, as pure functions of (ledger, goals, rental, today). The
 * numbers follow the owner's prototype (`Motorista Dashboard.dc.html`) rule for rule; only
 * the inputs changed — real entries and charges instead of generated data.
 */

export interface DashboardInput {
  items: readonly LedgerItem[];
  goals: DriverGoals | null;
  rental: DriverRentalContext | null;
  today: string;
}

function rentDay(rental: DriverRentalContext | null): number {
  return rental ? rentPerDay(rental.periodAmount, rental.periodDays) : 0;
}

// ---------------------------------------------------------------- hero

export function heroModel({ items, goals, rental, today }: DashboardInput) {
  const td = totals(items, today, today, today);
  const rent = rentDay(rental);
  const net = td.gross - td.expenses - rent;
  const pct = goals ? percent(td.gross, goals.dailyGoal) : null;
  const parts = [`Ganhou ${brl(td.gross)}`, `gastou ${brl(td.expenses)}`];
  if (rental) parts.push(`aluguel do dia ${brl(rent)}`);
  return {
    net: brl(net),
    line: parts.join(' · '),
    pct,
    deg: pct === null ? 0 : Math.round(pct * 3.6),
    aria: goals && pct !== null ? `${pct}% da meta diária de ${brl0(goals.dailyGoal)}` : '',
    stats: [
      { value: integer(td.rides), label: 'corridas' },
      { value: `${integer(td.km)} km`, label: 'rodados' },
      { value: `${decimal(td.hours)} h`, label: 'online' },
      { value: td.rides ? brl(td.gross / td.rides) : '—', label: 'por corrida' },
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

export function weekModel({ items, goals, today }: DashboardInput) {
  const start = mondayOf(today);
  const days = byDay(items);
  const target = goals?.dailyGoal ?? 0;
  const list = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(start, i);
    const future = date > today;
    const gross = future ? 0 : (days.get(date)?.income ?? 0);
    return { date, future, gross, isToday: date === today };
  });
  const max = Math.max(target * 1.25, ...list.map((d) => d.gross), 1);
  const usable = WEEK_CHART_HEIGHT - LABEL_SPACE;
  const wk = totals(items, start, today, today);
  const weekGoal = goals ? goalTargets(goals.dailyGoal, goals.workDaysPerWeek).week : 0;
  let text = `${brl(wk.gross)} na semana até agora.`;
  if (weekGoal) {
    const left = Math.max(0, weekGoal - wk.gross);
    const remaining = list.filter((d) => d.future && weekdayOf(d.date) !== 0).length;
    text =
      left === 0
        ? `Meta da semana batida: ${brl(wk.gross)} de ${brl(weekGoal)}.`
        : `${brl(wk.gross)} de ${brl(weekGoal)} na semana. Faltam ${brl(left)}` +
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

export function coverModel({ items, rental, today }: DashboardInput) {
  if (!rental || !rental.periodAmount) return null;
  const nextDue = rental.nextCharge?.dueDate ?? null;
  const lastPast = [...rental.charges].reverse().find((c) => c.dueDate <= today)?.dueDate ?? null;
  const lastDue = lastPast ?? (nextDue ? addDays(nextDue, -rental.periodDays) : null);
  if (!lastDue) return null;
  const since = totals(items, addDays(lastDue, 1), today, today);
  const earned = Math.max(0, since.gross - since.expenses);
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

function delta(current: number, previous: number) {
  if (!previous) return { text: 'sem período anterior', good: null as boolean | null };
  const p = Math.round((current / previous - 1) * 100);
  return { text: `${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs anterior`, good: p >= 0 };
}

export function periodModel(input: DashboardInput, from: string, to: string) {
  const { items, rental, today } = input;
  const cur = totals(items, from, to, today);
  const len = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -len);
  const prev = totals(items, prevFrom, addDays(prevFrom, Math.max(0, cur.days - 1)), today);
  const rentCur = cur.days * rentDay(rental);
  const rentPrev = prev.days * rentDay(rental);
  const empty = cur.gross === 0 && cur.expenses === 0;

  const avgRun = (t: typeof cur) => (t.rides ? t.gross / t.rides : 0);
  const perHour = (t: typeof cur) => (t.hours ? t.gross / t.hours : 0);
  const perKm = (t: typeof cur) => (t.km ? t.gross / t.km : 0);
  const profitKm = (t: typeof cur, rent: number) => (t.km ? (t.gross - t.expenses - rent) / t.km : 0);
  const tile = (label: string, v: number, pv: number, hint: string, accent = false) => ({
    label,
    value: v ? brl(v) : '—',
    hint,
    accent,
    delta: delta(v, pv),
  });
  const tiles = [
    tile('Média por corrida', avgRun(cur), avgRun(prev), 'quanto cada corrida rende em média', true),
    tile('Ganho por hora', perHour(cur), perHour(prev), 'só as horas online'),
    tile('Ganho por km', perKm(cur), perKm(prev), 'antes das despesas'),
    tile('Lucro por km', profitKm(cur, rentCur), profitKm(prev, rentPrev), 'depois de despesas e aluguel'),
  ];

  const net = cur.gross - cur.expenses - rentCur;
  const base = Math.max(cur.gross, cur.expenses + rentCur, 1);
  const per100 = (v: number) => (cur.gross ? `R$ ${Math.round((v / cur.gross) * 100)}` : '—');
  const splitRows = [
    { key: 'net', label: 'Sobrou', per100: per100(Math.max(0, net)), value: brl(net), width: (Math.max(0, net) / base) * 100 },
    { key: 'exp', label: 'Despesas', per100: per100(cur.expenses), value: brl(cur.expenses), width: (cur.expenses / base) * 100 },
  ];
  if (rental) {
    splitRows.push({ key: 'rent', label: 'Aluguel', per100: per100(rentCur), value: brl(rentCur), width: (rentCur / base) * 100 });
  }
  const split = {
    net: brl(net),
    positive: net >= 0,
    gross: brl(cur.gross),
    rows: splitRows,
    aria:
      `De ${brl(cur.gross)} ganhos: despesas ${brl(cur.expenses)}` +
      (rental ? `, aluguel ${brl(rentCur)}` : '') +
      `, sobrou ${brl(net)}.`,
  };

  // Best weekdays — average of the days actually worked.
  const days = byDay(items);
  const sum = [0, 0, 0, 0, 0, 0, 0];
  const count = [0, 0, 0, 0, 0, 0, 0];
  let workedDays = 0;
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    const income = days.get(d)?.income ?? 0;
    if (income > 0) {
      sum[weekdayOf(d)] += income;
      count[weekdayOf(d)]++;
      workedDays++;
    }
  }
  const avg = sum.map((v, i) => (count[i] ? v / count[i] : 0));
  const maxAvg = Math.max(1, ...avg);
  const best = avg.indexOf(Math.max(...avg));
  const workedAvg = workedDays ? cur.gross / workedDays : 0;
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((i) => ({
    label: WEEKDAY_SHORT[i],
    value: avg[i] ? brlShort(avg[i]) : '—',
    height: Math.round((avg[i] / maxAvg) * 90),
    best: i === best && avg[i] > 0,
  }));
  const insight =
    avg[best] && workedAvg && workedDays >= 2
      ? `Nas ${WEEKDAY_PLURAL[best]} você ganha em média ${brl(avg[best])}, ${Math.round(
          (avg[best] / workedAvg - 1) * 100,
        )}% acima da sua média de ${brl(workedAvg)} por dia trabalhado.`
      : 'Ainda não há dias suficientes neste período.';

  // Average per ride of each app — only entries that carry the number of rides.
  const perApp = RIDE_APPS.map((app) => {
    const rows = items.filter(
      (i) => i.type === 'INCOME' && i.app === app && (i.rides ?? 0) > 0 && i.date >= from && i.date <= to,
    );
    const gross = rows.reduce((t, i) => t + i.amount, 0);
    const rides = rows.reduce((t, i) => t + (i.rides ?? 0), 0);
    return { app, gross, rides, avg: rides ? gross / rides : 0 };
  }).filter((x) => x.rides > 0);
  const maxApp = Math.max(1, ...perApp.map((x) => x.avg));
  const byApp = perApp.map((x) => ({
    app: x.app as RideApp,
    label: appLabel(x.app),
    value: brl(x.avg),
    width: Math.round((x.avg / maxApp) * 100),
    note: `${plural(x.rides, 'corrida', 'corridas')} · ${brl(x.gross)}`,
  }));

  return { empty, tiles, split, weekdays, insight, byApp, range: `${ddmmyyyy(from)} — ${ddmmyyyy(to)}` };
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

export function calendarModel(input: DashboardInput, month: string) {
  const { items, rental, today } = input;
  const first = monthStart(month);
  const last = monthEnd(month);
  const days = byDay(items);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < weekdayOf(first); i++) {
    cells.push({ date: null, day: 0, income: 0, out: 0, due: false, count: 0, isToday: false });
  }
  let totalIn = 0;
  let totalOut = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const entry = days.get(d);
    const dayItems = items.filter((i) => i.date === d);
    const income = entry?.income ?? 0;
    let out = entry?.expense ?? 0;
    let due = false;
    let count = dayItems.length;
    for (const c of rental?.charges ?? []) {
      if (c.dueDate !== d) continue;
      out += c.amount;
      count++;
      if (!c.paid && d >= today) due = true;
    }
    totalIn += income;
    totalOut += out;
    cells.push({ date: d, day: Number(d.slice(8, 10)), income, out, due, count, isToday: d === today });
  }
  return { cells, totalIn, totalOut, balance: totalIn - totalOut };
}

export interface DayEvent {
  kind: string;
  label: string;
  value: string;
  tone: 'in' | 'out' | 'due';
  item: LedgerItem | null;
}

export function dayModel(input: DashboardInput, date: string) {
  const { items, rental, today } = input;
  const events: DayEvent[] = [];
  let income = 0;
  let out = 0;
  for (const item of items.filter((i) => i.date === date)) {
    if (item.type === 'INCOME') {
      income += item.amount;
      const parts = [
        item.rides ? plural(item.rides, 'corrida', 'corridas') : null,
        item.km ? `${integer(item.km)} km` : null,
        item.hours ? `${decimal(item.hours)} h online` : null,
      ].filter(Boolean);
      events.push({
        kind: `Ganho ${appLabel(item.app)}`,
        label: parts.join(' · ') || item.notes || 'Ganho lançado',
        value: `+ ${brl(item.amount)}`,
        tone: 'in',
        item,
      });
    } else {
      out += item.amount;
      events.push({
        kind: 'Despesa',
        label: expenseLabel(item.category),
        value: `- ${brl(item.amount)}`,
        tone: 'out',
        item,
      });
    }
  }
  for (const c of rental?.charges ?? []) {
    if (c.dueDate !== date) continue;
    out += c.amount;
    const pending = !c.paid && date >= today;
    events.push({
      kind: c.paid ? 'Aluguel pago' : pending ? 'Cobrança a vencer' : 'Cobrança em aberto',
      label: `Aluguel · ${rental?.vehicleLabel ?? ''}`.trim(),
      value: `- ${brl(c.amount)}`,
      tone: pending ? 'due' : 'out',
      item: null,
    });
  }
  return {
    title: `${WEEKDAY_LONG[weekdayOf(date)]}, ${ddmmyyyy(date)}`,
    income: brl(income),
    out: brl(out),
    events,
  };
}

// ---------------------------------------------------------------- goals + car

export function goalsModel({ items, goals, today }: DashboardInput) {
  if (!goals) return null;
  const t = goalTargets(goals.dailyGoal, goals.workDaysPerWeek);
  const row = (label: string, got: number, goal: number) => {
    const pct = percent(got, goal);
    return { label, value: `${brl0(got)} de ${brl0(goal)}`, pct, hit: pct >= 100 };
  };
  return [
    row('Semana', totals(items, mondayOf(today), today, today).gross, t.week),
    row('Mês', totals(items, monthStart(today), today, today).gross, t.month),
  ];
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
