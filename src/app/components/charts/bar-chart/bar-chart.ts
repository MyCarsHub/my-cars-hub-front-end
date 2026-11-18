import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatBRL } from '../../../types/dashboard.types';
import { formatKpiNumber, type KpiNumberFormat } from '../../kpi-card/kpi-card';

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
    readonly title: string;
}

interface RenderedGroup {
    readonly label: string;
    readonly columns: readonly RenderedColumn[];
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
 * {@link formatValue} to override (e.g. to render raw counts).
 */
@Component({
    selector: 'app-bar-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'block min-w-0' },
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
                <div data-bar-columns class="flex items-stretch gap-1.5 sm:gap-2 min-w-0" aria-hidden="true" [style.height.px]="heightPx()">
                    @for (g of groups(); track g.label; let gi = $index) {
                        <div data-bar-group class="flex-1 min-w-0 flex flex-col items-center gap-1.5">
                            <div class="w-full flex-1 min-h-0 flex flex-col">
                                <div class="w-full flex items-end gap-0.5" [style.height.%]="split().up">
                                    @for (c of g.columns; track c.key) {
                                        <span
                                            data-bar-column
                                            class="bar-rise flex-1 min-w-0 rounded-t-[4px]"
                                            [style.--stagger-i]="gi"
                                            [style.height.%]="c.negative || c.pct === null ? 0 : c.pct"
                                            [style.background-color]="c.color"
                                            [attr.title]="c.title"
                                        ></span>
                                    }
                                </div>
                                @if (split().down > 0) {
                                    <div class="w-full flex items-start gap-0.5" [style.height.%]="split().down">
                                        @for (c of g.columns; track c.key) {
                                            <span
                                                data-bar-negative
                                                class="flex-1 min-w-0 rounded-b-[4px]"
                                                [style.height.%]="c.negative && c.pct !== null ? c.pct : 0"
                                                [style.background-color]="c.color"
                                                [attr.title]="c.negative ? c.title : null"
                                            ></span>
                                        }
                                    </div>
                                }
                            </div>
                            <span class="text-[10px] sm:text-[11px] text-fg-muted whitespace-nowrap">{{ g.label }}</span>
                        </div>
                    }
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
                        class="h-2 rounded-full bg-gray-100 dark:bg-surface-sunken overflow-hidden"
                        [attr.aria-label]="bar.label + ': ' + bar.primaryValue"
                    >
                        <div
                            class="h-full rounded-full bg-primary-500 transition-all duration-500"
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
                        <div class="h-2 rounded-full bg-gray-100 dark:bg-surface-sunken overflow-hidden mt-1">
                            <div
                                class="h-full rounded-full bg-emerald-500 transition-all duration-500"
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
    /** How a value becomes text in the columns layout (tooltip and screen-reader table). */
    readonly valueFormat = input<KpiNumberFormat>('brl-cents');
    readonly heightPx = input(180);
    readonly ariaLabel = input('Gráfico de barras');
    readonly legend = input(true);
    readonly emptyText = input('Sem dados no período.');

    protected readonly split = computed(() => zeroSplit(this.series() ?? []));

    protected readonly groups = computed<RenderedGroup[]>(() => {
        const series = this.series() ?? [];
        const labels = this.labels();
        const { top, bottom } = this.split();
        const fmt = this.valueFormat();
        const anyValue = series.some((s) => s.values.some((v) => v !== null && v !== undefined));
        if (!anyValue) return [];
        return labels.map((label, i) => ({
            label,
            columns: series.map((s) => {
                const v = s.values[i];
                const missing = v === null || v === undefined;
                const negative = !missing && v < 0;
                const band = negative ? bottom : top;
                return {
                    key: s.key,
                    color: s.color,
                    negative,
                    pct: missing ? null : band > 0 ? (Math.abs(v) / band) * 100 : 0,
                    title: `${s.label} ${label}: ${missing ? 'sem dado' : formatKpiNumber(fmt, v)}`,
                };
            }),
        }));
    });

    protected cellText(v: number | null | undefined): string {
        return v === null || v === undefined ? 'sem dado' : formatKpiNumber(this.valueFormat(), v);
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
