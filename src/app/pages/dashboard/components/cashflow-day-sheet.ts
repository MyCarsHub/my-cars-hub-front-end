import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import {
    CashflowEventDto,
    CashflowKind,
    formatBRL,
    formatDate,
} from '../../../types/dashboard.types';

/** Desenho do ícone da linha (traço 2, 24x24). */
export type CashflowIcon =
    | 'rental'
    | 'maintenance'
    | 'fine'
    | 'ipva'
    | 'insurance'
    | 'financing'
    | 'expense';

export interface KindMeta {
    label: string;
    /** Cor do rótulo do tipo. */
    color: string;
    /** Fundo + cor do quadradinho do ícone — a única superfície tingida da linha. */
    chip: string;
    icon: CashflowIcon;
}

/*
 * PAGO = vermelho (o dinheiro saiu), A VENCER = âmbar (ainda vai sair): o mesmo par de
 * FINE_PAID/FINE_DUE vale para IPVA, seguro e financiamento. Classes por extenso para o
 * Tailwind achá-las no fonte.
 */
const IN_LOOK = {
    color: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};
const PAID_LOOK = {
    color: 'text-red-700 dark:text-red-300',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};
const DUE_LOOK = {
    color: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

export const CASHFLOW_KIND_META: Record<CashflowKind, KindMeta> = {
    RENTAL_RECEIPT_PAID: { label: 'Aluguel recebido', ...IN_LOOK, icon: 'rental' },
    RENTAL_RECEIPT_DUE: { label: 'Aluguel a receber', ...DUE_LOOK, icon: 'rental' },
    RENTAL_RECEIPT_OVERDUE: { label: 'Aluguel em atraso', ...PAID_LOOK, icon: 'rental' },
    DEPOSIT_RECEIPT_PAID: { label: 'Caução recebida', ...IN_LOOK, icon: 'rental' },
    DEPOSIT_RECEIPT_DUE: { label: 'Caução a receber', ...DUE_LOOK, icon: 'rental' },
    DEPOSIT_RECEIPT_OVERDUE: { label: 'Caução em atraso', ...PAID_LOOK, icon: 'rental' },
    MAINTENANCE_PAID: { label: 'Manutenção paga', ...PAID_LOOK, icon: 'maintenance' },
    MAINTENANCE_SCHEDULED: { label: 'Manutenção agendada', ...DUE_LOOK, icon: 'maintenance' },
    FINE_PAID: { label: 'Multa paga', ...PAID_LOOK, icon: 'fine' },
    FINE_DUE: { label: 'Multa a vencer', ...DUE_LOOK, icon: 'fine' },
    IPVA_PAID: { label: 'IPVA pago', ...PAID_LOOK, icon: 'ipva' },
    IPVA_DUE: { label: 'IPVA a vencer', ...DUE_LOOK, icon: 'ipva' },
    INSURANCE_PAID: { label: 'Seguro pago', ...PAID_LOOK, icon: 'insurance' },
    INSURANCE_DUE: { label: 'Seguro a vencer', ...DUE_LOOK, icon: 'insurance' },
    FINANCING_PAID: { label: 'Parcela de financiamento paga', ...PAID_LOOK, icon: 'financing' },
    EXPENSE_PAID: { label: 'Gasto pago', ...PAID_LOOK, icon: 'expense' },
    FINANCING_DUE: { label: 'Parcela de financiamento a vencer', ...DUE_LOOK, icon: 'financing' },
};

/** Meta de um tipo; um tipo desconhecido (backend mais novo) cai num neutro com o nome cru. */
export function cashflowKindMeta(kind: string): KindMeta {
    return (
        CASHFLOW_KIND_META[kind as CashflowKind] ?? {
            label: kind,
            color: 'text-gray-700 dark:text-fg-soft',
            chip: 'bg-gray-100 text-gray-600 dark:bg-surface-sunken dark:text-fg-muted',
            icon: 'rental',
        }
    );
}

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
                    class="relative z-10 bg-surface w-full sm:w-96 sm:h-full max-h-[85vh]
                           rounded-t-2xl sm:rounded-t-none sm:rounded-l-2xl shadow-2xl
                           overflow-hidden flex flex-col"
                >
                    <header class="p-4 border-b border-gray-100 dark:border-edge-soft flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-xs text-gray-500 dark:text-fg-subtle uppercase tracking-wide">Detalhes do dia</p>
                            <p class="text-base font-semibold text-gray-900 dark:text-fg truncate">
                                {{ formattedDate() }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="min-h-[44px] min-w-[44px] rounded-lg hover:bg-gray-100 dark:hover:bg-surface-sunken flex
                                   items-center justify-center text-gray-500 dark:text-fg-subtle"
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

                    <div class="px-4 py-3 grid grid-cols-2 gap-3 border-b border-gray-100 dark:border-edge-soft">
                        <div>
                            <p class="text-[10px] text-gray-500 dark:text-fg-subtle uppercase tracking-wide">A receber</p>
                            <p class="text-sm font-semibold text-emerald-600 dark:text-emerald-300 tabular-nums truncate">
                                {{ inTotalLabel() }}
                            </p>
                        </div>
                        <div>
                            <p class="text-[10px] text-gray-500 dark:text-fg-subtle uppercase tracking-wide">A pagar</p>
                            <p class="text-sm font-semibold text-red-600 dark:text-red-300 tabular-nums truncate">
                                {{ outTotalLabel() }}
                            </p>
                        </div>
                    </div>

                    <ul class="overflow-y-auto p-4 space-y-3">
                        @for (e of events(); track $index) {
                            <li class="rounded-xl border border-gray-100 dark:border-edge-soft p-3">
                                <div class="flex items-start gap-3" [attr.data-cashflow-kind]="e.kind">
                                    <span
                                        class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center"
                                        [class]="kindMeta(e).chip"
                                        aria-hidden="true"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" stroke-width="2"
                                             stroke-linecap="round" stroke-linejoin="round">
                                            @switch (kindMeta(e).icon) {
                                                @case ('rental') {
                                                    <circle cx="12" cy="12" r="9" />
                                                    <path d="M14.8 9A2 2 0 0 0 13 8h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1" />
                                                    <path d="M12 6v2m0 8v2" />
                                                }
                                                @case ('maintenance') {
                                                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                                                }
                                                @case ('fine') {
                                                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                                    <path d="M12 9v4" /><path d="M12 17h.01" />
                                                }
                                                @case ('expense') {
                                                    <path d="M6 3h12v18l-3-2l-3 2l-3-2l-3 2z" />
                                                    <path d="M9 8h6" /><path d="M9 12h6" />
                                                }
                                                @case ('ipva') {
                                                    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
                                                    <path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" />
                                                }
                                                @case ('insurance') {
                                                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                                                }
                                                @case ('financing') {
                                                    <path d="M3 21h18" /><path d="M5 21V10" /><path d="M19 21V10" />
                                                    <path d="M9 21v-7" /><path d="M15 21v-7" /><path d="M12 3 3 8h18z" />
                                                }
                                            }
                                        </svg>
                                    </span>
                                    <div class="min-w-0 flex-1">
                                        <p
                                            class="text-[11px] font-medium"
                                            [class]="kindMeta(e).color"
                                        >
                                            {{ kindMeta(e).label }}
                                        </p>
                                        <p class="text-sm text-gray-900 dark:text-fg truncate">{{ e.label }}</p>
                                    </div>
                                    <p
                                        class="text-sm font-semibold tabular-nums whitespace-nowrap"
                                        [class.text-emerald-600]="e.direction === 'IN'" [class.dark:text-emerald-300]="e.direction === 'IN'"
                                        [class.text-red-600]="e.direction === 'OUT'" [class.dark:text-red-300]="e.direction === 'OUT'"
                                    >
                                        {{ e.direction === 'IN' ? '+ ' : '- ' }}{{ money(e.amountCents) }}
                                    </p>
                                </div>
                            </li>
                        } @empty {
                            <li class="text-sm text-gray-500 dark:text-fg-subtle text-center py-6">
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
        return cashflowKindMeta(e.kind);
    }

    protected money(cents: number): string {
        return formatBRL(cents);
    }
}
