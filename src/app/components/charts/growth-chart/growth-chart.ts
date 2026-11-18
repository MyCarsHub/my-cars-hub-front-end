import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';
import {
  ChartTooltip,
  nearestPoint,
  pointerFraction,
  stepIndex,
  tooltipText,
  type ChartTooltipRow,
} from '../chart-tooltip/chart-tooltip';

export interface GrowthSeries {
  readonly key: string;
  readonly label: string;
  /** Any CSS colour. */
  readonly color: string;
  /**
   * One value per x label. `null` = not measured: the line breaks there (never drops to zero),
   * so a series that starts later, or has a hole, draws only where it has data.
   */
  readonly values: readonly (number | null)[];
  /** Reference series (previous period): thinner and dashed, never filled. */
  readonly reference?: boolean;
}

/** Same floor as the line chart: the axis never shrinks below this, so 3 users do not look like a mountain. */
export const GROWTH_AXIS_MIN_TOP = 5;

/** Pure: axis top for all series together (floor, or the real max). */
export function growthAxisTop(series: readonly GrowthSeries[], floor = GROWTH_AXIS_MIN_TOP): number {
  return Math.max(floor, 0, ...series.flatMap((s) => s.values).filter((v): v is number => v !== null));
}

const NICE_STEPS: readonly number[] = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Pure: the smallest axis top >= `max` whose `divisions` ticks are round numbers (steps of
 * 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 x 10^k). `integer` keeps every step a whole number, for counts.
 * Without it the ticks were fractions of the max ("R$ 869", "8" for 7.5 people).
 */
export function niceAxisTop(max: number, divisions: number, integer = false): number {
  if (!(max > 0) || divisions < 1) return max;
  const raw = max / divisions;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const f of NICE_STEPS) {
    const step = f * exp;
    if (integer && (step < 1 || !Number.isInteger(step))) continue;
    if (step >= raw - 1e-9) return step * divisions;
  }
  return Math.max(integer ? Math.ceil(raw) : raw, 1) * divisions;
}

/** Pure: true when no series has a value above zero (nothing to draw but the floor). */
export function growthIsEmpty(series: readonly GrowthSeries[]): boolean {
  return series.every((s) => s.values.every((v) => v === null || !(v > 0)));
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
  offset = 0,
): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const n = values.length;
  const span = Math.max(slots, n + offset);
  // The axis starts at zero: a negative value sits on the floor instead of leaving the box.
  const pts = values.map((v, i) => [
    span === 1 ? 50 : ((i + offset) / (span - 1)) * 100,
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
  offset = 0,
): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const n = values.length;
  const span = Math.max(slots, n + offset);
  const pts = values.map((v, i) => [
    span === 1 ? 50 : ((i + offset) / (span - 1)) * 100,
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
  offset = 0,
): { x: number; y: number } | null {
  if (values.length === 0) return null;
  const span = Math.max(slots, values.length + offset);
  return {
    x: span === 1 ? 50 : ((values.length - 1 + offset) / (span - 1)) * 100,
    y: clampY(100 - (Math.max(0, values[values.length - 1]) / top) * 100),
  };
}

/** Pure: the unbroken stretches of measured values, each with the index it starts at. */
export function measuredRuns(values: readonly (number | null)[]): { offset: number; values: number[] }[] {
  const runs: { offset: number; values: number[] }[] = [];
  let current: { offset: number; values: number[] } | null = null;
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      current = null;
      return;
    }
    if (!current) {
      current = { offset: i, values: [] };
      runs.push(current);
    }
    current.values.push(v);
  });
  return runs;
}

/** Pure: index of the last measured value, or -1. */
export function lastMeasured(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined) return i;
  return -1;
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
 *
 * Reading a point (owner, 18/11: "passo o mouse e não vejo os dados"): the plot is one control.
 * Mouse hover, a tap or a horizontal drag picks the nearest x; the keyboard moves with the arrows
 * (Home/End jump, Esc closes). The tooltip says every series at that x in FULL (money with cents,
 * even when the axis is compact); a `null` point reads "sem dado" and gets no marker. Phones get
 * the same tooltip on tap; vertical scrolling still works (`touch-action: pan-y`).
 */
