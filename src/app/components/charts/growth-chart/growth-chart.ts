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

/** Keeps a control point inside the axis so a sudden jump cannot draw the curve outside it. */
const clampY = (y: number): number => Math.min(100, Math.max(0, y));

/**
 * Pure: smooth Catmull-Rom path through `values` in a 0-100 box (x spread evenly, y inverted
 * against `top`). Returns the SVG `d` for the line and for the closed area under it.
 */
export function smoothPath(
  values: readonly number[],
  top: number,
): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const n = values.length;
  const pts = values.map((v, i) => [n === 1 ? 50 : (i / (n - 1)) * 100, 100 - (v / top) * 100]);
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d +=
      ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${clampY(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)}` +
      ` ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${clampY(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)}` +
      ` ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  const lastX = pts[n - 1][0].toFixed(2);
  const firstX = pts[0][0].toFixed(2);
  return { line: d, area: `${d} L${lastX} 100 L${firstX} 100 Z` };
}

interface DrawnSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly reference: boolean;
  readonly line: string;
  readonly area: string;
}

/**
 * Multi-series smooth area/line chart with legend. SVG in a 0-100 viewBox stretched with
 * `preserveAspectRatio="none"` and `vector-effect: non-scaling-stroke`, so lines keep a
 * constant weight at any width (375px to desktop). No library: this is the same curve the
 * design prototype draws, and it ships zero extra bytes. Axis rule is the line chart's (zero
 * floor, minimum top); the same series are repeated in a sr-only table, since an SVG path
 * carries no numbers. Draws nothing animated, so reduced motion needs no special case.
 */
@Component({
  selector: 'app-growth-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="flex gap-2 min-w-0">
      <div
        class="flex flex-col justify-between text-right text-[10px] text-fg-muted tabular-nums min-w-9 pb-5"
        aria-hidden="true"
      >
        @for (tick of yTicks(); track $index) {
          <span>{{ tick }}</span>
        }
      </div>
      <div class="flex-1 min-w-0 flex flex-col">
        <svg
          data-plot
          class="w-full block overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          [style.height.px]="heightPx()"
        >
          @for (s of drawn(); track s.key) {
            @if (!s.reference && area()) {
              <path data-area [attr.d]="s.area" [style.fill]="s.color" fill-opacity="0.12" stroke="none" />
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
        <div class="flex justify-between text-[11px] text-fg-muted h-5 pt-1" aria-hidden="true">
          @for (label of xTicks(); track $index) {
            <span>{{ label }}</span>
          }
        </div>
      </div>
    </div>

    @if (series().length > 1) {
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

    <table class="sr-only">
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

  protected readonly top = computed(() => growthAxisTop(this.series(), this.axisFloor()));

  protected readonly drawn = computed<DrawnSeries[]>(() => {
    const top = this.top();
    // Reference first so the main series paints over it.
    return [...this.series()]
      .sort((a, b) => Number(!!b.reference) - Number(!!a.reference))
      .map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        reference: !!s.reference,
        ...smoothPath(s.values, top),
      }));
  });

  protected readonly yTicks = computed(() => {
    const top = this.top();
    return [1, 0.75, 0.5, 0.25, 0].map((f) => formatKpiNumber(this.valueFormat(), top * f));
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
    return v === undefined ? '—' : formatKpiNumber(this.valueFormat(), v);
  }
}
