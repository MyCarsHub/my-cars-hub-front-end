import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';

/** One line of a chart tooltip: series name, value as text and the series swatch. */
export interface ChartTooltipRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Swatch colour (any CSS colour); none for a total line. */
  readonly color?: string | null;
  /** Bold line (a total). */
  readonly strong?: boolean;
}

/**
 * Brand data colours. Data is orange, green, black and greys only (owner rule, 18/11). They are
 * CSS variables, so black and the greys flip in dark mode with the rest of the page.
 */
export const CHART_ORANGE = 'var(--color-primary-500)';
export const CHART_GREEN = 'var(--color-success-500)';
export const CHART_BLACK = 'var(--color-fg)';
export const CHART_GREYS: readonly string[] = [
  'var(--color-fg-muted)',
  'var(--color-fg-faint)',
  'var(--color-edge-strong)',
  'var(--color-fg-subtle)',
];

/** How many series still get their own colour; above it the owner's grey rule applies. */
export const CHART_MAX_NAMED_COLOURS = 4;

/**
 * Pure: one colour per series, from each series' total (the sum of its values).
 * Up to {@link CHART_MAX_NAMED_COLOURS} series: orange, green, black, grey, in the given order.
 * Above it (owner decision D3): the biggest series orange, the second green, every other one grey.
 */
