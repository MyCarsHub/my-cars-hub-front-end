import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatBRL } from '../../../types/dashboard.types';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';
import {
  ChartTooltip,
  LABEL_CHAR_PX,
  axisLabelIndices,
  axisLabelStep,
  barLabelFormat,
  injectHostWidth,
  injectLabelWidth,
  pointerFraction,
  slotAt,
  sparseLabelsFit,
  stepIndex,
  tooltipText,
  type ChartTooltipRow,
} from '../chart-tooltip/chart-tooltip';
import { niceAxisTop } from '../growth-chart/growth-chart';

/** Room the y-axis column takes from the plot (its `min-w-9` + the `gap-2`), px. */
const Y_AXIS_RESERVE_PX = 48;
/** More groups than this: the columns sit closer (2px), so a month of days is not a row of hairlines. */
export const BAR_DENSE_GROUPS = 14;
/** More groups than this: 1px apart. */
export const BAR_VERY_DENSE_GROUPS = 24;
/*
 * Whole class strings (Tailwind finds a utility by scanning for it). Not `[class.gap-1.5]`: a
 * class binding cuts the name at the dot and applied `gap-1`.
 */
const COLUMNS_CLASS = {
    normal: 'flex items-stretch min-w-0 gap-1.5 sm:gap-2',
    dense: 'flex items-stretch min-w-0 gap-0.5',
    'very-dense': 'flex items-stretch min-w-0 gap-px',
} as const;

export interface BarDatum {
    label: string;
    value: number;
    /** Optional tooltip / helper line (e.g. subtitle like brand + model). */
    hint?: string;
}

/** Width of a bar in percent of `max`. Shared with `app-stacked-bar-chart` so both scale the same. */
export function barPct(value: number, max: number): number {
    return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

/**
 * One series of the grouped-columns layout: one value per label. `null` = not measured: the
 * column is left out (never drawn as zero) and the text table says "sem dado".
 */
export interface BarSeries {
    readonly key: string;
    readonly label: string;
    /** Any CSS colour. */
    readonly color: string;
    readonly values: readonly (number | null)[];
}

interface RenderedColumn {
    readonly key: string;
    readonly color: string;
    /** Height in % of the positive (or negative) band; null = not measured. */
    readonly pct: number | null;
    readonly negative: boolean;
    /** Measured zero: no column to read, so no number printed on it. */
    readonly zero: boolean;
    /** Short number printed on the column (money compact). */
    readonly short: string;
}

interface RenderedGroup {
    readonly label: string;
    readonly columns: readonly RenderedColumn[];
    /** Tooltip lines: every series in full ("sem dado" for a missing one). */
    readonly rows: readonly ChartTooltipRow[];
    /** Spoken reading of the group (slider value text). */
    readonly aria: string;
    /** Tallest positive column of the group, % of the positive band (tooltip anchor). */
    readonly peak: number;
}

/**
 * Pure: how the plot splits between values above and below zero. `up` + `down` = 100 (percent of
 * the plot height); a chart with no negative value is all `up`.
 */
export function zeroSplit(series: readonly BarSeries[]): { top: number; bottom: number; up: number; down: number } {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && v !== undefined);
    const top = Math.max(0, ...all);
    const bottom = Math.abs(Math.min(0, ...all));
    const span = top + bottom;
    const up = span > 0 ? (top / span) * 100 : 100;
    return { top, bottom, up, down: 100 - up };
}

/** Height of the x label row under the columns: the group's `gap-1.5` + the `h-5` label, px. */
const X_ROW_PX = 26;
/** Room kept above the tallest column for its number (`sm:pt-4`), px. */
const LABEL_ROOM_PX = 16;
/** A number on a column: `text-[10px] leading-none`, lifted by its `mb-0.5`, px. */
const VALUE_HEIGHT_PX = 10;
const VALUE_LIFT_PX = 2;
/** Least air between two numbers side by side / one above the other, px. */
const VALUE_AIR_X_PX = 4;
const VALUE_AIR_Y_PX = 2;
/**
 * How far a number may hang past the plot's side, px: on the left up to the y axis ticks (a
 * `gap-2` away, less the air), elsewhere into the card's `p-4` padding.
 */
const VALUE_EDGE_BY_AXIS_PX = 6;
const VALUE_EDGE_BY_CARD_PX = 12;

