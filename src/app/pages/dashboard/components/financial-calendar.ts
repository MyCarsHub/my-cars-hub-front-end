import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { CashflowEventDto, formatBRL } from '../../../types/dashboard.types';

/** Aggregated per-day view used to render each calendar cell. */
export interface DayCell {
    /** ISO `yyyy-MM-dd`. Empty string for pad cells. */
    date: string;
    dayOfMonth: number;
    inCents: number;
    outCents: number;
    inCount: number;
    outCount: number;
    isToday: boolean;
    isCurrentMonth: boolean;
    /** True on pad cells (previous/next month bleed). */
    isPad: boolean;
}

/**
 * Financial calendar — mobile-first month grid that plots cashflow events.
 *
 * A single {@link CashflowEventDto} array is grouped by date; each cell shows
 * two dots (green IN / red OUT) and the aggregate amounts. Cells stay a 7-col
 * grid at every viewport for visual continuity (users compare weekdays), but
 * shrink density on `< sm` while keeping a 44px minimum touch target.
 *
 * Selecting a day emits {@link daySelect} with the ISO date — the parent
 * renders the detail sheet.
 */
@Component({
    selector: 'app-financial-calendar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './financial-calendar.html',
})
export class FinancialCalendar implements OnInit {
    /** All cashflow events for the current window (any subset of dates). */
    readonly events = input<CashflowEventDto[]>([]);

    /** Currently-selected day (ISO). */
    readonly selectedDate = input<string | null>(null);

    readonly daySelect = output<string>();

    /** Emitted with `YYYY-MM` on init and whenever the visible month changes. */
    readonly monthChange = output<string>();

    /** Internal month cursor as `YYYY-MM`. Defaults to current month. */
    private readonly monthCursor = signal<string>(this.buildTodayKey());

    ngOnInit(): void {
        this.monthChange.emit(this.monthCursor());
    }

    protected readonly weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    protected readonly monthLabel = computed(() => {
        const [year, month] = this.monthCursor().split('-').map(Number);
        const d = new Date(year, month - 1, 1);
        return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    });

    /** Grouped events indexed by ISO date (yyyy-MM-dd). */
    private readonly eventsByDate = computed<Map<string, CashflowEventDto[]>>(() => {
        const grouped = new Map<string, CashflowEventDto[]>();
        for (const e of this.events()) {
            const bucket = grouped.get(e.date) ?? [];
            bucket.push(e);
            grouped.set(e.date, bucket);
        }
        return grouped;
    });

    protected readonly cells = computed<DayCell[]>(() => {
        const [year, month] = this.monthCursor().split('-').map(Number);
        const first = new Date(year, month - 1, 1);
        const daysInMonth = new Date(year, month, 0).getDate();
        const startPad = first.getDay(); // 0 = Sunday
        const today = this.buildTodayKey() + '-' + this.pad(new Date().getDate());
        const todayIso = this.buildTodayIso();

        const cells: DayCell[] = [];

        // Leading pad (previous month tail) — kept blank & muted.
        for (let i = 0; i < startPad; i++) {
            cells.push(this.emptyCell());
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${year}-${this.pad(month)}-${this.pad(d)}`;
            const dayEvents = this.eventsByDate().get(iso) ?? [];
            let inCents = 0;
            let outCents = 0;
            let inCount = 0;
            let outCount = 0;
            for (const e of dayEvents) {
                if (e.direction === 'IN') {
                    inCents += e.amountCents;
                    inCount++;
                } else {
                    outCents += e.amountCents;
                    outCount++;
                }
            }
            cells.push({
                date: iso,
                dayOfMonth: d,
                inCents,
                outCents,
                inCount,
                outCount,
                isToday: iso === todayIso,
                isCurrentMonth: true,
                isPad: false,
            });
        }

        // Trailing pad — fill up to a multiple of 7.
        while (cells.length % 7 !== 0) {
            cells.push(this.emptyCell());
        }
        return cells;
    });

    /** Monthly summary — aggregates IN/OUT of the visible month only. */
    protected readonly monthSummary = computed(() => {
        const cells = this.cells();
        let inCents = 0;
        let outCents = 0;
        let inCount = 0;
        let outCount = 0;
        for (const c of cells) {
            if (!c.isCurrentMonth) continue;
            inCents += c.inCents;
            outCents += c.outCents;
            inCount += c.inCount;
            outCount += c.outCount;
        }
        return { inCents, outCents, inCount, outCount, balance: inCents - outCents };
    });

    protected readonly inLabel = computed(() => formatBRL(this.monthSummary().inCents));
    protected readonly outLabel = computed(() => formatBRL(this.monthSummary().outCents));
    protected readonly balanceLabel = computed(() => formatBRL(this.monthSummary().balance));

    protected prevMonth(): void {
        const [year, month] = this.monthCursor().split('-').map(Number);
        const d = new Date(year, month - 2, 1);
        this.setMonth(`${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`);
    }

    protected nextMonth(): void {
        const [year, month] = this.monthCursor().split('-').map(Number);
        const d = new Date(year, month, 1);
        this.setMonth(`${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`);
    }

    protected goToday(): void {
        this.setMonth(this.buildTodayKey());
    }

    private setMonth(key: string): void {
        if (this.monthCursor() === key) return;
        this.monthCursor.set(key);
        this.monthChange.emit(key);
    }

    protected onCellClick(cell: DayCell): void {
        if (cell.isPad) return;
        this.daySelect.emit(cell.date);
    }

    protected shortMoney(cents: number): string {
        if (cents === 0) return '';
        // Compact display for cells — R$1,2k / R$1,5M
        const value = cents / 100;
        if (value >= 1000000) return `R$${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `R$${(value / 1000).toFixed(1)}k`;
        return `R$${value.toFixed(0)}`;
    }

    private emptyCell(): DayCell {
        return {
            date: '',
            dayOfMonth: 0,
            inCents: 0,
            outCents: 0,
            inCount: 0,
            outCount: 0,
            isToday: false,
            isCurrentMonth: false,
            isPad: true,
        };
    }

    private pad(n: number): string {
        return n < 10 ? `0${n}` : `${n}`;
    }

    private buildTodayKey(): string {
        const d = new Date();
        return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`;
    }

    private buildTodayIso(): string {
        const d = new Date();
        return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    }
}
