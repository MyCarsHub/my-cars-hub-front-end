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
  host: { class: 'block min-w-0 h-full' },
  template: `
    <app-page-card [title]="title()" [fill]="true" [truncateTitle]="!reserveTitle()" [reserveTitleLines]="reserveTitle()">
      @if (subtitle()) {
        <p data-subtitle class="px-4 sm:px-6 -mt-1 pb-3 text-xs text-fg-muted">{{ subtitle() }}</p>
      }
      <div
        class="px-4 sm:px-6 pb-5 flex min-w-0 flex-1"
        [class.flex-row]="layout() === 'ring'"
        [class.items-center]="layout() === 'ring'"
        [class.gap-5]="layout() === 'ring'"
        [class.flex-col]="layout() === 'bar'"
        [class.gap-4]="layout() === 'bar'"
      >
        @if (layout() === 'ring') {
          <div
            data-ring
            role="img"
            class="ring-in relative size-28 sm:size-32 shrink-0 rounded-full"
            [attr.aria-label]="title() + ': ' + summary()"
            [style.background]="gradient()"
          >
            <div
              class="absolute inset-[22%] rounded-full bg-surface flex flex-col items-center justify-center text-center"
            >
              <span class="text-lg font-semibold text-fg tabular-nums leading-none">{{
                totalText()
              }}</span>
              <span class="text-[10px] text-fg-muted mt-0.5">{{ totalLabel() }}</span>
            </div>
          </div>
        } @else {
          <div
            data-split-bar
            role="img"
            class="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
            [attr.aria-label]="title() + ': ' + summary()"
          >
            @for (row of rows(); track row.label) {
              @if (row.value > 0) {
                <span [style.flex-grow]="row.value" [style.background-color]="row.color"></span>
              }
            }
          </div>
        }
        <ul class="w-full min-w-0 space-y-1.5 sm:space-y-2.5" aria-label="Legenda">
          @for (row of rows(); track row.label) {
            <li data-legend-row class="flex items-center justify-between gap-3 text-sm min-w-0">
              <span class="inline-flex items-center gap-2 min-w-0 text-fg-body">
                <span
                  class="size-3 rounded-[4px] shrink-0"
                  aria-hidden="true"
                  [style.background-color]="row.color"
                ></span>
                <span class="min-w-0 break-words">{{ row.label }}</span>
              </span>
              <span class="shrink-0 tabular-nums text-fg inline-flex items-baseline gap-3">
                <span class="text-xs text-fg-muted">{{ row.pct }}%</span>
                <b class="font-semibold min-w-6 text-right">{{ row.text }}</b>
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
  /** `ring`: donut + list (statuses). `bar`: one stacked bar + list (where the money goes). */
  readonly layout = input<'ring' | 'bar'>('ring');
  /** One line under the title (e.g. the plan capacity). */
  readonly subtitle = input<string | null>(null);
  /** Wrap the title on up to two lines and reserve both (cards side by side stay aligned). */
  readonly reserveTitle = input(false);
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
