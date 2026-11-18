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
import {
    FilterChipGroup,
    FilterChipOption,
} from '../filter-chip-group/filter-chip-group';
import { todayInBusinessTz } from '../../utils/business-clock';

export interface DateRange {
    from: string;
    to: string;
}

export type DateRangePresetKey =
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

/**
 * Where "Mês atual" and "Este ano" end.
 * - `calendar`: the whole calendar period (01/11 a 30/11; 01/01 a 31/12), the fleet dashboard.
 * - `today`: up to today (01/11 a 18/11; 01/01 a 18/11), the admin.
 */
export type DateRangePeriodEnd = 'calendar' | 'today';

// "Mês atual" is the default. Where it ends is the caller's `periodEnd` (owner decision
// 18/11/2026): the fleet dashboard reads the whole month (charges due later this month count);
// the admin reads up to today.
const PRESETS: readonly FilterChipOption<DateRangePresetKey>[] = [
    { value: 'monthCurrent', label: 'Mês atual' },
    { value: 'today', label: 'Hoje' },
    { value: '7d', label: '7 dias' },
    { value: '30d', label: '30 dias' },
    { value: '90d', label: '90 dias' },
    { value: 'next30d', label: 'Próximos 30 dias' },
    { value: 'next90d', label: 'Próximos 90 dias' },
    { value: 'monthPast', label: 'Mês passado' },
    { value: 'year', label: 'Este ano' },
    { value: 'custom', label: 'Personalizado' },
];

/** Presets that look forward: dropped when future dates are not allowed. */
const FUTURE_PRESETS: readonly DateRangePresetKey[] = ['next30d', 'next90d'];

/**
 * Calendar-day arithmetic on a UTC `Date` used as a plain civil date (no time, no zone): a day
 * shift never lands on a daylight-saving gap of the browser's zone.
 */
function civil(year: number, monthIndex: number, day: number): Date {
    return new Date(Date.UTC(year, monthIndex, day));
}

function iso(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * "Hoje" is the BUSINESS day (Brasília, `utils/business-clock.ts`), not the browser's: an
 * operator in Manaus at 23:30, or a laptop on UTC, must not ask for tomorrow's data.
 */
function businessToday(): Date {
    const [y, m, d] = todayInBusinessTz().split('-').map(Number);
    return civil(y, m - 1, d);
}

/** `2026-11-18` (or an ISO instant) -> `18/11/2026`; `null` when it is not a date. */
function ptBrDay(isoDate: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * The range as people read it: "01/11/2026 a 18/11/2026" (owner rule, 18/11/2026), the same
 * text on every period control. Takes `yyyy-MM-dd` or an ISO instant (only the date part is
 * read, no time-zone shift). `null` when either end is missing or not a date.
 */
export function formatDateRangePtBr(range: { from: string | null; to: string | null } | null | undefined): string | null {
    if (!range?.from || !range.to) return null;
    const from = ptBrDay(range.from);
    const to = ptBrDay(range.to);
    return from && to ? `${from} a ${to}` : null;
}

function rangeForPreset(preset: DateRangePresetKey, end: DateRangePeriodEnd = 'calendar'): DateRange | null {
    const today = businessToday();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    const shift = (days: number) => civil(year, month, today.getUTCDate() - days);
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
                from: iso(civil(year, month, 1)),
                to: iso(end === 'today' ? today : civil(year, month + 1, 0)),
            };
        case 'monthPast':
            return {
                from: iso(civil(year, month - 1, 1)),
                to: iso(civil(year, month, 0)),
            };
        case 'year':
            return {
                from: iso(civil(year, 0, 1)),
                to: iso(end === 'today' ? today : civil(year, 11, 31)),
            };
        case 'custom':
            return null;
    }
}

