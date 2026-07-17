import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { formatBRL, MonthlyPointDto } from '../../../types/dashboard.types';

interface RenderedBar {
    month: string;
    label: string;
    heightPct: number;
    value: string;
    isCurrent: boolean;
}

interface RenderedLolli {
    month: string;
    label: string;
    /** Center X in viewBox units. */
    cx: number;
    /** Y of the point (top of the stem). */
    cy: number;
    /** X of the pillar's top-left corner (cx - pillarWidth/2). */
    barX: number;
    /** Height of the pillar (baseline − cy). */
    barH: number;
    value: string;
    shortValue: string;
    isCurrent: boolean;
    /** True when this month's value is zero — skip pillar, render baseline dot only. */
    isZero: boolean;
}

interface YAxisTick {
    y: number;
    label: string;
}

const MONTH_LABELS_PT = [
    'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

// ViewBox geometry.
const VB_W = 320;
const VB_H = 160;
const PAD_L = 42;
const PAD_R = 8;
const PAD_T = 22;
const PAD_B = 26;
const PLOT_L = PAD_L;
const PLOT_R = VB_W - PAD_R;
const PLOT_T = PAD_T;
const PLOT_B = VB_H - PAD_B;
const PLOT_W = PLOT_R - PLOT_L;
const PLOT_H = PLOT_B - PLOT_T;
const PILLAR_W = 3;

/**
 * Vertical bar chart (default) or "lollipop" chart (`mode="line"`) for a
 * 6-month monthly series. Mobile-first, no chart lib.
 *
 * <p>Lollipop mode: each month is a slim translucent pillar with a solid dot
 * at the top. Zero months collapse to a hollow baseline dot — the visual
 * doesn't fabricate a "drop to zero" trend across sparse months.
 */
@Component({
    selector: 'app-monthly-billing-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="w-full min-w-0">
            @if (mode() === 'bar') {
                <div class="flex items-end gap-1 sm:gap-2 h-40" role="list">
                    @for (bar of bars(); track bar.month) {
                        <button
                            type="button"
                            role="listitem"
                            class="flex-1 min-w-0 flex flex-col items-center justify-end h-full rounded-md focus:outline-none focus:ring-2 focus:ring-primary-400"
                            [attr.aria-label]="bar.label + ': ' + bar.value"
                            [title]="bar.label + ' — ' + bar.value"
                            (click)="barClick.emit(bar.month)"
                        >
                            <span class="text-[10px] text-gray-500 tabular-nums mb-1 truncate w-full text-center">
                                {{ bar.value }}
                            </span>
                            <div
                                class="w-full rounded-t-md transition-all duration-500 min-h-[2px]"
                                [class.bg-primary-500]="bar.isCurrent"
                                [class.bg-primary-200]="!bar.isCurrent"
                                [style.height.%]="bar.heightPct"
                            ></div>
                        </button>
                    }
                </div>
                <div class="flex gap-1 sm:gap-2 mt-2">
                    @for (bar of bars(); track bar.month) {
                        <span class="flex-1 text-[10px] sm:text-xs text-gray-600 text-center truncate">
                            {{ bar.label }}
                        </span>
                    }
                </div>
            } @else {
                @if (isLineEmpty()) {
                    <div
                        class="w-full h-40 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 flex flex-col items-center justify-center text-center px-4"
                        role="status"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                             stroke-linejoin="round" class="text-neutral-400 mb-2" aria-hidden="true">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        <p class="text-sm font-medium text-neutral-700">
                            Sem aluguéis concluídos nos últimos 6 meses.
                        </p>
                        <p class="text-xs text-neutral-500 mt-1">
                            O ticket médio aparecerá aqui assim que houver aluguéis finalizados.
                        </p>
                    </div>
                } @else {
                    <figure class="w-full min-w-0 m-0">
                        <svg
                            [attr.viewBox]="viewBox"
                            preserveAspectRatio="xMidYMid meet"
                            class="w-full h-44 sm:h-52 overflow-visible"
                            role="img"
                            [attr.aria-label]="'Evolução do ticket médio, últimos 6 meses'"
                        >
                            <defs>
                                <linearGradient id="mbcPillar" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.55" />
                                    <stop offset="100%" stop-color="#6366f1" stop-opacity="0.08" />
                                </linearGradient>
                                <linearGradient id="mbcPillarCurrent" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#6366f1" stop-opacity="1" />
                                    <stop offset="100%" stop-color="#6366f1" stop-opacity="0.28" />
                                </linearGradient>
                            </defs>

                            <!-- Y-axis reference lines (very subtle) -->
                            @for (tick of yTicks(); track tick.y) {
                                <line
                                    [attr.x1]="plotL"
                                    [attr.x2]="plotR"
                                    [attr.y1]="tick.y"
                                    [attr.y2]="tick.y"
                                    stroke="#f2f3f6"
                                    stroke-width="1"
                                />
                            }

                            <!-- Y-axis labels -->
                            @for (tick of yTicks(); track tick.y) {
                                <text
                                    [attr.x]="plotL - 10"
                                    [attr.y]="tick.y + 3"
                                    text-anchor="end"
                                    font-size="9"
                                    fill="#9ca3af"
                                    style="font-variant-numeric: tabular-nums; letter-spacing: 0.3px;"
                                >
                                    {{ tick.label }}
                                </text>
                            }

                            <!-- Baseline -->
                            <line
                                [attr.x1]="plotL"
                                [attr.x2]="plotR"
                                [attr.y1]="plotB"
                                [attr.y2]="plotB"
                                stroke="#d1d5db"
                                stroke-width="1"
                            />

                            <!-- Pillars + dots -->
                            @for (l of lollipops(); track l.month) {
                                <g tabindex="0" focusable="true" class="focus:outline-none">
                                    @if (!l.isZero) {
                                        <rect
                                            [attr.x]="l.barX"
                                            [attr.y]="l.cy"
                                            [attr.width]="pillarWidth"
                                            [attr.height]="l.barH"
                                            [attr.rx]="pillarWidth / 2"
                                            [attr.fill]="l.isCurrent ? 'url(#mbcPillarCurrent)' : 'url(#mbcPillar)'"
                                        />
                                    }

                                    @if (l.isZero) {
                                        <circle
                                            [attr.cx]="l.cx"
                                            [attr.cy]="plotB"
                                            r="3"
                                            fill="#ffffff"
                                            stroke="#d1d5db"
                                            stroke-width="1.25"
                                        >
                                            <title>{{ l.label }} — {{ l.value }}</title>
                                        </circle>
                                    } @else if (l.isCurrent) {
                                        <circle
                                            [attr.cx]="l.cx"
                                            [attr.cy]="l.cy"
                                            r="9"
                                            fill="#6366f1"
                                            fill-opacity="0.14"
                                        />
                                        <circle
                                            [attr.cx]="l.cx"
                                            [attr.cy]="l.cy"
                                            r="4.5"
                                            fill="#6366f1"
                                            stroke="#ffffff"
                                            stroke-width="2"
                                        >
                                            <title>{{ l.label }} — {{ l.value }}</title>
                                        </circle>
                                    } @else {
                                        <circle
                                            [attr.cx]="l.cx"
                                            [attr.cy]="l.cy"
                                            r="3.75"
                                            fill="#6366f1"
                                            stroke="#ffffff"
                                            stroke-width="1.75"
                                        >
                                            <title>{{ l.label }} — {{ l.value }}</title>
                                        </circle>
                                    }
                                </g>
                            }

                            <!-- Value above the current-month dot -->
                            @for (l of lollipops(); track l.month) {
                                @if (l.isCurrent && !l.isZero) {
                                    <text
                                        [attr.x]="l.cx"
                                        [attr.y]="l.cy - 12"
                                        text-anchor="middle"
                                        font-size="10.5"
                                        font-weight="600"
                                        fill="#4f46e5"
                                        style="font-variant-numeric: tabular-nums; letter-spacing: 0.2px;"
                                    >
                                        {{ l.shortValue }}
                                    </text>
                                }
                            }

                            <!-- X-axis month labels -->
                            @for (l of lollipops(); track l.month) {
                                <text
                                    [attr.x]="l.cx"
                                    [attr.y]="plotB + 16"
                                    text-anchor="middle"
                                    font-size="9.5"
                                    [attr.fill]="l.isCurrent ? '#4f46e5' : '#6b7280'"
                                    [attr.font-weight]="l.isCurrent ? '600' : '400'"
                                    style="font-variant-numeric: tabular-nums; letter-spacing: 0.3px;"
                                >
                                    {{ l.label }}
                                </text>
                            }
                        </svg>
                    </figure>
                }
            }
        </div>
    `,
})
export class MonthlyBillingChart {
    readonly data = input.required<MonthlyPointDto[]>();
    readonly mode = input<'bar' | 'line'>('bar');
    readonly barClick = output<string>();

    protected readonly viewBox = `0 0 ${VB_W} ${VB_H}`;
    protected readonly plotL = PLOT_L;
    protected readonly plotR = PLOT_R;
    protected readonly plotB = PLOT_B;
    protected readonly pillarWidth = PILLAR_W;

    protected readonly bars = computed<RenderedBar[]>(() => {
        const rows = this.data() ?? [];
        const max = Math.max(1, ...rows.map((r) => r.amountCents));
        const currentMonth = this.currentMonthKey();
        return rows.map((r) => {
            const { label, isCurrent } = this.monthMeta(r.month, currentMonth);
            return {
                month: r.month,
                label,
                heightPct: (r.amountCents / max) * 100,
                value: formatBRL(r.amountCents),
                isCurrent,
            };
        });
    });

    protected readonly isLineEmpty = computed<boolean>(() => {
        const rows = this.data() ?? [];
        if (rows.length === 0) return true;
        return rows.every((r) => (r.amountCents ?? 0) === 0);
    });

    private readonly yDomain = computed<{ min: number; max: number }>(() => {
        const rows = this.data() ?? [];
        if (rows.length === 0) return { min: 0, max: 1 };
        const values = rows.map((r) => r.amountCents ?? 0);
        const rawMax = Math.max(...values);
        // Y always anchored at zero — comparability > compactness for financial series.
        const max = rawMax === 0 ? 1 : rawMax * 1.15;
        return { min: 0, max };
    });

    protected readonly yTicks = computed<YAxisTick[]>(() => {
        const { min, max } = this.yDomain();
        if (max <= min) return [];
        // 3 ticks: 100%, 50%, 0%.
        const values = [max, (max + min) / 2, min];
        return values.map((v) => {
            const norm = (v - min) / (max - min);
            const y = PLOT_B - norm * PLOT_H;
            return { y, label: this.formatShortBRL(v) };
        });
    });

    protected readonly lollipops = computed<RenderedLolli[]>(() => {
        const rows = this.data() ?? [];
        if (rows.length === 0) return [];
        const { min, max } = this.yDomain();
        const span = max - min || 1;
        const currentMonth = this.currentMonthKey();
        const stepX = rows.length === 1 ? 0 : PLOT_W / (rows.length - 1);
        return rows.map((r, i) => {
            const value = r.amountCents ?? 0;
            const norm = (value - min) / span;
            const cy = PLOT_B - norm * PLOT_H;
            const cx = rows.length === 1 ? (PLOT_L + PLOT_R) / 2 : PLOT_L + i * stepX;
            const barH = Math.max(0, PLOT_B - cy);
            const { label, isCurrent } = this.monthMeta(r.month, currentMonth);
            return {
                month: r.month,
                label,
                cx,
                cy,
                barX: cx - PILLAR_W / 2,
                barH,
                value: formatBRL(value),
                shortValue: this.formatShortBRL(value),
                isCurrent,
                isZero: value === 0,
            };
        });
    });

    private formatShortBRL(cents: number): string {
        const reais = (cents ?? 0) / 100;
        const abs = Math.abs(reais);
        if (abs >= 1_000_000) {
            return `R$ ${(reais / 1_000_000).toFixed(1).replace('.', ',')}M`;
        }
        if (abs >= 1_000) {
            return `R$ ${(reais / 1_000).toFixed(1).replace('.', ',')}k`;
        }
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            maximumFractionDigits: 0,
        }).format(reais);
    }

    private monthMeta(monthKey: string, currentMonth: string): { label: string; isCurrent: boolean } {
        const [year, month] = monthKey.split('-');
        const monthIdx = Math.max(0, Math.min(11, Number(month) - 1));
        const shortYear = year.slice(2);
        return {
            label: `${MONTH_LABELS_PT[monthIdx]}/${shortYear}`,
            isCurrent: monthKey === currentMonth,
        };
    }

    private currentMonthKey(): string {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }
}
