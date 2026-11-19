import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';
import { barPct } from '../bar-chart/bar-chart';
import {
  ChartTooltip,
  barLabelFormat,
  injectHostWidth,
  labelsFit,
  pointerFraction,
  slotAt,
  stepIndex,
  tooltipText,
  type ChartTooltipRow,
} from '../chart-tooltip/chart-tooltip';

/** One coloured part of a row. `color` is any CSS colour (token var or hex). */
export interface StackSegment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export interface StackRow {
  readonly label: string;
  readonly hint?: string;
  readonly segments: readonly StackSegment[];
}

interface RenderedSegment extends StackSegment {
  /** Width (rows) or height (columns) in % of the largest row total. */
  readonly pct: number;
  readonly text: string;
}

interface RenderedRow {
  readonly label: string;
  readonly hint: string | null;
  readonly totalText: string;
  readonly segments: readonly RenderedSegment[];
  readonly summary: string;
  /** Total as printed on top of a column (compact money). */
  readonly short: string;
  /** Total of the row in % of the largest (column height). */
  readonly pct: number;
  /** Tooltip lines: every part (biggest first) and the total, all in full. */
  readonly tip: readonly ChartTooltipRow[];
}

interface LegendItem {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

/**
 * Stacked horizontal bars: each row is one bar split into coloured parts, all rows on the
 * same scale (the largest row total is 100%). Same row layout and scale rule as `app-bar-chart`
 * (`barPct`), so a stacked and a plain bar read the same. Divs and widths, not canvas: crisp at
 * any width, tiny DOM, and the numbers are real text for screen readers.
 *
 * Reading: hover, tap or the keyboard (arrows, Home/End, Esc) opens a tooltip with every part of
 * the column/row and its total, in full (money with cents; `formatTooltip` overrides). In the
 * columns layout the total is printed on top of each column from `sm` when the labels have room.
 * Entry: columns rise from the base in a cascade, rows are revealed left to right; reduced motion
 * turns both into a short fade.
 */
@Component({
  selector: 'app-stacked-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartTooltip],
  host: { class: 'block min-w-0' },
  styles: `
    /* The total on a column fades in once its column has risen (same cascade). */
    .label-in {
      animation: chart-label-in 240ms ease-out backwards;
      animation-delay: calc(480ms + min(var(--stagger-i, 0), 8) * 45ms);
    }
    @keyframes chart-label-in {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .label-in {
        animation: none;
      }
    }
  `,
  template: `
    @if (layout() === 'columns') {
      @if (columnsEmpty()) {
        <p data-empty class="text-sm text-fg-subtle text-center py-6">{{ emptyText() }}</p>
      } @else {
        <div
          data-stack-control
          class="relative rounded-lg touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          tabindex="0"
          role="slider"
          [attr.aria-label]="ariaLabel()"
          aria-valuemin="1"
          [attr.aria-valuemax]="renderedRows().length"
          [attr.aria-valuenow]="(active() ?? renderedRows().length - 1) + 1"
          [attr.aria-valuetext]="spoken(active() ?? renderedRows().length - 1)"
          (pointermove)="onPointer($event)"
          (pointerdown)="onPointer($event)"
          (pointerleave)="onPointerLeave($event)"
          (keydown)="onKey($event)"
          (focus)="onFocus()"
          (blur)="active.set(null)"
        >
        <div data-stack-columns class="flex items-stretch gap-1.5 sm:gap-2 min-w-0" [style.height.px]="heightPx()">
          @for (row of renderedRows(); track row.label; let i = $index) {
            <div
              data-stack-column
              class="flex-1 min-w-0 flex flex-col items-center gap-1.5 rounded-lg transition-colors duration-150"
              role="group"
              [class.bg-surface-sunken]="i === active()"
              [attr.aria-label]="row.label + ': ' + row.totalText + (row.summary ? ' (' + row.summary + ')' : '')"
            >
              <!-- sm:pt-4 keeps room above the tallest column for its total -->
              <div class="w-full flex-1 min-h-0 flex flex-col" [class.sm:pt-4]="showLabels()" aria-hidden="true">
                <div class="relative w-full flex-1 min-h-0">
                  <div class="bar-rise absolute inset-0 flex flex-col-reverse gap-px" [style.--stagger-i]="i">
                    @for (seg of row.segments; track seg.key; let last = $last) {
                      <div
                        data-segment
                        class="w-full shrink-0"
                        [class.rounded-t-[4px]]="last"
                        [style.height.%]="seg.pct"
                        [style.background-color]="seg.color"
                      ></div>
                    }
                  </div>
                  @if (showLabels() && row.pct > 0) {
                    <span
                      data-stack-total
                      class="label-in absolute left-1/2 -translate-x-1/2 mb-0.5 hidden sm:block text-[10px] leading-none text-fg-muted tabular-nums whitespace-nowrap"
                      [class.text-fg]="i === active()"
                      [class.font-semibold]="i === active()"
                      [style.bottom.%]="row.pct"
                      [style.--stagger-i]="i"
                      >{{ row.short }}</span
                    >
                  }
                </div>
              </div>
              <span
                class="text-[10px] sm:text-[11px] text-fg-muted whitespace-nowrap"
                [class.text-fg]="i === active()"
                [class.font-semibold]="i === active()"
                aria-hidden="true"
                >{{ row.label }}</span
              >
            </div>
          }
        </div>
        @if (columnTip(); as tip) {
          <app-chart-tooltip [title]="tip.title" [rows]="tip.rows" [x]="tip.x" [y]="tip.y" [below]="tip.below" />
        }
        </div>
      }
    } @else {
    <div class="space-y-3 min-w-0">
      @for (row of renderedRows(); track row.label; let i = $index) {
        <div
          data-stack-row
          class="relative min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          role="group"
          tabindex="0"
          [attr.aria-label]="row.label + ': ' + row.summary"
          (pointerenter)="active.set(i)"
          (pointerdown)="active.set(i)"
          (pointerleave)="onPointerLeave($event)"
          (focus)="active.set(i)"
          (blur)="active.set(null)"
          (keydown.escape)="active.set(null)"
        >
          <div class="flex justify-between items-baseline gap-2 text-xs mb-1 min-w-0">
            <span class="text-fg-soft truncate min-w-0">{{ row.label }}</span>
            <span class="text-fg font-medium tabular-nums shrink-0">{{ row.totalText }}</span>
          </div>
          @if (row.hint) {
            <p class="text-[10px] text-fg-subtle mb-1 truncate">{{ row.hint }}</p>
          }
          <div class="flex h-2.5 gap-0.5 rounded-full bg-surface-sunken dark:bg-placeholder-fill overflow-hidden" aria-hidden="true">
            @for (seg of row.segments; track seg.key) {
              <div
                data-segment
                class="draw-in h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-500 motion-reduce:transition-none"
                [style.width.%]="seg.pct"
                [style.background-color]="seg.color"
              ></div>
            }
          </div>
          @if (i === active()) {
            <app-chart-tooltip [title]="row.label" [rows]="row.tip" [x]="0" [y]="100" [below]="true" />
          }
        </div>
      } @empty {
        <p class="text-sm text-fg-subtle text-center py-6">Sem dados no período.</p>
      }
    </div>
    }
    @if (legend().length) {
      <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda">
        @for (item of legend(); track item.key) {
          <li class="inline-flex items-center gap-1.5">
            <span class="size-2.5 rounded-[3px] shrink-0" aria-hidden="true" [style.background-color]="item.color"></span>
            {{ item.label }}
          </li>
        }
      </ul>
    }
  `,
})
export class StackedBarChart {
  readonly rows = input.required<readonly StackRow[]>();
  /** How a value becomes text; default counts. */
  readonly valueFormat = input<KpiNumberFormat>('integer');
  /**
   * `rows` (default): horizontal bars, one per row. `columns`: one vertical column per row, the
   * parts stacked from the bottom (costs per month, a colour per vendor).
   */
  readonly layout = input<'rows' | 'columns'>('rows');
  /** Plot height of the `columns` layout. */
  readonly heightPx = input(180);
  readonly emptyText = input('Sem dados no período.');
  /** Name of the chart for assistive tech (columns layout control). */
  readonly ariaLabel = input('Gráfico de colunas empilhadas');
  /** Text of a value in the tooltip: full (money with cents) unless overridden. */
  readonly formatTooltip = input<((v: number) => string) | null>(null);

