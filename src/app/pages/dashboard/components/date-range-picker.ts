import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    effect,
    input,
    output,
    signal,
} from '@angular/core';

export interface DateRange {
    from: string;
    to: string;
}

type PresetKey =
    | 'today'
    | '7d'
    | '30d'
    | '90d'
    | 'next30d'
    | 'next90d'
    | 'monthCurrent'
    | 'monthPast'
    | 'year'
    | 'custom';

interface Preset {
    key: PresetKey;
    label: string;
}

// "Mês atual" is the default: it covers what has already happened this month
// AND the remaining projected days — matches how the tenant thinks about
// operational revenue.
const PRESETS: Preset[] = [
    { key: 'monthCurrent', label: 'Mês atual' },
    { key: 'today', label: 'Hoje' },
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: '90d', label: '90 dias' },
    { key: 'next30d', label: 'Próximos 30 dias' },
    { key: 'next90d', label: 'Próximos 90 dias' },
    { key: 'monthPast', label: 'Mês passado' },
    { key: 'year', label: 'Este ano' },
    { key: 'custom', label: 'Personalizado' },
];

function iso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function rangeForPreset(preset: PresetKey): DateRange | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const shift = (days: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - days);
        return d;
    };
    switch (preset) {
        case 'today':
            return { from: iso(today), to: iso(today) };
        case '7d':
            return { from: iso(shift(6)), to: iso(today) };
        case '30d':
            return { from: iso(shift(29)), to: iso(today) };
        case '90d':
            return { from: iso(shift(89)), to: iso(today) };
        case 'next30d':
            return { from: iso(today), to: iso(shift(-29)) };
        case 'next90d':
            return { from: iso(today), to: iso(shift(-89)) };
        case 'monthCurrent':
            return {
                from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
                to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
            };
        case 'monthPast':
            return {
                from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
                to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
            };
        case 'year':
            return {
                from: iso(new Date(today.getFullYear(), 0, 1)),
                to: iso(new Date(today.getFullYear(), 11, 31)),
            };
        case 'custom':
            return null;
    }
}

@Component({
    selector: 'app-date-range-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="flex flex-col gap-3">
            <div
                class="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1
                       lg:overflow-visible lg:flex-wrap"
                role="tablist"
                aria-label="Período"
            >
                @for (p of presets; track p.key) {
                    <button
                        type="button"
                        role="tab"
                        [attr.aria-selected]="selected() === p.key"
                        class="snap-start shrink-0 min-h-[44px] px-3 py-2 rounded-full text-sm
                               font-medium border transition-colors"
                        [class.bg-primary-500]="selected() === p.key"
                        [class.text-white]="selected() === p.key"
                        [class.border-primary-500]="selected() === p.key"
                        [class.bg-white]="selected() !== p.key"
                        [class.text-gray-700]="selected() !== p.key"
                        [class.border-gray-200]="selected() !== p.key"
                        (click)="selectPreset(p.key)"
                    >
                        {{ p.label }}
                    </button>
                }
            </div>

            @if (selected() === 'custom') {
                <div class="flex flex-col sm:flex-row gap-2">
                    <label class="flex flex-col text-xs text-gray-500 gap-1 sm:flex-1">
                        De
                        <input
                            type="date"
                            class="min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm
                                   text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
                            [value]="customFrom()"
                            (change)="onCustomFrom($any($event.target).value)"
                        />
                    </label>
                    <label class="flex flex-col text-xs text-gray-500 gap-1 sm:flex-1">
                        Até
                        <input
                            type="date"
                            class="min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm
                                   text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
                            [value]="customTo()"
                            (change)="onCustomTo($any($event.target).value)"
                        />
                    </label>
                </div>
                @if (customError()) {
                    <p class="text-xs text-red-600">{{ customError() }}</p>
                }
            } @else if (currentRange(); as r) {
                <p class="text-xs text-gray-500">
                    {{ r.from }} — {{ r.to }}
                </p>
            }
        </div>
    `,
})
export class DateRangePicker implements OnInit {
    readonly rangeChange = output<DateRange>();

    /**
     * External nudge to jump to a specific month key `YYYY-MM`. When it
     * changes, the picker switches to custom mode with that month's full
     * range and emits `rangeChange`. Ignores empty/null values.
     */
    readonly jumpToMonth = input<string | null>(null);

    protected readonly presets = PRESETS;

    constructor() {
        effect(() => {
            const key = this.jumpToMonth();
            if (!key) return;
            const parts = key.split('-');
            if (parts.length !== 2) return;
            const year = Number(parts[0]);
            const month = Number(parts[1]);
            if (Number.isNaN(year) || Number.isNaN(month)) return;
            const first = new Date(year, month - 1, 1);
            const last = new Date(year, month, 0);
            this.selected.set('custom');
            this.customFrom.set(iso(first));
            this.customTo.set(iso(last));
            this.rangeChange.emit({ from: iso(first), to: iso(last) });
        });
    }
    // "Mês atual" is the default so tenants see both realized-to-date AND the
    // rest of the month's projected revenue on first paint — critical because
    // rentals with future start dates (e.g. contract of R$ 42.400 starting
    // next week) were invisible under the old rolling-30d default.
    protected readonly selected = signal<PresetKey>('monthCurrent');
    protected readonly customFrom = signal<string>('');
    protected readonly customTo = signal<string>('');

    protected readonly currentRange = computed<DateRange | null>(() => {
        const key = this.selected();
        if (key === 'custom') {
            const from = this.customFrom();
            const to = this.customTo();
            if (!from || !to) return null;
            return { from, to };
        }
        return rangeForPreset(key);
    });

    protected readonly customError = computed<string | null>(() => {
        if (this.selected() !== 'custom') return null;
        const from = this.customFrom();
        const to = this.customTo();
        if (!from || !to) return 'Selecione as duas datas.';
        if (from > to) return 'Data inicial deve ser anterior ou igual à final.';
        return null;
    });

    ngOnInit(): void {
        const r = rangeForPreset('monthCurrent');
        if (r) this.rangeChange.emit(r);
    }

    protected selectPreset(key: PresetKey): void {
        this.selected.set(key);
        const r = rangeForPreset(key);
        if (r) this.rangeChange.emit(r);
    }

    protected onCustomFrom(value: string): void {
        this.customFrom.set(value);
        this.emitCustomIfValid();
    }

    protected onCustomTo(value: string): void {
        this.customTo.set(value);
        this.emitCustomIfValid();
    }

    private emitCustomIfValid(): void {
        const from = this.customFrom();
        const to = this.customTo();
        if (from && to && from <= to) {
            this.rangeChange.emit({ from, to });
        }
    }
}