export function chartSeriesColors(totals: readonly number[]): string[] {
  if (totals.length <= CHART_MAX_NAMED_COLOURS) {
    return totals.map((_, i) => [CHART_ORANGE, CHART_GREEN, CHART_BLACK, CHART_GREYS[0]][i]);
  }
  const order = totals
    .map((t, i) => ({ t: Number.isFinite(t) ? t : 0, i }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.i);
  const out: string[] = new Array(totals.length);
  order.forEach((idx, rank) => {
    out[idx] = rank === 0 ? CHART_ORANGE : rank === 1 ? CHART_GREEN : CHART_GREYS[(rank - 2) % CHART_GREYS.length];
  });
  return out;
}

/**
 * Pure: the format a tooltip uses for a chart drawn in `kind`. Money always comes out whole with
 * cents ("R$ 1.234,56"), even when the axis is compact ("R$ 1,2k") or rounded ("R$ 1.235").
 */
export function fullValueFormat(kind: KpiNumberFormat): KpiNumberFormat {
  return kind === 'brl-cents-compact' || kind === 'brl-cents-whole' ? 'brl-cents' : kind;
}

/** Pure: the short format of a number printed ON a bar (money compact, counts as they are). */
export function barLabelFormat(kind: KpiNumberFormat): KpiNumberFormat {
  return kind === 'brl-cents' || kind === 'brl-cents-whole' ? 'brl-cents-compact' : kind;
}

/** Pure: `v` as tooltip text; `null` (not measured) reads "sem dado", never zero. */
export function tooltipText(
  v: number | null | undefined,
  kind: KpiNumberFormat,
  custom: ((v: number) => string) | null = null,
): string {
  if (v === null || v === undefined) return 'sem dado';
  return custom ? custom(v) : formatKpiNumber(fullValueFormat(kind), v);
}

/**
 * Pure: horizontal anchor of a tooltip at `xPct` (0..100) of the plot. Near the edges the box
 * hangs inward so it never leaves the card at 375px.
 */
export function tooltipShift(xPct: number): string {
  if (xPct <= 22) return 'translateX(-12px)';
  if (xPct >= 78) return 'translateX(calc(-100% + 12px))';
  return 'translateX(-50%)';
}

/**
 * Pure: the index a key moves to in a row of `count` items. `null` = the key is not a chart key.
 * Arrows step (and stop at the ends), Home/End jump; with nothing active an arrow starts at the
 * last item (the newest period, which is what a chart opens on).
 */
export function stepIndex(key: string, current: number | null, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const at = current ?? last;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return current === null ? last : Math.max(0, at - 1);
    case 'ArrowRight':
    case 'ArrowUp':
      return current === null ? last : Math.min(last, at + 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/** Pure: which of `count` equal slots a pointer at `fraction` (0..1) of the width falls in. */
export function slotAt(fraction: number, count: number): number | null {
  if (!(count > 0) || !Number.isFinite(fraction)) return null;
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}

/** Pure: the nearest of `count` points spread edge to edge (a line chart's x). */
export function nearestPoint(fraction: number, count: number): number | null {
  if (!(count > 0) || !Number.isFinite(fraction)) return null;
  if (count === 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
}

/** Pure: where a pointer event sits across `el`, 0..1; null when the box has no width (SSR, tests). */
export function pointerFraction(event: PointerEvent | MouseEvent, el: Element): number | null {
  const box = el.getBoundingClientRect();
  if (!(box.width > 0)) return null;
  return (event.clientX - box.left) / box.width;
}

/** Columns assumed to fit labels before the chart has been measured (SSR, first paint, tests). */
export const LABELS_FIT_UNMEASURED_MAX = 16;
/** Average width of one character of the 10px tabular label, in px (measured on "R$ 12,5k"). */
const LABEL_CHAR_PX = 5.6;

/**
 * Pure: whether `count` columns, each labelled with up to `maxChars` characters, can carry their
 * number on top without the labels running into each other. Unmeasured: by count only.
 */
export function labelsFit(count: number, maxChars: number, width: number | null): boolean {
  if (count <= 0) return false;
  if (width === null) return count <= LABELS_FIT_UNMEASURED_MAX;
  return width / count >= Math.max(24, maxChars * LABEL_CHAR_PX + 4);
}

/**
 * Pure: {@link labelsFit} for numbers printed only on SOME slots (the non-zero columns): the room
 * a number has is the distance to the nearest other labelled slot, not one slot. `positions` are
 * the labelled slot indexes in ascending order, out of `slots` columns in all.
 */
export function sparseLabelsFit(
  positions: readonly number[],
  slots: number,
  maxChars: number,
  width: number | null,
): boolean {
  if (positions.length === 0 || slots <= 0) return false;
  let closest = slots;
  for (let i = 1; i < positions.length; i++) closest = Math.min(closest, positions[i] - positions[i - 1]);
  return labelsFit(slots / Math.max(1, closest), maxChars, width);
}

/** Width of one character of an x-axis label (11px), in px, before the labels are measured. */
const AXIS_CHAR_PX = 6.2;
/** Least air between two printed x-axis labels, px. */
export const AXIS_LABEL_GAP_PX = 6;
/** Labels printed before the chart is measured (SSR, first paint, tests): a year of months. */
export const AXIS_UNMEASURED_MAX_LABELS = 12;

/**
 * Pure: how many slots apart two printed x-axis labels must be so they never run into each other.
 * `width` is the plot width and `labelPx` the widest label (both measured; `labelPx` null falls back
 * to `maxChars` x an average glyph). Unmeasured: by count, at most a year of labels.
 */
export function axisLabelStep(
  count: number,
  width: number | null,
  labelPx: number | null,
  maxChars: number,
): number {
  if (count <= 1) return 1;
  if (width === null || !(width > 0)) return Math.max(1, Math.ceil(count / AXIS_UNMEASURED_MAX_LABELS));
  const need = (labelPx && labelPx > 0 ? labelPx : maxChars * AXIS_CHAR_PX) + AXIS_LABEL_GAP_PX;
  return Math.max(1, Math.ceil(need / (width / count)));
}

/**
 * Pure: the label indexes the x axis prints, at least `step` slots apart: always the first and the
 * last, the rest evenly spread between them (the line chart's "pick N evenly" rule, with N taken
 * from the room instead of fixed). When even two do not fit, only the newest is printed.
 */
export function axisLabelIndices(count: number, step: number): number[] {
  if (count <= 0) return [];
  if (step <= 1) return Array.from({ length: count }, (_, i) => i);
  const intervals = Math.floor((count - 1) / step);
  if (intervals < 1) return [count - 1];
  return Array.from({ length: intervals + 1 }, (_, i) => Math.round((i * (count - 1)) / intervals));
}

/**
 * The widest of the host's elements matching `selector` (the x-axis labels), re-measured after a
 * render whenever `track` changes; null until measured (SSR, jsdom). Call in an injection context.
 */
export function injectLabelWidth(selector: string, track: () => unknown): Signal<number | null> {
  const host = inject<ElementRef<HTMLElement>>(ElementRef);
  const width = signal<number | null>(null);
  afterRenderEffect(() => {
    track();
    let max = 0;
    host.nativeElement.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      max = Math.max(max, el.getBoundingClientRect().width);
    });
    const current = untracked(width);
    if (max > 0 && (current === null || Math.abs(current - max) > 0.5)) width.set(max);
  });
  return width.asReadonly();
}

/**
 * The host element's width, kept current by a ResizeObserver (null until measured, and always
 * null where there is no ResizeObserver: SSR, jsdom). Call in an injection context.
 */
export function injectHostWidth(): Signal<number | null> {
  const host = inject<ElementRef<HTMLElement>>(ElementRef);
  const destroyRef = inject(DestroyRef);
  const width = signal<number | null>(null);
  afterNextRender(() => {
    const el = host.nativeElement;
    const view = el.ownerDocument?.defaultView;
    if (!view || typeof view.ResizeObserver !== 'function') return;
    const ro = new view.ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) width.set(w);
    });
    ro.observe(el);
    destroyRef.onDestroy(() => ro.disconnect());
  });
  return width.asReadonly();
}

