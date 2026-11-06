import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { CashflowEventDto } from '../../../types/dashboard.types';

/** Whole reais (`R$ 48.200`), the tile format of the canvas; cents live in the day sheet. */
const WHOLE = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const wholeBRL = (cents: number): string => WHOLE.format(Math.round(cents / 100));

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
 * only the day number plus a green dot (IN) and/or a red dot (OUT); amounts live in the
 * month tiles and the day sheet. Cells stay a 7-col
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

    /** Single-letter header (the owner's design); `name` feeds the accessible label. */
    protected readonly weekdays = [
        { letter: 'D', name: 'Domingo' },
        { letter: 'S', name: 'Segunda-feira' },
        { letter: 'T', name: 'Terça-feira' },
        { letter: 'Q', name: 'Quarta-feira' },
        { letter: 'Q', name: 'Quinta-feira' },
        { letter: 'S', name: 'Sexta-feira' },
        { letter: 'S', name: 'Sábado' },
    ];

    protected readonly monthLabel = computed(() => {
        const [year, month] = this.monthCursor().split('-').map(Number);
        const d = new Date(year, month - 1, 1);
        // Only the first letter is upper-cased ("Novembro de 2026"); CSS `capitalize`
        // would also upper-case the preposition ("Novembro De 2026").
        const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return label.charAt(0).toUpperCase() + label.slice(1);
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

    protected readonly inLabel = computed(() => wholeBRL(this.monthSummary().inCents));
    protected readonly outLabel = computed(() => wholeBRL(this.monthSummary().outCents));
    protected readonly balanceLabel = computed(() => wholeBRL(this.monthSummary().balance));

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

    /** Accessible name of a day cell: the day plus what happens on it. */
    protected cellLabel(cell: DayCell): string {
        const parts = [`Dia ${cell.dayOfMonth}`];
        if (cell.inCount > 0) {
            parts.push(cell.inCount === 1 ? '1 recebimento' : `${cell.inCount} recebimentos`);
        }
        if (cell.outCount > 0) {
            parts.push(cell.outCount === 1 ? '1 pagamento' : `${cell.outCount} pagamentos`);
        }
        return parts.join(', ');
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
