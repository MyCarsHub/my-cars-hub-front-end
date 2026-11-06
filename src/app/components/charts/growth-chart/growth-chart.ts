import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';

export interface GrowthSeries {
  readonly key: string;
  readonly label: string;
  /** Any CSS colour. */
  readonly color: string;
  /** One value per x label. */
  readonly values: readonly number[];
  /** Reference series (previous period): thinner and dashed, never filled. */
  readonly reference?: boolean;
}

/** Same floor as the line chart: the axis never shrinks below this, so 3 users do not look like a mountain. */
export const GROWTH_AXIS_MIN_TOP = 5;

/** Pure: axis top for all series together (floor, or the real max). */
export function growthAxisTop(series: readonly GrowthSeries[], floor = GROWTH_AXIS_MIN_TOP): number {
  return Math.max(floor, 0, ...series.flatMap((s) => s.values));
}

/** Pure: true when no series has a value above zero (nothing to draw but the floor). */
export function growthIsEmpty(series: readonly GrowthSeries[]): boolean {
  return series.every((s) => s.values.every((v) => !(v > 0)));
}

/** Keeps a control point inside the axis so a sudden jump cannot draw the curve outside it. */
const clampY = (y: number): number => Math.min(100, Math.max(0, y));

/** Same, but never beyond the two neighbouring points: a spline may not overshoot the data. */
const clampBetween = (y: number, a: number, b: number): number =>
  Math.min(Math.max(a, b), Math.max(Math.min(a, b), y));

/**
 * Pure: smooth Catmull-Rom path through `values` in a 0-100 box (x spread evenly, y inverted
 * against `top`). Returns the SVG `d` for the line and for the closed area under it.
 */
export function smoothPath(
  values: readonly number[],
  top: number,
  slots: number = values.length,
): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const n = values.length;
  const span = Math.max(slots, n);
  // The axis starts at zero: a negative value sits on the floor instead of leaving the box.
  const pts = values.map((v, i) => [
    span === 1 ? 50 : (i / (span - 1)) * 100,
    clampY(100 - (Math.max(0, v) / top) * 100),
  ]);
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d +=
      ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${clampBetween(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1]).toFixed(2)}` +
      ` ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${clampBetween(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1]).toFixed(2)}` +
      ` ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  const lastX = pts[n - 1][0].toFixed(2);
  const firstX = pts[0][0].toFixed(2);
  return { line: d, area: `${d} L${lastX} 100 L${firstX} 100 Z` };
}

/**
 * Pure: straight segments through `values` (same 0-100 box as `smoothPath`). A cumulative total
 * is a staircase that only ever rises: a spline turns every step into an S-bend and the short
 * current-month curve into a blob, so those charts draw plain segments.
 */
export function linearPath(
  values: readonly number[],
  top: number,
  slots: number = values.length,
): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const n = values.length;
  const span = Math.max(slots, n);
  const pts = values.map((v, i) => [
    span === 1 ? 50 : (i / (span - 1)) * 100,
    clampY(100 - (Math.max(0, v) / top) * 100),
  ]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  return { line: d, area: `${d} L${pts[n - 1][0].toFixed(2)} 100 L${pts[0][0].toFixed(2)} 100 Z` };
}

/** Pure: where the last value of a series sits in the 0-100 box (for the end-point dot). */
export function endPoint(
  values: readonly number[],
  top: number,
  slots: number = values.length,
): { x: number; y: number } | null {
  if (values.length === 0) return null;
  const span = Math.max(slots, values.length);
  return {
    x: span === 1 ? 50 : ((values.length - 1) / (span - 1)) * 100,
    y: clampY(100 - (Math.max(0, values[values.length - 1]) / top) * 100),
  };
}

/** A labelled mark on the x axis: `index` is the position in `labels`. */
export interface GrowthXTick {
  readonly index: number;
  readonly text: string;
}

interface DrawnSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly reference: boolean;
  readonly line: string;
  readonly area: string;
  readonly end: { x: number; y: number } | null;
}

/**
 * Multi-series smooth area/line chart with legend. SVG in a 0-100 viewBox stretched with
 * `preserveAspectRatio="none"` and `vector-effect: non-scaling-stroke`, so lines keep a
 * constant weight at any width (375px to desktop). No library: this is the same curve the
 * design prototype draws, and it ships zero extra bytes. Axis rule is the line chart's (zero
 * floor, minimum top); the same series are repeated in a sr-only table, since an SVG path
 * carries no numbers. The plot is revealed left to right (`draw-in`, a clip-path) and the end dot fades in; under reduced motion both become a plain fade.
 */