/** What {@link placeBarValues} reads of a column. */
export interface BarValueColumn {
    /** Height in % of the band; null = not measured. */
    readonly pct: number | null;
    readonly negative: boolean;
    readonly zero: boolean;
    /** The number printed on it. */
    readonly short: string;
}

/**
 * Pure: which positive columns may carry their number, placed one by one (tallest first, then
 * left to right) where it touches no number already placed and sits on no other column. A number
 * is a box `short.length * LABEL_CHAR_PX` wide centred on its column, just above the column's top;
 * two numbers side by side are fine when their heights differ by more than a line. `plotPx` is the
 * width of the columns, `bandPx` the height the tallest one can reach, `edge` how far a number may
 * hang past each side. Negative, zero and missing columns never carry one (their bars still count
 * as obstacles).
 */
export function placeBarValues(
    groups: readonly (readonly BarValueColumn[])[],
    plotPx: number,
    bandPx: number,
    edge: { readonly left: number; readonly right: number } = { left: 0, right: 0 },
): boolean[][] {
    const shown = groups.map((g) => g.map(() => false));
    if (!groups.length || !(plotPx > 0) || !(bandPx > 0)) return shown;
    const groupPx = plotPx / groups.length;
    const top = (c: BarValueColumn) => (c.pct === null || c.negative || c.zero ? 0 : (c.pct / 100) * bandPx);
    const cells = groups.flatMap((g, gi) =>
        g.map((c, ci) => {
            const left = gi * groupPx + (ci * groupPx) / g.length;
            const right = left + groupPx / g.length;
            return { gi, ci, c, left, right, centre: (left + right) / 2, top: top(c) };
        }),
    );
    const candidates = cells
        .filter((x) => x.c.pct !== null && !x.c.negative && !x.c.zero)
        .sort((a, b) => b.top - a.top || a.left - b.left);
    const placed: { centre: number; half: number; bottom: number }[] = [];
    for (const x of candidates) {
        const half = (x.c.short.length * LABEL_CHAR_PX) / 2;
        const bottom = x.top + VALUE_LIFT_PX;
        const from = x.centre - half;
        const to = x.centre + half;
        if (from < -edge.left || to > plotPx + edge.right) continue;
        const onAColumn = cells.some((o) => o !== x && o.left < to && o.right > from && o.top > bottom - VALUE_AIR_Y_PX);
        if (onAColumn) continue;
        const touches = placed.some(
            (p) =>
                Math.abs(p.centre - x.centre) < p.half + half + VALUE_AIR_X_PX &&
                Math.abs(p.bottom - bottom) < VALUE_HEIGHT_PX + VALUE_AIR_Y_PX,
        );
        if (touches) continue;
        placed.push({ centre: x.centre, half, bottom });
        shown[x.gi][x.ci] = true;
    }
    return shown;
}

interface RenderedBar {
    label: string;
    hint: string | null;
    primaryPct: number;
    secondaryPct: number | null;
    primaryValue: string;
    secondaryValue: string | null;
    gapValue: string | null;
    hasSecondary: boolean;
}

/**
 * Reusable horizontal bar chart, mobile-first. Uses divs + width % (not SVG)
 * so it stays crisp at any container size and keeps DOM tiny. When
 * {@link secondaryData} is provided, each row shows two stacked bars — used
 * for the "Previsto vs Recebido" comparison, with a red "inadimplência" hint
 * when secondary < primary.
 *
 * Values are treated as cents and rendered as BRL by default. Pass a custom
 * {@link formatValue} to override (e.g. to render raw counts). Row fills are revealed left to
 * right on entry (`draw-in`; a plain fade under reduced motion).
 *
 * Columns layout (`series`): the plot is one keyboard/pointer control, like the dashboard's
 * "Recebido vs lucro". Hover, tap or the arrows pick a group; the tooltip lists every series of
 * it in full (money with cents, `formatTooltip` overrides). From `sm` each column carries its
 * number on top (compact money) when the labels have room; on phones the tap is the reading.
 * Columns rise from the base in a cascade (`bar-rise`).
 */
