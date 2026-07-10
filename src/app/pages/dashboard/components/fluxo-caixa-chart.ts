import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DailyPointDto, formatBRL, formatShortDate } from '../../../types/dashboard.types';

interface Bucket {
    /** Start ISO date of the bucket (yyyy-MM-dd) — used as label + tooltip. */
    date: string;
    /** End ISO of the bucket (== date for daily buckets, later for weekly). */
    endDate: string;
    cents: number;
    /** True when the bucket lies fully in the past (realized). */
    realized: boolean;
}

interface RenderedBar {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    tooltip: string;
    bucket: Bucket;
}

interface Chart {
    width: number;
    height: number;
    bars: RenderedBar[];
    max: number;
    ariaLabel: string;
    startLabel: string;
    endLabel: string;
    peakLabel: string;
}

const WEEKLY_THRESHOLD_DAYS = 60;

function today(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Group daily points into weekly buckets when the series is long. Bucket start
 * = first day of the group (Monday-ish, but we just chunk in order, no calendar
 * alignment — good enough for this KPI).
 */
function bucketize(points: DailyPointDto[]): Bucket[] {
    if (points.length === 0) return [];
    const t = today();
    const grouped: Bucket[] = [];
    if (points.length <= WEEKLY_THRESHOLD_DAYS) {
        for (const p of points) {
            grouped.push({
                date: p.date,
                endDate: p.date,
                cents: p.cents,
                realized: p.date <= t,
            });
        }
        return grouped;
    }
    const size = 7;
    for (let i = 0; i < points.length; i += size) {
        const chunk = points.slice(i, i + size);
        const cents = chunk.reduce((s, x) => s + x.cents, 0);
        const end = chunk[chunk.length - 1].date;
        grouped.push({
            date: chunk[0].date,
            endDate: end,
            cents,
            // A weekly bucket is "realized" only if the whole week is in the past.
            realized: end <= t,
        });
    }
    return grouped;
}

@Component({
    selector: 'app-fluxo-caixa-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (chart(); as c) {
            <div class="flex justify-between items-baseline text-[11px] text-gray-500 mb-1 tabular-nums">
                <span>Pico: {{ c.peakLabel }}</span>
                <span class="hidden sm:flex gap-3 items-center">
                    <span class="flex items-center gap-1">
                        <span class="inline-block w-2.5 h-2.5 rounded bg-emerald-500"></span>
                        Realizado
                    </span>
                    <span class="flex items-center gap-1">
                        <span class="inline-block w-2.5 h-2.5 rounded bg-emerald-200"></span>
                        Previsto
                    </span>
                </span>
            </div>
            <svg
                [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height"
                class="w-full h-28 sm:h-32"
                preserveAspectRatio="none"
                role="img"
                [attr.aria-label]="c.ariaLabel"
            >
                @for (bar of c.bars; track bar.bucket.date) {
                    <rect
                        [attr.x]="bar.x"
                        [attr.y]="bar.y"
                        [attr.width]="bar.width"
                        [attr.height]="bar.height"
                        [attr.fill]="bar.fill"
                        rx="1"
                    >
                        <title>{{ bar.tooltip }}</title>
                    </rect>
                }
            </svg>
            <div class="flex justify-between items-baseline text-[10px] sm:text-xs text-gray-400 mt-2 tabular-nums">
                <span class="truncate">{{ c.startLabel }}</span>
                <span class="sm:hidden">Pico: {{ c.peakLabel }}</span>
                <span class="truncate">{{ c.endLabel }}</span>
            </div>
        } @else {
            <p class="text-sm text-gray-500 text-center py-10">Sem dados no período.</p>
        }
    `,
})
export class FluxoCaixaChart {
    readonly points = input.required<DailyPointDto[]>();
    readonly ariaLabel = input<string>('Fluxo de caixa por período');

    protected readonly chart = computed<Chart | null>(() => {
        const raw = this.points();
        if (!raw || raw.length === 0) return null;
        const buckets = bucketize(raw);
        if (buckets.length === 0) return null;

        const width = 600;
        const height = 120;
        const padX = 4;
        const padTop = 8;
        const padBottom = 4;
        const chartH = height - padTop - padBottom;
        const gap = 2;
        const totalGap = gap * (buckets.length - 1);
        const barWidth = Math.max(1, (width - padX * 2 - totalGap) / buckets.length);
        const max = Math.max(1, ...buckets.map((b) => b.cents));

        const bars: RenderedBar[] = buckets.map((b, i) => {
            const h = (b.cents / max) * chartH;
            return {
                x: padX + i * (barWidth + gap),
                y: padTop + (chartH - h),
                width: barWidth,
                height: Math.max(1, h),
                fill: b.realized ? '#10b981' : '#a7f3d0',
                bucket: b,
                tooltip: `${formatShortDate(b.date)}${b.endDate !== b.date ? ' — ' + formatShortDate(b.endDate) : ''}: ${formatBRL(b.cents)}${b.realized ? ' (realizado)' : ' (previsto)'}`,
            };
        });

        const first = buckets[0];
        const last = buckets[buckets.length - 1];
        return {
            width,
            height,
            bars,
            max,
            ariaLabel: this.ariaLabel(),
            startLabel: formatShortDate(first.date),
            endLabel: formatShortDate(last.endDate),
            peakLabel: formatBRL(max),
        };
    });
}