  /** Column / row being read (hover, tap, keyboard); null = none. */
  protected readonly active = signal<number | null>(null);
  private readonly width = injectHostWidth();

  /** Columns with nothing above zero draw no plot at all (the empty copy says so instead). */
  protected readonly columnsEmpty = computed(() =>
    this.rows().every((r) => r.segments.every((s) => !(s.value > 0))),
  );

  protected readonly renderedRows = computed(() => this.render());

  private render(): RenderedRow[] {
    const fmt = this.valueFormat();
    const custom = this.formatTooltip();
    const full = (v: number): string => tooltipText(v, fmt, custom);
    const totals = this.rows().map((r) => r.segments.reduce((s, x) => s + Math.max(0, x.value), 0));
    const max = Math.max(0, ...totals);
    return this.rows().map((r, i) => {
      const total = totals[i];
      const segments = r.segments.map((s) => ({
        ...s,
        pct: barPct(s.value, max),
        text: formatKpiNumber(fmt, s.value),
      }));
      const parts: ChartTooltipRow[] = [...r.segments]
        .filter((s) => s.value !== 0)
        .sort((a, b) => b.value - a.value)
        .map((s) => ({ key: s.key, label: s.label, color: s.color, value: full(s.value) }));
      return {
        label: r.label,
        hint: r.hint ?? null,
        totalText: formatKpiNumber(fmt, total),
        segments,
        summary: segments.map((s) => `${s.label} ${s.text}`).join(', '),
        short: formatKpiNumber(barLabelFormat(fmt), total),
        pct: barPct(total, max),
        tip: [...parts, { key: '__total', label: 'Total', value: full(total), strong: true }],
      };
    });
  }