@Component({
    selector: 'app-bar-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ChartTooltip],
    host: { class: 'block min-w-0' },
    styles: `
        /* The number on a column fades in once its column has risen (same cascade). */
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
        @if (series()) {
            @if (legend()) {
                <ul data-bar-legend class="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda">
                    @for (s of series(); track s.key) {
                        <li class="inline-flex items-center gap-1.5">
                            <span class="size-2.5 rounded-[3px] shrink-0" aria-hidden="true" [style.background-color]="s.color"></span>
                            {{ s.label }}
                        </li>
                    }
                </ul>
            }
            @if (groups().length) {
                <div class="flex gap-2 min-w-0" data-bar-plot>
                @if (showYAxis()) {
                    <!--
                      The line charts' y axis (same size, colour and tick count), no grid lines. Ticks
                      sit on the column band: above it the room for the numbers (sm:pt-4), below it
                      the x label row (gap 6px + h-5 = 26px).
                    -->
                    <div
                        data-y-axis
                        class="flex flex-col justify-between text-right text-[10px] sm:text-[11px] leading-none text-fg-muted tabular-nums min-w-9 shrink-0 pb-[26px]"
                        [class.sm:pt-4]="showLabels()"
                        aria-hidden="true"
                        [style.height.px]="heightPx()"
                    >
                        @for (tick of yTicks(); track $index) {
                            <span>{{ tick }}</span>
                        }
                    </div>
                }
                <div
                    data-bar-control
                    class="relative flex-1 min-w-0 rounded-lg touch-pan-y select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    tabindex="0"
                    role="slider"
                    [attr.aria-label]="ariaLabel()"
                    aria-valuemin="1"
                    [attr.aria-valuemax]="groups().length"
                    [attr.aria-valuenow]="(active() ?? groups().length - 1) + 1"
                    [attr.aria-valuetext]="groups()[active() ?? groups().length - 1].aria"
                    (pointermove)="onPointer($event)"
                    (pointerdown)="onPointer($event)"
                    (pointerleave)="onPointerLeave($event)"
                    (keydown)="onKey($event)"
                    (focus)="onFocus()"
                    (blur)="active.set(null)"
                >
                <div
                    data-bar-columns
                    [class]="columnsClass()"
                    aria-hidden="true"
                    [style.height.px]="heightPx()"
                >
                    @for (g of groups(); track g.label; let gi = $index) {
                        <div
                            data-bar-group
                            class="flex-1 min-w-0 flex flex-col items-center gap-1.5 rounded-lg transition-colors duration-150"
                            [class.bg-surface-sunken]="gi === active()"
                        >
                            <div class="w-full flex-1 min-h-0 flex flex-col">
                                <!-- sm:pt-4 keeps room above the tallest column for its number -->
                                <div class="w-full flex items-end gap-0.5" [class.sm:pt-4]="showLabels()" [style.height.%]="split().up">
                                    @for (c of g.columns; track c.key; let ci = $index) {
                                        <div class="relative flex-1 min-w-0 h-full flex flex-col justify-end">
                                            <span
                                                data-bar-column
                                                class="bar-rise w-full rounded-t-[4px]"
                                                [style.--stagger-i]="gi"
                                                [style.height.%]="c.negative || c.pct === null ? 0 : c.pct"
                                                [style.background-color]="c.color"
                                            ></span>
                                            @if (labelShown()[gi][ci] && !c.negative && !c.zero && c.pct !== null) {
                                                <span
                                                    data-bar-value
                                                    class="label-in absolute left-1/2 -translate-x-1/2 mb-0.5 hidden sm:block text-[10px] leading-none text-fg-muted tabular-nums whitespace-nowrap"
                                                    [class.text-fg]="gi === active()"
                                                    [class.font-semibold]="gi === active()"
                                                    [style.bottom.%]="c.pct"
                                                    [style.--stagger-i]="gi"
                                                    >{{ c.short }}</span
                                                >
                                            }
                                        </div>
                                    }
                                </div>
                                @if (split().down > 0) {
                                    <div class="w-full flex items-start gap-0.5" [class.sm:pb-4]="showLabels()" [style.height.%]="split().down">
                                        @for (c of g.columns; track c.key; let ci = $index) {
                                            <div class="relative flex-1 min-w-0 h-full flex flex-col justify-start">
                                                <span
                                                    data-bar-negative
                                                    class="bar-rise w-full rounded-b-[4px]"
                                                    style="transform-origin: top center"
                                                    [style.--stagger-i]="gi"
                                                    [style.height.%]="c.negative && c.pct !== null ? c.pct : 0"
                                                    [style.background-color]="c.color"
                                                ></span>
                                                @if (labelShown()[gi][ci] && c.negative && c.pct !== null) {
                                                    <span
                                                        data-bar-value
                                                        class="label-in absolute left-1/2 -translate-x-1/2 mt-0.5 hidden sm:block text-[10px] leading-none text-fg-muted tabular-nums whitespace-nowrap"
                                                        [style.top.%]="c.pct"
                                                        [style.--stagger-i]="gi"
                                                        >{{ c.short }}</span
                                                    >
                                                }
                                            </div>
                                        }
                                    </div>
                                }
                            </div>
                            <!-- Thinned when the labels would run into each other: the hidden ones keep their box. -->
                            <span
                                data-x-label
                                class="h-5 leading-5 text-[10px] sm:text-[11px] text-fg-muted whitespace-nowrap"
                                [class.invisible]="!xShown()[gi]"
                                [class.text-fg]="gi === active()"
                                [class.font-semibold]="gi === active()"
                                >{{ g.label }}</span
                            >
                        </div>
                    }
                </div>
                @if (activeTip(); as tip) {
                    <app-chart-tooltip [title]="tip.title" [rows]="tip.rows" [x]="tip.x" [y]="tip.y" [below]="tip.below" />
                }
                </div>
                </div>
                <table class="sr-only">
                    <caption>{{ ariaLabel() }}</caption>
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
                                    <td>{{ cellText(s.values[i]) }}</td>
                                }
                            </tr>
                        }
                    </tbody>
                </table>
            } @else {
                <p data-empty class="text-sm text-fg-subtle text-center py-6">{{ emptyText() }}</p>
            }
        } @else {
        <div class="space-y-3 min-w-0">
            @for (bar of bars(); track bar.label) {
                <div class="min-w-0">
                    <div class="flex justify-between items-baseline gap-2 text-xs mb-1 min-w-0">
                        <span class="text-gray-700 dark:text-fg-soft truncate min-w-0">{{ bar.label }}</span>
                        <span class="text-gray-900 dark:text-fg font-medium tabular-nums shrink-0">
                            {{ bar.primaryValue }}
                        </span>
                    </div>
                    @if (bar.hint) {
                        <p class="text-[10px] text-gray-500 dark:text-fg-subtle mb-1 truncate">{{ bar.hint }}</p>
                    }
                    <div
                        class="h-2 rounded-full bg-gray-100 dark:bg-placeholder-fill overflow-hidden"
                        [attr.aria-label]="bar.label + ': ' + bar.primaryValue"
                    >
                        <div
                            class="draw-in h-full rounded-full bg-primary-500 transition-all duration-500"
                            [style.width.%]="bar.primaryPct"
                        ></div>
                    </div>
                    @if (bar.hasSecondary) {
                        <div class="flex justify-between items-baseline gap-2 text-[11px] mt-1 min-w-0">
                            <span class="text-gray-500 dark:text-fg-subtle truncate">Recebido</span>
                            <span class="text-emerald-600 dark:text-emerald-300 tabular-nums font-medium shrink-0">
                                {{ bar.secondaryValue }}
                            </span>
                        </div>
                        <div class="h-2 rounded-full bg-gray-100 dark:bg-placeholder-fill overflow-hidden mt-1">
                            <div
                                class="draw-in h-full rounded-full bg-emerald-500 transition-all duration-500"
                                [style.width.%]="bar.secondaryPct"
                            ></div>
                        </div>
                        @if (bar.gapValue) {
                            <p class="text-[11px] text-red-600 dark:text-red-300 mt-1 tabular-nums">
                                Inadimplência: {{ bar.gapValue }}
                            </p>
                        }
                    }
                </div>
            } @empty {
                <p class="text-sm text-gray-500 dark:text-fg-subtle text-center py-6">Sem dados no período.</p>
            }
        </div>
        }
    `,
})
export class BarChart {
    /** Horizontal rows (the default layout). Ignored when `series` is given. */
    readonly data = input<BarDatum[]>([]);
    /** Optional second series (same length + label order). */
    readonly secondaryData = input<BarDatum[] | null>(null);
    readonly formatValue = input<(v: number) => string>((v) => formatBRL(v));

