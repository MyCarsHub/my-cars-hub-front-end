import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MonthlyResultDto, formatBRL } from '../../../types/dashboard.types';
import { moneyAxisTopFor } from '../../../utils/money-axis';

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface ResultBar {
    month: string;
    label: string;
    revenueText: string;
    profitText: string;
    revenuePct: number;
    profitPct: number;
    profitNegative: boolean;
    aria: string;
}

/** Pure: `2026-06` -> `jun/26`. */
export function resultMonthLabel(key: string): string {
    const [y, m] = key.split('-');
    return `${MONTH_SHORT[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

/** Pure: `R$ 1,5k` style label for a bar head. */
export function shortBrl(cents: number): string {
    const reais = cents / 100;
    const abs = Math.abs(reais);
    if (abs >= 1_000_000) return `R$ ${(reais / 1_000_000).toFixed(1).replace('.', ',')}M`;
    if (abs >= 1_000) return `R$ ${(reais / 1_000).toFixed(1).replace('.', ',')}k`;
    return `R$ ${Math.round(reais).toLocaleString('pt-BR')}`;
}

/**
 * Received x profit, one pair of bars per month (the dashboard prototype's "Recebido vs lucro").
 * The ONLY place the dashboard draws revenue by month: the tap on a month is the month selector,
 * so there are no pills under it. Both bars share one money axis anchored at zero; a negative
 * profit draws no bar (the axis starts at zero) but keeps its signed text, so a loss is never
 * hidden. When every month is zero the chart is replaced by a sentence instead of a row of
 * flat bars.
 */
@Component({
    selector: 'app-monthly-result-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'flex flex-col min-w-0' },
    template: `
        <ul class="flex gap-3 text-xs text-fg-muted mb-3 sm:hidden" aria-label="Legenda">
            <li class="inline-flex items-center gap-1.5">
                <span class="size-2.5 rounded-[3px]" aria-hidden="true" style="background-color: #F63B04"></span>
                Recebido
            </li>
            <li class="inline-flex items-center gap-1.5">
                <span class="size-2.5 rounded-[3px]" aria-hidden="true" style="background-color: #0a9b62"></span>
                Lucro
            </li>
        </ul>
        @if (!empty() && activeBar(); as ab) {
            <!--
                Phones: ~50px per month cannot hold two money labels side by side (they printed
                over each other: "R$ 14R$ 14,5k"). The value of the highlighted month is read here,
                one line, and the bars carry no text; from sm up the labels sit on the bars.
            -->
            <p data-active-readout class="sm:hidden mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-fg-muted tabular-nums" aria-hidden="true">
                <b class="font-semibold text-fg">{{ ab.label }}</b>
                <span>Recebido <b class="font-semibold text-fg">{{ ab.revenueText }}</b></span>
                <span>Lucro <b class="font-semibold" [class.text-fg]="!ab.profitNegative" [class.text-rose-500]="ab.profitNegative">{{ ab.profitText }}</b></span>
            </p>
        }
        @if (empty()) {
            <div
                data-empty
                role="status"
                class="flex-1 min-h-44 flex flex-col items-center justify-center gap-2 text-center text-sm text-fg-subtle px-4"
            >
                <p>Ainda sem recebimentos nos últimos 6 meses. Os números aparecem aqui assim que houver pagamentos.</p>
                @if (losses().length) {
                    <p data-losses class="text-xs text-rose-500">Resultado negativo: {{ losses().join(' · ') }}</p>
                }
            </div>
        } @else {
            <div class="flex items-stretch gap-1.5 sm:gap-2.5 flex-1 min-h-56 sm:min-h-72 [--bar-k:1] sm:[--bar-k:0.82]" role="list" data-bars>
                @for (bar of bars(); track bar.month; let i = $index) {
                    <button
                        type="button"
                        role="listitem"
                        data-month-bar
                        class="flex-1 min-w-0 flex flex-col justify-end items-center gap-1.5 rounded-xl px-1 pt-1.5 pb-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                        [class.bg-gray-100]="bar.month === active()"
                        [class.dark:bg-white/10]="bar.month === active()"
                        [attr.aria-label]="bar.aria"
                        [attr.aria-pressed]="bar.month === active()"
                        (click)="monthSelect.emit(bar.month)"
                    >
                        <div class="flex items-stretch gap-1 w-full flex-1 min-h-0">
                            <div class="flex-1 min-w-0 flex flex-col justify-end items-center gap-1">
                                <span data-bar-value class="hidden sm:inline text-[10px] text-fg-muted tabular-nums whitespace-nowrap" [class.text-fg]="bar.month === active()" [class.font-semibold]="bar.month === active()">{{ bar.revenueText }}</span>
                                <div
                                    class="bar-rise w-full rounded-t-lg rounded-b-sm min-h-[2px]"
                                    style="background-color: #F63B04"
                                    [style.--stagger-i]="i"
                                    [style.height]="'calc(' + bar.revenuePct + '% * var(--bar-k))'"
                                ></div>
                            </div>
                            <div class="flex-1 min-w-0 flex flex-col justify-end items-center gap-1">
                                <span
                                    data-bar-value
                                    class="hidden sm:inline text-[10px] tabular-nums whitespace-nowrap"
                                    [class.text-fg-muted]="!bar.profitNegative"
                                    [class.text-rose-500]="bar.profitNegative"
                                    >{{ bar.profitText }}</span
                                >
                                <div
                                    class="bar-rise w-full rounded-t-lg rounded-b-sm min-h-[2px]"
                                    style="background-color: #0a9b62"
                                    [style.--stagger-i]="i"
                                    [style.height]="'calc(' + bar.profitPct + '% * var(--bar-k))'"
                                ></div>
                            </div>
                        </div>
                        <span class="text-xs text-fg-muted" [class.text-fg]="bar.month === active()" [class.font-bold]="bar.month === active()" data-month-label>{{ bar.label }}</span>
                    </button>
                }
            </div>
        }
    `,
})
export class MonthlyResultChart {
    readonly months = input.required<readonly MonthlyResultDto[]>();
    /** Month (`yyyy-MM`) whose detail is open; highlighted. */
    readonly selected = input<string | null>(null);
    readonly monthSelect = output<string>();

    /** The tapped month; until one is tapped, the newest month (the period the dashboard opens on). */
    protected readonly active = computed(() => this.selected() ?? this.months().at(-1)?.month ?? null);

    protected readonly activeBar = computed(() => this.bars().find((b) => b.month === this.active()) ?? null);

    protected readonly empty = computed(() =>
        this.months().every((m) => !(m.revenueCents > 0) && !(m.profitCents > 0)),
    );

    /** A loss draws no bar, so with nothing else to draw it is said in words, never hidden. */
    protected readonly losses = computed(() =>
        this.months()
            .filter((m) => m.profitCents < 0)
            .map((m) => `${resultMonthLabel(m.month)} ${formatBRL(m.profitCents)}`),
    );

    protected readonly bars = computed<ResultBar[]>(() => {
        const rows = this.months();
        const top = moneyAxisTopFor(rows.flatMap((m) => [m.revenueCents, m.profitCents]));
        return rows.map((m) => {
            const label = resultMonthLabel(m.month);
            return {
                month: m.month,
                label,
                revenueText: shortBrl(m.revenueCents),
                profitText: shortBrl(m.profitCents),
                revenuePct: (Math.max(0, m.revenueCents) / top) * 100,
                profitPct: (Math.max(0, m.profitCents) / top) * 100,
                profitNegative: m.profitCents < 0,
                aria: `${label}: recebido ${formatBRL(m.revenueCents)}, lucro ${formatBRL(m.profitCents)}`,
            };
        });
    });
}