/**
 * The floating reading of a chart: title + one line per series (swatch, name, full value).
 * Positioned by the chart (`x`/`y` in % of its plot box); it hangs inward near the edges and
 * sits above the anchor unless `below`. Decorative for assistive tech (`aria-hidden`): every
 * chart says the same numbers through its keyboard control and its screen-reader table.
 * Enters with a short rise + fade (iOS-like), none under reduced motion.
 */
@Component({
  selector: 'app-chart-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'absolute z-20 pointer-events-none',
    'aria-hidden': 'true',
    'data-chart-tooltip': '',
    '[style.left.%]': 'x()',
    '[style.top.%]': 'y()',
    '[style.transform]': 'transform()',
  },
  styles: `
    .tip-in {
      animation: chart-tip-in 160ms cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
    }
    @keyframes chart-tip-in {
      from {
        opacity: 0;
        transform: translate3d(0, 4px, 0) scale(0.97);
      }
      to {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tip-in {
        animation: none;
      }
    }
  `,
  template: `
    <div class="tip-in rounded-xl bg-surface-strong px-3 py-2 text-xs leading-snug shadow-lg whitespace-nowrap">
      @if (title()) {
        <p data-tip-title class="text-fg-muted">{{ title() }}</p>
      }
      @for (row of rows(); track row.key) {
        <p data-tip-row class="flex items-center gap-1.5 tabular-nums">
          @if (row.color) {
            <span class="size-2 rounded-[2px] shrink-0" [style.background-color]="row.color"></span>
          }
          <span class="text-fg-muted">{{ row.label }}</span>
          <b class="ml-auto pl-3 text-fg" [class.font-semibold]="!row.strong" [class.font-bold]="row.strong">{{ row.value }}</b>
        </p>
      }
    </div>
  `,
})
export class ChartTooltip {
  readonly title = input('');
  readonly rows = input.required<readonly ChartTooltipRow[]>();
  /** Anchor, in % of the plot width. */
  readonly x = input.required<number>();
  /** Anchor, in % of the plot height. */
  readonly y = input(0);
  /** Box under the anchor instead of above it. */
  readonly below = input(false);

  protected readonly transform = computed(
    () => `${tooltipShift(this.x())} ${this.below() ? 'translateY(10px)' : 'translateY(calc(-100% - 10px))'}`,
  );
}
