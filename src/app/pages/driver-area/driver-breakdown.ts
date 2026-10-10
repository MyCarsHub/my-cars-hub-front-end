import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PageCard } from '../../components/core/page-card/page-card';
import { formatBRL } from '../../types/dashboard.types';
import { DriverCategoryTotal } from '../../types/driver-ledger.types';
import { breakdownFor } from '../../utils/driver-ledger';

/**
 * Where the money came from and where it went, by category, as plain horizontal bars.
 *
 * No chart library: a bar is a `div` whose width is a percentage, and every number is also
 * TEXT in the row, so the bar itself is `aria-hidden` — a screen reader gets the same list
 * a sighted driver reads, with "Combustível R$ 480,00 (32%)". Income bars are green and
 * expense bars the brand orange, the same two the KPI cards use.
 */
@Component({
  selector: 'app-driver-breakdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  template: `
    <app-page-card title="Por categoria">
      <div class="px-4 pb-5 sm:px-6 space-y-6">
        <section aria-labelledby="driver-breakdown-income">
          <h3 id="driver-breakdown-income" class="text-sm font-semibold text-neutral-800">
            Ganhos
          </h3>
          @if (income().length === 0) {
            <p class="mt-2 text-sm text-neutral-600">Nenhum ganho no período.</p>
          } @else {
            <ul class="mt-3 space-y-3">
              @for (bar of income(); track bar.category) {
                <li data-bar-income>
                  <div class="flex items-baseline justify-between gap-3 text-sm">
                    <span class="font-medium text-neutral-800 truncate">{{ bar.label }}</span>
                    <span class="shrink-0 tabular-nums text-neutral-900">
                      {{ money(bar.totalCents) }}
                      <span class="text-xs text-neutral-600">({{ bar.sharePct }}%)</span>
                    </span>
                  </div>
                  <div class="mt-1.5 h-2 rounded-full bg-neutral-100" aria-hidden="true">
                    <div
                      class="h-2 rounded-full bg-emerald-600"
                      [style.width.%]="bar.widthPct"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <section aria-labelledby="driver-breakdown-expense">
          <h3 id="driver-breakdown-expense" class="text-sm font-semibold text-neutral-800">
            Custos
          </h3>
          @if (expense().length === 0) {
            <p class="mt-2 text-sm text-neutral-600">Nenhum custo no período.</p>
          } @else {
            <ul class="mt-3 space-y-3">
              @for (bar of expense(); track bar.category) {
                <li data-bar-expense>
                  <div class="flex items-baseline justify-between gap-3 text-sm">
                    <span class="font-medium text-neutral-800 truncate">{{ bar.label }}</span>
                    <span class="shrink-0 tabular-nums text-neutral-900">
                      {{ money(bar.totalCents) }}
                      <span class="text-xs text-neutral-600">({{ bar.sharePct }}%)</span>
                    </span>
                  </div>
                  <div class="mt-1.5 h-2 rounded-full bg-neutral-100" aria-hidden="true">
                    <div
                      class="h-2 rounded-full bg-primary-500"
                      [style.width.%]="bar.widthPct"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      </div>
    </app-page-card>
  `,
})
export class DriverBreakdown {
  readonly rows = input<readonly DriverCategoryTotal[]>([]);

  protected readonly income = computed(() => breakdownFor(this.rows(), 'INCOME'));
  protected readonly expense = computed(() => breakdownFor(this.rows(), 'EXPENSE'));

  protected money(cents: number): string {
    return formatBRL(cents);
  }
}