    /**
     * N series as grouped vertical columns, one group per `labels` entry (MRR x custos x lucro).
     * Negative values hang below a zero line; `null` leaves the column out.
     */
    readonly series = input<readonly BarSeries[] | null>(null);
    /** One label per group (columns layout). */
    readonly labels = input<readonly string[]>([]);
    /** Columns layout: axis/label unit. Tooltip and table show it in full (`brl-cents-whole` -> cents). */
    readonly valueFormat = input<KpiNumberFormat>('brl-cents');
    readonly heightPx = input(180);
    readonly ariaLabel = input('Gráfico de barras');
    readonly legend = input(true);
    readonly emptyText = input('Sem dados no período.');
    /**
     * Columns layout: a y axis on the left (the line charts' one: compact ticks, no grid lines), with
     * the columns scaled to its round top instead of the tallest column. Ignored when a value is
     * negative (the zero line is not at the bottom then).
     */
    readonly yAxis = input(false);
    /** Least axis top with `yAxis` (same unit as the values): money callers pass `MONEY_AXIS_FLOOR_CENTS`. */
    readonly axisFloor = input(0);
    /** Gaps between y ticks with `yAxis` (4 = five ticks, the line charts' default). */
    readonly yDivisions = input(4);

    protected readonly split = computed(() => zeroSplit(this.series() ?? []));