  /** Totals on top of the columns (sm and up) only when every label has room. */
  protected readonly showLabels = computed(() => {
    const rows = this.renderedRows();
    return labelsFit(rows.length, Math.max(0, ...rows.map((r) => r.short.length)), this.width());
  });

  protected readonly columnTip = computed(() => {
    const i = this.active();
    const rows = this.renderedRows();
    if (i === null || !rows[i]) return null;
    const y = 100 - rows[i].pct;
    return { title: rows[i].label, rows: rows[i].tip, x: ((i + 0.5) / rows.length) * 100, y, below: y < 35 };
  });

  protected spoken(i: number): string {
    const row = this.renderedRows()[i];
    return row ? `${row.label}: ${row.tip.map((t) => `${t.label} ${t.value}`).join(', ')}` : '';
  }

  protected onPointer(event: PointerEvent): void {
    const f = pointerFraction(event, event.currentTarget as Element);
    const i = f === null ? null : slotAt(f, this.renderedRows().length);
    if (i !== null) this.active.set(i);
  }

  /** A mouse leaving closes the reading; a finger lifting keeps it (it was a tap). */
  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') this.active.set(null);
  }

  protected onFocus(): void {
    if (this.active() === null) this.active.set(Math.max(0, this.renderedRows().length - 1));
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.active.set(null);
      return;
    }
    const next = stepIndex(event.key, this.active(), this.renderedRows().length);
    if (next === null) return;
    event.preventDefault();
    this.active.set(next);
  }

  protected readonly legend = computed<LegendItem[]>(() => {
    const seen = new Map<string, LegendItem>();
    for (const row of this.rows()) {
      for (const s of row.segments) {
        if (!seen.has(s.key)) seen.set(s.key, { key: s.key, label: s.label, color: s.color });
      }
    }
    return [...seen.values()];
  });
}
