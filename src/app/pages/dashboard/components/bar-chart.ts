import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatBRL } from '../../../types/dashboard.types';

export interface BarDatum {
    label: string;
    value: number;
    /** Optional tooltip / helper line (e.g. subtitle like brand + model). */
    hint?: string;
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
    template: `
        <div class="space-y-3 min-w-0">
            @for (bar of bars(); track bar.label) {
                <div class="min-w-0">
                    <div class="flex justify-between items-baseline gap-2 text-xs mb-1 min-w-0">
                        <span class="text-gray-700 truncate min-w-0">{{ bar.label }}</span>
                        <span class="text-gray-900 font-medium tabular-nums shrink-0">
                            {{ bar.primaryValue }}
                        </span>
                    </div>
                    @if (bar.hint) {
                        <p class="text-[10px] text-gray-500 mb-1 truncate">{{ bar.hint }}</p>
                    }
                    <div
                        class="h-2 rounded-full bg-gray-100 overflow-hidden"
                        [attr.aria-label]="bar.label + ': ' + bar.primaryValue"
                    >
                        <div
                            class="h-full rounded-full bg-primary-500 transition-all duration-500"
                            [style.width.%]="bar.primaryPct"
                        ></div>
                    </div>
                    @if (bar.hasSecondary) {
                        <div class="flex justify-between items-baseline gap-2 text-[11px] mt-1 min-w-0">
                            <span class="text-gray-500 truncate">Recebido</span>
                            <span class="text-emerald-600 tabular-nums font-medium shrink-0">
                                {{ bar.secondaryValue }}
                            </span>
                        </div>
                        <div class="h-2 rounded-full bg-gray-100 overflow-hidden mt-1">
                            <div
                                class="h-full rounded-full bg-emerald-500 transition-all duration-500"
                                [style.width.%]="bar.secondaryPct"
                            ></div>
                        </div>
                        @if (bar.gapValue) {
                            <p class="text-[11px] text-red-600 mt-1 tabular-nums">
                                Inadimplência: {{ bar.gapValue }}
                            </p>
                        }
                    }
                </div>
            } @empty {
                <p class="text-sm text-gray-500 text-center py-6">Sem dados no período.</p>
            }
        </div>
    `,
})
export class BarChart {
    readonly data = input.required<BarDatum[]>();
    /** Optional second series (same length + label order). */
    readonly secondaryData = input<BarDatum[] | null>(null);
    readonly formatValue = input<(v: number) => string>((v) => formatBRL(v));

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
                primaryPct: (d.value / max) * 100,
                secondaryPct: sec ? (sec.value / max) * 100 : null,
                primaryValue: format(d.value),
                secondaryValue: sec ? format(sec.value) : null,
                gapValue: sec && gapCents > 0 ? format(gapCents) : null,
                hasSecondary,
            };
        });
    });
}
