import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DailyPointDto, formatBRL, formatShortDate } from '../../../types/dashboard.types';

interface SparkPoint {
    x: number;
    y: number;
    raw: DailyPointDto;
}

interface Spark {
    path: string;
    area: string;
    points: SparkPoint[];
    max: number;
    width: number;
    height: number;
}

@Component({
    selector: 'app-sparkline-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (spark(); as s) {
            <svg
                [attr.viewBox]="'0 0 ' + s.width + ' ' + s.height"
                class="w-full h-20 sm:h-24"
                preserveAspectRatio="none"
                role="img"
                [attr.aria-label]="ariaLabel()"
            >
                <defs>
                    <linearGradient id="dashSparkGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#10b981" stop-opacity="0.35" />
                        <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
                    </linearGradient>
                </defs>
                <path [attr.d]="s.area" fill="url(#dashSparkGradient)" />
                <path
                    [attr.d]="s.path"
                    fill="none"
                    stroke="#10b981"
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                />
                @for (p of s.points; track p.raw.date) {
                    @if (p.raw.cents > 0) {
                        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" fill="#10b981">
                            <title>{{ pointLabel(p.raw) }}</title>
                        </circle>
                    }
                }
            </svg>
            <div class="flex justify-between items-center gap-2 text-[10px] sm:text-xs text-gray-400 mt-2 tabular-nums">
                <span class="truncate">{{ dayLabel(s.points[0].raw.date) }}</span>
                <span class="hidden sm:inline truncate">pico: {{ formatCents(s.max) }}</span>
                <span class="truncate">{{ dayLabel(s.points[s.points.length - 1].raw.date) }}</span>
            </div>
        } @else {
            <p class="text-sm text-gray-500 text-center py-10">Sem dados no período.</p>
        }
    `,
})
export class SparklineChart {
    readonly points = input.required<DailyPointDto[]>();
    readonly ariaLabel = input<string>('Série diária');

    protected readonly spark = computed<Spark | null>(() => {
        const days = this.points();
        if (!days || days.length === 0) return null;
        const width = 600;
        const height = 60;
        const padX = 4;
        const padY = 6;
        const max = Math.max(1, ...days.map((d) => d.cents));
        const step = (width - padX * 2) / Math.max(1, days.length - 1);
        const pts: SparkPoint[] = days.map((d, i) => ({
            raw: d,
            x: padX + i * step,
            y: padY + (height - padY * 2) * (1 - d.cents / max),
        }));
        const path = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ');
        const first = pts[0];
        const last = pts[pts.length - 1];
        const area = `${path} L${last.x.toFixed(1)},${(height - padY).toFixed(1)} L${first.x.toFixed(1)},${(height - padY).toFixed(1)} Z`;
        return { path, area, points: pts, max, width, height };
    });

    protected dayLabel(iso: string): string {
        return formatShortDate(iso);
    }

    protected formatCents(cents: number): string {
        return formatBRL(cents);
    }

    protected pointLabel(p: DailyPointDto): string {
        return `${formatShortDate(p.date)}: ${formatBRL(p.cents)}`;
    }
}
