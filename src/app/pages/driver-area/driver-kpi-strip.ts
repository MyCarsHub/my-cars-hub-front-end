import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { KpiCard } from '../../components/kpi-card/kpi-card';
import { formatBRL, formatDate } from '../../types/dashboard.types';
import { DriverDashboard } from '../../types/driver-ledger.types';
import {
  comparePeriods,
  deltaCaption,
  elapsedDays,
  perDayCents,
} from '../../utils/driver-ledger';

/**
 * The driver's three numbers for a period: what came in, what went out, what is left —
 * each against the period before.
 *
 * Built only from the Dashboard's shared `KpiCard` and its existing variants: Ganhos in the
 * green one, Custos in the brand orange one, Resultado líquido in the plain white one. Two
 * columns on a phone with the result across both (the number a driver cares about most gets
 * the widest card), the same three side by side from `sm`.
 */
@Component({
  selector: 'app-driver-kpi-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KpiCard],
  template: `
    <section aria-label="Resumo do período" class="grid gap-3 grid-cols-2 sm:grid-cols-3">
      <div
        app-kpi-card
        data-kpi="income"
        variant="emerald"
        label="Ganhos"
        [loading]="showSkeleton()"
        [value]="income()"
        [detail]="incomeCaption()"
      ></div>
      <div
        app-kpi-card
        data-kpi="expense"
        variant="primary"
        label="Custos"
        [loading]="showSkeleton()"
        [value]="expense()"
        [detail]="expenseCaption()"
      ></div>
      <div
        app-kpi-card
        class="col-span-2 sm:col-span-1"
        data-kpi="net"
        variant="white"
        label="Resultado líquido"
        [loading]="showSkeleton()"
        [value]="net()"
        [detail]="netCaption()"
      ></div>
    </section>
    @if (comparisonLabel(); as label) {
      <p class="mt-2 text-xs text-neutral-600" data-comparison>{{ label }}</p>
    }
  `,
})
export class DriverKpiStrip {
  readonly dashboard = input<DriverDashboard | null>(null);
  readonly loading = input(false);
  /** `yyyy-MM-dd` of today in the business zone — the divisor of "por dia" needs it. */
  readonly today = input('');

  /** The skeleton is for the FIRST paint only: a refetch keeps the numbers on screen. */
  protected readonly showSkeleton = computed(() => this.loading() && this.dashboard() === null);

  /**
   * What "período anterior" IS, in dates, as the server computed it: a whole civil month
   * compares against the previous civil month (not "the 31 days before"), anything else
   * against the window right before, same length. Showing the dates removes the guess.
   */
  protected readonly comparisonLabel = computed(() => {
    const prev = this.dashboard()?.previousPeriod;
    if (!prev?.from || !prev.to) return null;
    return prev.from === prev.to
      ? `Comparado com ${formatDate(prev.from)}.`
      : `Comparado com ${formatDate(prev.from)} a ${formatDate(prev.to)}.`;
  });

  protected readonly income = computed(() => this.money(this.dashboard()?.totals.incomeCents));
  protected readonly expense = computed(() => this.money(this.dashboard()?.totals.expenseCents));
  protected readonly net = computed(() => this.money(this.dashboard()?.totals.netCents));

  protected readonly incomeCaption = computed(() => {
    const d = this.dashboard();
    if (!d) return null;
    return deltaCaption(comparePeriods(d.totals.incomeCents, d.previousPeriod.incomeCents), true);
  });

  protected readonly expenseCaption = computed(() => {
    const d = this.dashboard();
    if (!d) return null;
    return deltaCaption(comparePeriods(d.totals.expenseCents, d.previousPeriod.expenseCents), true);
  });

  /**
   * "R$ 150,00 por dia · ▲ +12,3% vs período anterior". The per-day figure divides by the
   * days that already happened (see `elapsedDays`), and is left out when the period has
   * not started or there is nothing to average.
   */
  protected readonly netCaption = computed(() => {
    const d = this.dashboard();
    if (!d) return null;
    const compare = deltaCaption(comparePeriods(d.totals.netCents, d.previousPeriod.netCents));
    const days = this.today() ? elapsedDays({ from: d.from, to: d.to }, this.today()) : null;
    const perDay = d.totals.entryCount > 0 ? perDayCents(d.totals.netCents, days) : null;
    return perDay === null ? compare : `${formatBRL(perDay)} por dia · ${compare}`;
  });

  private money(cents: number | undefined): string | null {
    return cents === undefined ? null : formatBRL(cents);
  }
}