@Component({
    selector: 'app-date-range-picker',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FilterChipGroup],
    template: `
        <div class="flex flex-col gap-3">
            <app-filter-chip-group
                [options]="presets()"
                [value]="selected()"
                [scrollable]="!wrapChips()"
                ariaLabel="Período"
                (selectionChange)="selectPreset($event)"
            />

            @if (selected() === 'custom') {
                <div class="flex flex-col sm:flex-row gap-2">
                    <label class="flex flex-col text-xs text-fg-subtle gap-1 sm:flex-1">
                        De
                        <input
                            type="date"
                            class="min-h-[44px] rounded-lg border border-edge px-3 py-2 text-base sm:text-sm
                                   text-fg focus:outline-none focus:ring-2 focus:ring-primary-400"
                            [value]="customFrom()"
                            [attr.max]="maxDate()"
                            (change)="onCustomFrom($any($event.target).value)"
                        />
                    </label>
                    <label class="flex flex-col text-xs text-fg-subtle gap-1 sm:flex-1">
                        Até
                        <input
                            type="date"
                            class="min-h-[44px] rounded-lg border border-edge px-3 py-2 text-base sm:text-sm
                                   text-fg focus:outline-none focus:ring-2 focus:ring-primary-400"
                            [value]="customTo()"
                            [attr.max]="maxDate()"
                            (change)="onCustomTo($any($event.target).value)"
                        />
                    </label>
                </div>
                @if (customError()) {
                    <p class="text-xs text-red-600 dark:text-red-300">{{ customError() }}</p>
                }
            }
            @if (showRange() && rangeText(); as text) {
                <p class="text-xs text-fg-subtle tabular-nums" aria-live="polite" data-range-text>
                    {{ text }}
                </p>
            }
            @if (clearable() && selected() !== null) {
                <button
                    type="button"
                    data-range-clear
                    (click)="clear()"
                    class="self-start min-h-[44px] px-3 -ml-3 text-sm font-semibold text-fg-muted
                           hover:text-primary-700 dark:hover:text-primary-400 rounded-lg
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                    {{ clearLabel() }}
                </button>
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

    /**
     * Preset com que o seletor NASCE, e se ele emite sozinho ao abrir.
     *
     * `'monthCurrent'` (padrão) mantém o dashboard exatamente como era: ele
     * SEMPRE tem um período, e emite na inicialização para a tela já pintar com
     * dados. Ver o comentário do `selected` logo abaixo.
     *
     * `null` é para quem usa o período como FILTRO OPCIONAL: nenhum chip nasce
     * marcado e nada é emitido até o usuário escolher. Sem isto, uma tela de
     * filtros abre com um período já aplicado que o usuário não escolheu — e
     * passa a dizer "nada encontrado com estes filtros" para quem não filtrou
     * nada.
     */
    readonly initialPreset = input<DateRangePresetKey | null>('monthCurrent');

    /**
     * Quais chips existem, na ordem de `PRESETS`. `null` (padrão) mostra todos — o dashboard
     * da frota continua exatamente como era. Uma tela que só faz sentido com um subconjunto
     * (a do motorista: sem "Próximos 30 dias", que é projeção de cobrança) passa a lista
     * em vez de ganhar um segundo seletor de período.
     *
     * A lista filtra os chips; não valida `initialPreset`. Quem passa os dois é quem
     * garante que o inicial está na lista.
     */
    readonly presetKeys = input<readonly DateRangePresetKey[] | null>(null);

    /** Show the `presetKeys` chips in the order they were listed instead of the selector's order. */
    readonly presetListOrder = input(false);

    /** Wrap the chips onto several rows on the phone instead of a horizontal carousel. */
    readonly wrapChips = input(false);

    /**
     * Show the resolved range under the chips, "01/11/2026 a 18/11/2026". On by default and
     * meant to stay on (owner rule 18/11/2026: every period control shows its dates); `false`
     * exists only for a screen that prints the same dates elsewhere.
     */
    readonly showRange = input(true);

    /**
     * Where "Mês atual" and "Este ano" end (see `DateRangePeriodEnd`). `calendar` (default) keeps
     * the fleet dashboard on the whole month/year; the admin passes `today`.
     */
    readonly periodEnd = input<DateRangePeriodEnd>('calendar');

    /**
     * The range the SERVER actually used (e.g. the admin's `meta.from`/`meta.to`), shown instead
     * of the one computed here. `yyyy-MM-dd` or ISO instants. The page owns its freshness: bind
     * the answer of the period on screen and `null` while the next one loads, so an old range is
     * never printed under a new chip (`null` falls back to the range computed here).
     */
    readonly resolvedRange = input<{ from: string | null; to: string | null } | null>(null);

    /**
     * Opt-in "Limpar período" link under the chips (only while a chip is marked). It unmarks every
     * chip, empties De/Até and emits `rangeCleared`: the page goes back to "no period" (e.g. the
     * whole history). A page can do the same from its own "Limpar filtros" with `clear()`.
     * Default `false`: the dashboard keeps always having a period.
     */
    readonly clearable = input(false);
    readonly clearLabel = input('Limpar período');

    /**
     * `false` = nothing after today (Brasília) can be picked: De/Até get `max` = today, a typed
     * later date is refused with a message and not emitted, and the forward-looking chips
     * ("Próximos 30/90 dias") are dropped. For history filters (audit, logs). Default `true`: the
     * fleet dashboard keeps planning ahead.
     */
    readonly allowFuture = input(true);

    /** Emitted when the selection is cleared (`clear()` or the "Limpar período" link). */
    readonly rangeCleared = output<void>();

    protected readonly presets = computed<readonly FilterChipOption<DateRangePresetKey>[]>(() => {
        const keys = this.presetKeys();
        const all = this.allowFuture()
            ? PRESETS
            : PRESETS.filter((p) => !FUTURE_PRESETS.includes(p.value));
        if (keys === null) return all;
        // Default: the selector's own order. `presetListOrder`: the caller's order (the dashboard pills).
        if (this.presetListOrder()) return keys.flatMap((k) => all.filter((p) => p.value === k));
        return all.filter((p) => keys.includes(p.value));
    });

    /**
     * `max` of the De/Até fields: today in Brasília when the future is blocked, else none. A method,
     * not a `computed`: a cached value would keep yesterday's date on a screen left open overnight.
     */
    protected maxDate(): string | null {
        return this.allowFuture() ? null : todayInBusinessTz();
    }

    constructor() {
        effect(() => {
            const key = this.jumpToMonth();
            if (!key) return;
            const parts = key.split('-');
            if (parts.length !== 2) return;
            const year = Number(parts[0]);
            const month = Number(parts[1]);
            if (Number.isNaN(year) || Number.isNaN(month)) return;
            const first = civil(year, month - 1, 1);
            const last = civil(year, month, 0);
            this.selected.set('custom');
            this.customFrom.set(iso(first));
            this.customTo.set(iso(last));
            this.rangeChange.emit({ from: iso(first), to: iso(last) });
        });
    }
    // "Mês atual" is the default (it replaced a rolling 30 days). With `periodEnd` `calendar` it
    // also holds the rest of the month: rentals that start next week count on first paint.
    protected readonly selected = signal<DateRangePresetKey | null>('monthCurrent');
    protected readonly customFrom = signal<string>('');
    protected readonly customTo = signal<string>('');

    protected readonly currentRange = computed<DateRange | null>(() => {
        const key = this.selected();
        if (key === null) return null;
        if (key === 'custom') {
            const from = this.customFrom();
            const to = this.customTo();
            if (!from || !to) return null;
            return { from, to };
        }
        return rangeForPreset(key, this.periodEnd());
    });

    /** The line under the chips: the server's range when given, else the one computed here. */
    protected readonly rangeText = computed<string | null>(() => {
        const server = this.resolvedRange();
        if (server !== null) return formatDateRangePtBr(server);
        if (this.customError()) return null;
        return formatDateRangePtBr(this.currentRange());
    });

    protected readonly customError = computed<string | null>(() => {
        if (this.selected() !== 'custom') return null;
        const from = this.customFrom();
        const to = this.customTo();
        if (!from || !to) return 'Selecione as duas datas.';
        if (from > to) return 'Data inicial deve ser anterior ou igual à final.';
        if (this.isFuture(from) || this.isFuture(to)) return 'Escolha datas até hoje.';
        return null;
    });

    ngOnInit(): void {
        const initial = this.initialPreset();
        this.selected.set(initial);
        // `null` = período é filtro opcional: não emite nada até o usuário
        // escolher. Ver `initialPreset`.
        if (initial === null) return;
        const r = rangeForPreset(initial, this.periodEnd());
        if (r) this.rangeChange.emit(r);
    }

    /**
     * `null` só chega quando o grupo de chips herda o tipo do `value`, que
     * agora aceita "nenhum período". Não é escolha do usuário — ele não tem
     * como clicar em "nada" —, então ignora.
     */
    protected selectPreset(key: DateRangePresetKey | null): void {
        if (key === null) return;
        this.selected.set(key);
        const r = rangeForPreset(key, this.periodEnd());
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

    /**
     * Unmarks every chip, empties De/Até and emits `rangeCleared`. Public so a page's own
     * "Limpar filtros" can reset the period without recreating the component.
     */
    clear(): void {
        this.selected.set(null);
        this.customFrom.set('');
        this.customTo.set('');
        this.rangeCleared.emit();
    }

    private isFuture(day: string): boolean {
        const max = this.maxDate();
        return max !== null && day > max;
    }

    private emitCustomIfValid(): void {
        const from = this.customFrom();
        const to = this.customTo();
        if (from && to && from <= to && !this.isFuture(from) && !this.isFuture(to)) {
            this.rangeChange.emit({ from, to });
        }
    }
}
