import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PageCard } from '../../core/page-card/page-card';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';

export interface RingSlice {
  readonly label: string;
  readonly value: number;
  /** Any CSS colour; callers pass a token (var(--color-...)) or a hex. */
  readonly color: string;
}

interface LegendRow extends RingSlice {
  readonly text: string;
  readonly pct: number;
}

/** Gap between slices, in degrees, so neighbours do not touch. */
const GAP_DEG = 3;

/**
 * Pure: the conic-gradient for a ring. Slices with value 0 are skipped; a single slice fills
 * the whole circle with no gap. Exported so the spec can assert the exact string.
 */
export function ringGradient(slices: readonly RingSlice[], gap: string): string {
  const live = slices.filter((s) => s.value > 0);
  const total = live.reduce((t, s) => t + s.value, 0);
  if (total <= 0) return `conic-gradient(${gap} 0deg 360deg)`;
  if (live.length === 1) return `conic-gradient(${live[0].color} 0deg 360deg)`;
  let acc = 0;
  const stops = live.map((s) => {
    const from = (acc / total) * 360;
    acc += s.value;
    const to = (acc / total) * 360;
    const end = to - GAP_DEG;
    return `${s.color} ${from.toFixed(1)}deg ${end.toFixed(1)}deg, ${gap} ${end.toFixed(1)}deg ${to.toFixed(1)}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

/**
 * Donut + legend card (rentals by status, vehicles by status, revenue by gateway...). The
 * legend carries value AND percent as text, so the ring is never the only carrier of the data.
 * Shell is `app-page-card`; the ring is a conic-gradient on a div (no canvas, no library).
 */
@Component({
  selector: 'app-ring-legend-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card [title]="title()">
      <div class="px-4 sm:px-6 pb-5 flex flex-col sm:flex-row items-center gap-5 min-w-0">
        <div
          data-ring
          role="img"
          class="relative size-28 shrink-0 rounded-full"
          [attr.aria-label]="title() + ': ' + summary()"
          [style.background]="gradient()"
        >
          <div
            class="absolute inset-[22%] rounded-full bg-surface flex flex-col items-center justify-center text-center"
          >
            <span class="text-base font-semibold text-fg tabular-nums leading-none">{{
              totalText()
            }}</span>
            <span class="text-[10px] text-fg-muted mt-0.5">{{ totalLabel() }}</span>
          </div>
        </div>
        <ul class="w-full min-w-0 space-y-1.5" aria-label="Legenda">
          @for (row of rows(); track row.label) {
            <li
              data-legend-row
              class="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2 text-sm min-w-0"
            >
              <span class="inline-flex items-center gap-2 min-w-0 text-fg-body">
                <span
                  class="size-2.5 rounded-[3px] shrink-0"
                  aria-hidden="true"
                  [style.background-color]="row.color"
                ></span>
                <span class="truncate">{{ row.label }}</span>
              </span>
              <span class="shrink-0 tabular-nums text-fg">
                <b class="font-semibold">{{ row.text }}</b>
                <span class="text-fg-muted ml-1.5">{{ row.pct }}%</span>
              </span>
            </li>
          } @empty {
            <li class="text-sm text-fg-subtle text-center py-4">Sem dados no período.</li>
          }
        </ul>
      </div>
    </app-page-card>
  `,
})
export class RingLegendCard {
  readonly title = input.required<string>();
  readonly slices = input.required<readonly RingSlice[]>();
  readonly valueFormat = input<KpiNumberFormat>('integer');
  /** Caption under the number in the middle of the ring. */
  readonly totalLabel = input('total');
  /** Colour of the gap between slices; should match the card surface. */
  readonly gapColor = input('var(--color-surface)');

  private readonly total = computed(() =>
    this.slices().reduce((t, s) => t + Math.max(0, s.value), 0),
  );

  protected readonly totalText = computed(() => formatKpiNumber(this.valueFormat(), this.total()));
  protected readonly gradient = computed(() => ringGradient(this.slices(), this.gapColor()));
  protected readonly rows = computed<LegendRow[]>(() => {
    const total = this.total();
    const fmt = this.valueFormat();
    return this.slices().map((s) => ({
      ...s,
      text: formatKpiNumber(fmt, s.value),
      pct: total > 0 ? Math.round((Math.max(0, s.value) / total) * 100) : 0,
    }));
  });
  protected readonly summary = computed(() =>
    this.rows()
      .map((r) => `${r.label} ${r.text} (${r.pct}%)`)
      .join(', '),
  );
}