@Component({
  selector: 'app-growth-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartTooltip],
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
        <div
          data-plot-control
          class="relative rounded-lg touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          [attr.tabindex]="interactive() ? 0 : null"
          [attr.role]="interactive() ? 'slider' : null"
          [attr.aria-label]="interactive() ? ariaLabel() : null"
          [attr.aria-valuemin]="interactive() ? 1 : null"
          [attr.aria-valuemax]="interactive() ? labels().length : null"
          [attr.aria-valuenow]="interactive() ? (activeIndex() ?? lastIndex()) + 1 : null"
          [attr.aria-valuetext]="interactive() ? valueText(activeIndex() ?? lastIndex()) : null"
          (pointermove)="onPointer($event)"
          (pointerdown)="onPointer($event)"
          (pointerleave)="onPointerLeave($event)"
          (keydown)="onKey($event)"
          (focus)="onFocus()"
          (blur)="activeIndex.set(null)"
        >
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
                  <!-- style, not the attribute: a presentation attribute does not resolve var(--color-...) -->
                  <stop offset="0" [style.stop-color]="s.color" stop-opacity="0.45" />
                  <stop offset="1" [style.stop-color]="s.color" stop-opacity="0" />
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
        @if (activePoint(); as ap) {
          @for (m of ap.markers; track m.key) {
            <span
              data-active-dot
              class="absolute size-3 rounded-full border-2 border-white dark:border-surface -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-sm"
              aria-hidden="true"
              [style.left.%]="ap.x"
              [style.top.%]="m.y"
              [style.background-color]="m.color"
            ></span>
          }
          <app-chart-tooltip [title]="ap.title" [rows]="ap.rows" [x]="ap.x" [y]="ap.y" [below]="ap.below" />
        } @else if (endTooltip() && tooltip(); as tip) {
          <!-- Idle reading of the newest point (sm and up); a tap shows the tooltip at every width. -->
          <app-chart-tooltip
            data-end-tooltip
            class="hidden sm:block"
            [title]="tip.title"
            [rows]="tip.rows"
            [x]="tip.x"
            [y]="tip.y"
            [below]="tip.below"
          />
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
  /**
   * Text of a value in the tooltip, the keyboard reading and the screen-reader table. Default:
   * `valueFormat` in full (money with cents, "R$ 1.234,56", never the compact axis text).
   */
  readonly formatTooltip = input<((v: number) => string) | null>(null);
  /** Hover / tap / keyboard reading of any point. */
  readonly interactive = input(true);

  /** The x being read (hover, tap, keyboard); null = none. */
  protected readonly activeIndex = signal<number | null>(null);

  private static nextId = 0;
  private readonly uid = GrowthChart.nextId++;
  protected gradientId(key: string): string {
    return `growth-fill-${this.uid}-${key}`;
  }

  protected readonly legendSeries = computed(() =>
    [...this.series()].sort((a, b) => Number(!!a.reference) - Number(!!b.reference)),
  );

  /** Index of the newest measured value of the main series (where the chart "is" when idle). */
  protected readonly lastIndex = computed(() => {
    const main = this.series().find((x) => !x.reference) ?? this.series()[0];
    const idx = main ? lastMeasured(main.values) : -1;
    return idx >= 0 ? idx : Math.max(0, this.labels().length - 1);
  });

  /** x (0-100) of label `i` on the full axis. */
  private xOf(i: number): number {
    const span = this.labels().length;
    return span <= 1 ? 50 : (i / (span - 1)) * 100;
  }

  private yOf(v: number): number {
    return clampY(100 - (Math.max(0, v) / this.top()) * 100);
  }

  private fullText(v: number | null | undefined): string {
    return tooltipText(v, this.valueFormat(), this.formatTooltip());
  }

  /** Main series first, then the reference: one tooltip row each; `null` reads "sem dado". */
  private rowsAt(i: number): ChartTooltipRow[] {
    return this.legendSeries().map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      value: this.fullText(s.values[i]),
    }));
  }

  /** Spoken value of the slider: the x label and every series at it. */
  protected valueText(i: number): string {
    const label = `${this.tooltipLabelPrefix()}${this.labels()[i] ?? ''}`;
    return `${label}: ${this.rowsAt(i)
      .map((r) => `${r.label} ${r.value}`)
      .join(', ')}`;
  }

  /** Box above the highest point, or under it when that point is near the top of the plot. */
  private placement(ys: readonly number[]): { y: number; below: boolean } {
    const highest = ys.length ? Math.min(...ys) : 100;
    return highest < 30 ? { y: Math.min(highest, 70), below: true } : { y: highest, below: false };
  }

  protected readonly activePoint = computed(() => {
    const i = this.activeIndex();
    if (i === null || this.empty()) return null;
    const markers = this.series()
      .filter((s) => typeof s.values[i] === 'number')
      .map((s) => ({ key: s.key, color: s.color, y: this.yOf(s.values[i] as number) }));
    return {
      x: this.xOf(i),
      ...this.placement(markers.map((m) => m.y)),
      markers,
      title: `${this.tooltipLabelPrefix()}${this.labels()[i] ?? ''}`,
      rows: this.rowsAt(i),
    };
  });

  /** The idle tooltip at the newest point of the main series (`endTooltip`), values in full. */
  protected readonly tooltip = computed(() => {
    const main = this.drawn().find((d) => !d.reference && d.end);
    const series = this.series();
    const src = series.find((x) => x.key === main?.key);
    if (!main?.end || !src) return null;
    const idx = lastMeasured(src.values);
    if (idx < 0) return null;
    const ref = series.find((x) => x.reference);
    const rows: ChartTooltipRow[] = [
      { key: src.key, label: src.label, color: src.color, value: this.fullText(src.values[idx]) },
    ];
    const refValue = ref?.values[idx];
    if (ref && refValue !== undefined) {
      rows.push({ key: ref.key, label: ref.label, color: ref.color, value: this.fullText(refValue) });
    }
    return {
      x: main.end.x,
      ...this.placement([main.end.y]),
      title: `${this.tooltipLabelPrefix()}${this.labels()[idx] ?? ''}`,
      rows,
    };
  });

  protected onPointer(event: PointerEvent): void {
    if (!this.interactive()) return;
    const f = pointerFraction(event, event.currentTarget as Element);
    const i = f === null ? null : nearestPoint(f, this.labels().length);
    if (i !== null) this.activeIndex.set(i);
  }

  /** A mouse leaving closes the reading; a finger lifting keeps it (it was a tap). */
  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') this.activeIndex.set(null);
  }

  protected onFocus(): void {
    if (this.activeIndex() === null) this.activeIndex.set(this.lastIndex());
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.interactive()) return;
    if (event.key === 'Escape') {
      this.activeIndex.set(null);
      return;
    }
    const next = stepIndex(event.key, this.activeIndex(), this.labels().length);
    if (next === null) return;
    event.preventDefault();
    this.activeIndex.set(next);
  }

  protected readonly empty = computed(() => growthIsEmpty(this.series()));

  protected readonly top = computed(() => {
    const pinned = this.axisTop();
    const real = growthAxisTop(this.series(), this.axisFloor());
    // A pinned top is the caller's round number; only the data's own max is rounded up.
    if (pinned !== null && pinned >= real) return pinned;
    return niceAxisTop(real, Math.max(1, this.yDivisions()), this.valueFormat() === 'integer');
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
      .map((s) => {
        const runs = measuredRuns(s.values);
        const paths = runs.map((r) =>
          this.smooth() ? smoothPath(r.values, top, slots, r.offset) : linearPath(r.values, top, slots, r.offset),
        );
        const last = runs[runs.length - 1];
        return {
          key: s.key,
          label: s.label,
          color: s.color,
          reference: !!s.reference,
          line: paths.map((p) => p.line).join(' '),
          area: paths.map((p) => p.area).join(' '),
          end: last ? endPoint(last.values, top, slots, last.offset) : null,
        };
      });
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

  protected text(v: number | null | undefined): string {
    // The axis may be compact (R$ 10k); the text table keeps the exact value.
    return v === undefined ? '—' : this.fullText(v);
  }
}