@Component({
  selector: 'app-growth-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @if (legendTop() && series().length > 1) {
      <ul data-legend-top class="mb-3 flex flex-wrap justify-end gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda">
        @for (s of legendSeries(); track s.key) {
          <li class="inline-flex items-center gap-1.5">
            <span class="size-3 rounded-[3px] shrink-0" aria-hidden="true" [style.background-color]="s.color"></span>
            {{ s.label }}
          </li>
        }
      </ul>
    }
    <div class="flex gap-2 min-w-0">
      @if (!empty()) {
      <div
        data-y-axis
        class="flex flex-col justify-between text-right text-[10px] sm:text-[11px] text-fg-muted tabular-nums min-w-9 pb-5"
        aria-hidden="true"
      >
        @for (tick of yTicks(); track $index) {
          <span>{{ tick }}</span>
        }
      </div>
      }
      <div class="flex-1 min-w-0 flex flex-col">
        @if (empty()) {
          <div
            data-empty
            role="status"
            class="w-full flex items-center justify-center text-center text-sm text-fg-subtle px-4"
            [style.height.px]="heightPx()"
          >
            {{ emptyText() }}
          </div>
        } @else {
        <div class="relative">
        <svg
          data-plot
          class="draw-in w-full block overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          [style.height.px]="heightPx()"
        >
          <defs>
            @for (s of drawn(); track s.key) {
              @if (!s.reference && area()) {
                <linearGradient [attr.id]="gradientId(s.key)" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" [attr.stop-color]="s.color" stop-opacity="0.45" />
                  <stop offset="1" [attr.stop-color]="s.color" stop-opacity="0" />
                </linearGradient>
              }
            }
          </defs>
          @for (s of drawn(); track s.key) {
            @if (!s.reference && area()) {
              <path data-area [attr.d]="s.area" [attr.fill]="'url(#' + gradientId(s.key) + ')'" stroke="none" />
            }
            <path
              data-line
              [attr.d]="s.line"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
              [style.stroke]="s.color"
              [attr.stroke-width]="s.reference ? 1.25 : 2.5"
              [attr.stroke-dasharray]="s.reference ? '4 4' : null"
            />
          }
        </svg>
        @if (endDot()) {
          @for (s of drawn(); track s.key) {
            @if (!s.reference && s.end; as end) {
              <span
                data-end-dot
                class="fade-in absolute h-2.5 w-2.5 rounded-full border-2 border-white dark:border-surface -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
                style="animation-delay: 800ms"
                [style.left.%]="end.x"
                [style.top.%]="end.y"
                [style.background-color]="s.color"
              ></span>
            }
          }
        }
        @if (endTooltip() && tooltip(); as tip) {
          <div
            data-end-tooltip
            class="absolute hidden sm:block rounded-lg bg-surface-strong px-3 py-2 text-xs leading-snug shadow-lg pointer-events-none whitespace-nowrap"
            style="transform: translateX(-100%)"
            aria-hidden="true"
            [style.left.%]="tip.x"
            [style.top.%]="tip.y"
          >
            <p class="text-fg-muted">{{ tip.title }}</p>
            <p class="font-semibold text-fg">{{ tip.value }}</p>
            @if (tip.reference) {
              <p class="text-fg-muted">{{ tip.reference }}</p>
            }
          </div>
        }
        </div>
        }
        @if (!empty()) {
        @if (positionedTicks(); as ticks) {
          <div data-x-axis class="relative text-[11px] text-fg-muted h-5 pt-1" aria-hidden="true">
            @for (t of ticks; track t.index) {
              <span
                class="absolute whitespace-nowrap"
                [style.left.%]="t.left"
                [style.transform]="t.shift"
                >{{ t.text }}</span
              >
            }
          </div>
        } @else {
        <div data-x-axis class="flex justify-between text-[11px] text-fg-muted h-5 pt-1" aria-hidden="true">
          @for (label of xTicks(); track $index) {
            <span>{{ label }}</span>
          }
        </div>
        }
        }
      </div>
    </div>

    @if (series().length > 1 && !legendTop()) {
      <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda">
        @for (s of series(); track s.key) {
          <li class="inline-flex items-center gap-1.5">
            <span
              class="h-0.5 w-4 rounded-full shrink-0"
              aria-hidden="true"
              [style.background-color]="s.color"
            ></span>
            {{ s.label }}
          </li>
        }
      </ul>
    }

    <div class="sr-only">
    <table>
      <caption>
        {{ ariaLabel() }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Período</th>
          @for (s of series(); track s.key) {
            <th scope="col">{{ s.label }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (label of labels(); track $index; let i = $index) {
          <tr>
            <th scope="row">{{ label }}</th>
            @for (s of series(); track s.key) {
              <td>{{ text(s.values[i]) }}</td>
            }
          </tr>
        }
      </tbody>
    </table>
    </div>
  `,
})
export class GrowthChart {
  readonly series = input.required<readonly GrowthSeries[]>();
  /** X label per point (all series share them). */
  readonly labels = input.required<readonly string[]>();
  readonly ariaLabel = input.required<string>();
  readonly valueFormat = input<KpiNumberFormat>('integer');
  /** Fill under the non-reference series. */
  readonly area = input(true);
  readonly heightPx = input(160);
  /** Axis floor; money callers pass a larger one in the format's unit. */
  readonly axisFloor = input(GROWTH_AXIS_MIN_TOP);
  /** How many x labels to print (evenly picked), so 30 days stay legible at 375px. */
  readonly maxXTicks = input(6);
  /** Pin the axis top (same unit as the values); null keeps the "real max or floor" rule. */
  readonly axisTop = input<number | null>(null);
  /** Dot on the last value of each non-reference series. */
  readonly endDot = input(false);
  /** Explicit x marks (by index in `labels`), spread over the FULL label axis; overrides `maxXTicks`. */
  readonly xTickMarks = input<readonly GrowthXTick[] | null>(null);
  /** Legend above the plot, right-aligned, main series first (instead of under the plot). */
  readonly legendTop = input(false);
  /** Gaps between y ticks (4 = five ticks; 5 = six ticks, e.g. R$ 0 .. R$ 50k in tens). */
  readonly yDivisions = input(4);
  /** Static tooltip at the last point of the main series: label, value and the reference value. */
  readonly endTooltip = input(false);
  /** Prefix of the x label in the tooltip title (`dia ` + `30`). */
  readonly tooltipLabelPrefix = input('');
  /** `false`: straight segments (cumulative totals); `true` (default): smooth curve. */
  readonly smooth = input(true);
  /** Shown instead of the plot when every value is zero. */
  readonly emptyText = input('Ainda sem movimento neste período.');

  private static nextId = 0;
  private readonly uid = GrowthChart.nextId++;
  protected gradientId(key: string): string {
    return `growth-fill-${this.uid}-${key}`;
  }

  protected readonly legendSeries = computed(() =>
    [...this.series()].sort((a, b) => Number(!!a.reference) - Number(!!b.reference)),
  );

  protected readonly tooltip = computed(() => {
    const main = this.drawn().find((d) => !d.reference && d.end);
    const series = this.series();
    const src = series.find((x) => x.key === main?.key);
    if (!main?.end || !src) return null;
    const idx = src.values.length - 1;
    const ref = series.find((x) => x.reference);
    const refValue = ref?.values[idx];
    return {
      x: main.end.x,
      // below the point, like the prototype; kept inside the plot for points near the floor
      y: Math.min(main.end.y + 6, 62),
      title: `${this.tooltipLabelPrefix()}${this.labels()[idx] ?? ''}`,
      value: formatKpiNumber(this.valueFormat(), src.values[idx]),
      reference:
        ref && refValue !== undefined
          ? `${ref.label.toLowerCase()} ${formatKpiNumber(this.valueFormat(), refValue)}`
          : null,
    };
  });

  protected readonly empty = computed(() => growthIsEmpty(this.series()));

  protected readonly top = computed(() => {
    const pinned = this.axisTop();
    const real = growthAxisTop(this.series(), this.axisFloor());
    return pinned === null ? real : Math.max(pinned, real);
  });

  protected readonly positionedTicks = computed(() => {
    const marks = this.xTickMarks();
    if (!marks) return null;
    const last = Math.max(1, this.labels().length - 1);
    return marks.map((m) => ({
      index: m.index,
      text: m.text,
      left: (m.index / last) * 100,
      // Edge labels hang inward so they never leave the card.
      shift: m.index === 0 ? 'none' : m.index === last ? 'translateX(-100%)' : 'translateX(-50%)',
    }));
  });

  protected readonly drawn = computed<DrawnSeries[]>(() => {
    const top = this.top();
    const slots = this.labels().length;
    // Reference first so the main series paints over it.
    return [...this.series()]
      .sort((a, b) => Number(!!b.reference) - Number(!!a.reference))
      .map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        reference: !!s.reference,
        ...(this.smooth() ? smoothPath(s.values, top, slots) : linearPath(s.values, top, slots)),
        end: endPoint(s.values, top, slots),
      }));
  });

  protected readonly yTicks = computed(() => {
    const top = this.top();
    const n = Math.max(1, this.yDivisions());
    return Array.from({ length: n + 1 }, (_, i) => formatKpiNumber(this.valueFormat(), (top * (n - i)) / n));
  });

  protected readonly xTicks = computed(() => {
    const labels = this.labels();
    const max = Math.max(2, this.maxXTicks());
    if (labels.length <= max) return labels;
    const out: string[] = [];
    for (let i = 0; i < max; i++) out.push(labels[Math.round((i * (labels.length - 1)) / (max - 1))]);
    return out;
  });

  protected text(v: number | undefined): string {
    return v === undefined
      ? '—'
      // The axis may be compact (R$ 10k); the text table keeps the exact value.
      : formatKpiNumber(this.valueFormat() === 'brl-cents-compact' ? 'brl-cents' : this.valueFormat(), v);
  }
}
