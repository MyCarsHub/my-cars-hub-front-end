import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { CashflowEventDto, formatBRL, formatDate } from '../../../types/dashboard.types';

interface KindMeta {
    label: string;
    color: string;
}

const KIND_META: Record<CashflowEventDto['kind'], KindMeta> = {
    RENTAL_RECEIPT: { label: 'Recebimento de aluguel', color: 'text-emerald-700' },
    MAINTENANCE_PAID: { label: 'Manutenção paga', color: 'text-red-700' },
    MAINTENANCE_SCHEDULED: { label: 'Manutenção agendada', color: 'text-amber-700' },
    FINE_PAID: { label: 'Multa paga', color: 'text-red-700' },
    FINE_DUE: { label: 'Multa a vencer', color: 'text-amber-700' },
};

/**
 * Sheet-style panel listing every cashflow event of a single day.
 * Rendered as a modal on mobile (bottom sheet) and as a right-hand drawer on
 * desktop — layout is CSS-driven in the parent template.
 */
@Component({
    selector: 'app-cashflow-day-sheet',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (date(); as d) {
            <div class="fixed inset-0 z-40 flex items-end sm:items-center sm:justify-end">
                <button
                    type="button"
                    class="absolute inset-0 bg-black/40"
                    aria-label="Fechar"
                    (click)="close.emit()"
                ></button>
                <div
                    role="dialog"
                    aria-modal="true"
                    class="relative z-10 bg-white w-full sm:w-96 sm:h-full max-h-[85vh]
                           rounded-t-2xl sm:rounded-t-none sm:rounded-l-2xl shadow-2xl
                           overflow-hidden flex flex-col"
                >
                    <header class="p-4 border-b border-gray-100 flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-xs text-gray-500 uppercase tracking-wide">Detalhes do dia</p>
                            <p class="text-base font-semibold text-gray-900 truncate">
                                {{ formattedDate() }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="min-h-[44px] min-w-[44px] rounded-lg hover:bg-gray-100 flex
                                   items-center justify-center text-gray-500"
                            aria-label="Fechar"
                            (click)="close.emit()"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </header>

                    <div class="px-4 py-3 grid grid-cols-2 gap-3 border-b border-gray-100">
                        <div>
                            <p class="text-[10px] text-gray-500 uppercase tracking-wide">A receber</p>
                            <p class="text-sm font-semibold text-emerald-600 tabular-nums truncate">
                                {{ inTotalLabel() }}
                            </p>
                        </div>
                        <div>
                            <p class="text-[10px] text-gray-500 uppercase tracking-wide">A pagar</p>
                            <p class="text-sm font-semibold text-red-600 tabular-nums truncate">
                                {{ outTotalLabel() }}
                            </p>
                        </div>
                    </div>

                    <ul class="overflow-y-auto p-4 space-y-3">
                        @for (e of events(); track $index) {
                            <li class="rounded-xl border border-gray-100 p-3">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <p
                                            class="text-[11px] font-medium"
                                            [class]="kindMeta(e).color"
                                        >
                                            {{ kindMeta(e).label }}
                                        </p>
                                        <p class="text-sm text-gray-900 truncate">{{ e.label }}</p>
                                    </div>
                                    <p
                                        class="text-sm font-semibold tabular-nums whitespace-nowrap"
                                        [class.text-emerald-600]="e.direction === 'IN'"
                                        [class.text-red-600]="e.direction === 'OUT'"
                                    >
                                        {{ e.direction === 'IN' ? '+ ' : '- ' }}{{ money(e.amountCents) }}
                                    </p>
                                </div>
                            </li>
                        } @empty {
                            <li class="text-sm text-gray-500 text-center py-6">
                                Nenhum evento neste dia.
                            </li>
                        }
                    </ul>
                </div>
            </div>
        }
    `,
})
export class CashflowDaySheet {
    readonly date = input<string | null>(null);
    readonly events = input<CashflowEventDto[]>([]);

    readonly close = output<void>();

    protected readonly formattedDate = computed(() => {
        const d = this.date();
        return d ? formatDate(d) : '';
    });

    protected readonly inTotalLabel = computed(() =>
        formatBRL(this.events().filter((e) => e.direction === 'IN').reduce((s, e) => s + e.amountCents, 0)),
    );

    protected readonly outTotalLabel = computed(() =>
        formatBRL(this.events().filter((e) => e.direction === 'OUT').reduce((s, e) => s + e.amountCents, 0)),
    );

    protected kindMeta(e: CashflowEventDto): KindMeta {
        return KIND_META[e.kind] ?? { label: e.kind, color: 'text-gray-700' };
    }

    protected money(cents: number): string {
        return formatBRL(cents);
    }
}