    protected readonly showYAxis = computed(() => this.yAxis() && this.split().down === 0);

    /** The round top the columns are scaled to with the y axis (`niceAxisTop`, like the line charts). */
    private readonly axisTop = computed(() =>
        niceAxisTop(
            Math.max(this.axisFloor(), this.split().top),
            Math.max(1, this.yDivisions()),
            this.valueFormat() === 'integer',
        ),
    );

    protected readonly yTicks = computed(() => {
        const top = this.axisTop();
        const n = Math.max(1, this.yDivisions());
        const fmt = barLabelFormat(this.valueFormat());
        return Array.from({ length: n + 1 }, (_, i) => formatKpiNumber(fmt, (top * (n - i)) / n));
    });

    /** Gap between groups: a month of days keeps its columns readable instead of 4px hairlines. */
    protected readonly density = computed<'normal' | 'dense' | 'very-dense'>(() => {
        const n = this.groups().length;
        return n > BAR_VERY_DENSE_GROUPS ? 'very-dense' : n > BAR_DENSE_GROUPS ? 'dense' : 'normal';
    });
    protected readonly columnsClass = computed(() => COLUMNS_CLASS[this.density()]);

    /** Text of a value in the tooltip / reading / table: full (money with cents) unless overridden. */
    readonly formatTooltip = input<((v: number) => string) | null>(null);

    /** Group being read (hover, tap, keyboard); null = none. */
    protected readonly active = signal<number | null>(null);
    private readonly width = injectHostWidth();

    protected readonly groups = computed<RenderedGroup[]>(() => {
        const series = this.series() ?? [];
        const labels = this.labels();
        const { bottom } = this.split();
        const top = this.showYAxis() ? this.axisTop() : this.split().top;
        const fmt = this.valueFormat();
        const short = barLabelFormat(fmt);
        // All zero (or nothing measured) is the empty copy, never an empty frame.
        const anyValue = series.some((s) => s.values.some((v) => v !== null && v !== undefined && v !== 0));
        if (!anyValue) return [];
        return labels.map((label, i) => {
            const columns = series.map((s) => {
                const v = s.values[i];
                const missing = v === null || v === undefined;
                const negative = !missing && v < 0;
                const band = negative ? bottom : top;
                return {
                    key: s.key,
                    color: s.color,
                    negative,
                    zero: !missing && v === 0,
                    pct: missing ? null : band > 0 ? (Math.abs(v) / band) * 100 : 0,
                    short: missing ? '' : formatKpiNumber(short, v),
                };
            });
            const rows = series.map((s) => ({
                key: s.key,
                label: s.label,
                color: s.color,
                value: this.cellText(s.values[i]),
            }));
            return {
                label,
                columns,
                rows,
                aria: `${label}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`,
                peak: Math.max(0, ...columns.map((c) => (c.negative || c.pct === null ? 0 : c.pct))),
            };
        });
    });

    /** Width the columns get: the host minus the y axis column. */
    private readonly plotWidth = computed(() => {
        const w = this.width();
        return w === null ? null : Math.max(1, w - (this.showYAxis() ? Y_AXIS_RESERVE_PX : 0));
    });

    /**
     * Every number on the columns has room by spacing alone. A zero column prints nothing, so a
     * sparse month of days (most of them empty) still gets its numbers.
     */
    private readonly allLabelsFit = computed(() => {
        const columns = this.groups().flatMap((g) => g.columns);
        const positions: number[] = [];
        columns.forEach((c, i) => {
            if (c.pct !== null && !c.zero) positions.push(i);
        });
        const maxChars = Math.max(0, ...columns.map((c) => (c.zero ? 0 : c.short.length)));
        return sparseLabelsFit(positions, columns.length, maxChars, this.plotWidth());
    });

    /**
     * Which columns carry their number (sm and up), per group then column. All of them when they
     * fit by spacing; otherwise, once measured and with no loss below zero, each number that
     * touches no other and sits on no column ({@link placeBarValues}). Two numbers never overlap.
     */
    protected readonly labelShown = computed<boolean[][]>(() => {
        const groups = this.groups();
        const all = (on: boolean) => groups.map((g) => g.columns.map(() => on));
        if (this.allLabelsFit()) return all(true);
        const plot = this.plotWidth();
        if (plot === null || this.split().down > 0) return all(false);
        return placeBarValues(
            groups.map((g) => g.columns),
            plot,
            this.heightPx() - X_ROW_PX - LABEL_ROOM_PX,
            { left: this.showYAxis() ? VALUE_EDGE_BY_AXIS_PX : VALUE_EDGE_BY_CARD_PX, right: VALUE_EDGE_BY_CARD_PX },
        );
    });

    /** Any number printed: the plot keeps the room above its tallest column for it. */
    protected readonly showLabels = computed(() => this.labelShown().some((g) => g.some(Boolean)));

    /** Widest x label as drawn (the bold active one left out, so reading a column never re-thins). */
    private readonly labelPx = injectLabelWidth('[data-x-label]:not(.font-semibold)', () => this.groups());

    /** Which x labels print: first, last and evenly between, never close enough to touch. */
    protected readonly xShown = computed<boolean[]>(() => {
        const groups = this.groups();
        const maxChars = Math.max(0, ...groups.map((g) => g.label.length));
        const step = axisLabelStep(groups.length, this.plotWidth(), this.labelPx(), maxChars);
        const shown = new Array<boolean>(groups.length).fill(false);
        for (const i of axisLabelIndices(groups.length, step)) shown[i] = true;
        return shown;
    });

    protected readonly activeTip = computed(() => {
        const i = this.active();
        const groups = this.groups();
        if (i === null || !groups[i]) return null;
        const g = groups[i];
        // Anchor: top of the tallest column, in % of the plot box (the x label row is small).
        const y = (this.split().up * (100 - g.peak)) / 100;
        return {
            title: g.label,
            rows: g.rows,
            x: ((i + 0.5) / groups.length) * 100,
            y,
            below: y < 35,
        };
    });

    protected onPointer(event: PointerEvent): void {
        const f = pointerFraction(event, event.currentTarget as Element);
        const i = f === null ? null : slotAt(f, this.groups().length);
        if (i !== null) this.active.set(i);
    }

    /** A mouse leaving closes the reading; a finger lifting keeps it (it was a tap). */
    protected onPointerLeave(event: PointerEvent): void {
        if (event.pointerType === 'mouse') this.active.set(null);
    }

    protected onFocus(): void {
        if (this.active() === null) this.active.set(Math.max(0, this.groups().length - 1));
    }

    protected onKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this.active.set(null);
            return;
        }
        const next = stepIndex(event.key, this.active(), this.groups().length);
        if (next === null) return;
        event.preventDefault();
        this.active.set(next);
    }

    protected cellText(v: number | null | undefined): string {
        return tooltipText(v, this.valueFormat(), this.formatTooltip());
    }

    protected readonly bars = computed<RenderedBar[]>(() => {
        const primary = this.data() ?? [];
        const secondary = this.secondaryData();
        const format = this.formatValue();
        const hasSecondary = !!secondary;
        const all: number[] = [
            ...primary.map((d) => d.value),
            ...(secondary ?? []).map((d) => d.value),
        ];
        const max = Math.max(1, ...all);
        return primary.map((d, i) => {
            const sec = secondary?.[i] ?? null;
            const gapCents = sec ? d.value - sec.value : 0;
            return {
                label: d.label,
                hint: d.hint ?? null,
                primaryPct: barPct(d.value, max),
                secondaryPct: sec ? barPct(sec.value, max) : null,
                primaryValue: format(d.value),
                secondaryValue: sec ? format(sec.value) : null,
                gapValue: sec && gapCents > 0 ? format(gapCents) : null,
                hasSecondary,
            };
        });
    });
}
