import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { todayInBusinessTz } from '../../utils/business-clock';
import {
  addDays,
  addMonthsClamped,
  brDay,
  clampDay,
  dayLabel,
  isDay,
  monthDiff,
  monthOf,
  monthTitle,
  monthWeeks,
  outOfBounds,
  shiftMonth,
  weekdayIndex,
} from './calendar-math';

let nextId = 0;

const WEEKDAYS = [
  { short: 'D', long: 'domingo' },
  { short: 'S', long: 'segunda' },
  { short: 'T', long: 'terça' },
  { short: 'Q', long: 'quarta' },
  { short: 'Q', long: 'quinta' },
  { short: 'S', long: 'sexta' },
  { short: 'S', long: 'sábado' },
] as const;

/** Largura a partir da qual o painel flutua e mostra dois meses (a mesma do shell). */
const WIDE_QUERY = '(min-width: 1024px)';

interface DayCell {
  iso: string;
  day: number;
  label: string;
  cls: string;
  sel: boolean;
  off: boolean;
  tab: boolean;
  today: boolean;
}
interface MonthGrid {
  ym: string;
  title: string;
  weeks: (DayCell | null)[][];
}

/**
 * Campo de data que abre um calendário (`yyyy-MM-dd`). `value` é `model()`: use `[(value)]`.
 *
 * - Celular: o painel abre NO FLUXO, logo abaixo do campo. O host vira `display: contents`
 *   para o painel poder ocupar a linha inteira de uma grade (`grid-column: 1 / -1`) quando o
 *   campo divide a linha com outro (o "Às" ao lado do "Pega o carro em").
 * - Computador (≥ 1024px): o painel flutua sobre a página; com `months=2`, dois meses lado a
 *   lado.
 * - `rangeStart` pinta o período de `rangeStart` até o valor (a devolução).
 * - Tocar um dia escolhe; "Pronto", Esc ou um toque fora fecham. O texto do rodapé é do
 *   chamador (conteúdo projetado), porque é ele quem sabe o que a data significa.
 * - Teclado do padrão de calendário do APG: setas (dia/semana), Home/End (semana),
 *   PageUp/PageDown (mês), Enter/Espaço escolhem.
 */
@Component({
  selector: 'app-calendar-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar-field.html',
  styleUrl: './calendar-field.css',
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class CalendarField {
  readonly label = input.required<string>();
  readonly required = input(false);
  /** yyyy-MM-dd */
  readonly value = model('');
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  /** Início do período a pintar (a retirada, quando o campo é a devolução). */
  readonly rangeStart = input<string | null>(null);
  /** Meses lado a lado no computador (no celular, sempre um). */
  readonly months = input<1 | 2>(1);
  readonly error = input<string | null>(null);
  readonly placeholder = input('dd/mm/aaaa');
  readonly testId = input('');
  /** O painel fechou (o chamador marca o campo como visitado). */
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly id = `cf-${++nextId}`;
  protected readonly weekdays = WEEKDAYS;
  protected readonly open = signal(false);
  /** Primeiro mês visível (`yyyy-MM`). */
  protected readonly view = signal('');
  /** O dia com o foco do teclado. */
  protected readonly focusDay = signal('');
  /** "Hoje" no fuso do negócio, lido ao abrir (uma tela aberta de um dia para o outro). */
  private readonly today = signal(todayInBusinessTz());
  private readonly wide = signal(false);

  protected readonly shown = computed(() => (this.wide() ? this.months() : 1));
  protected readonly display = computed(() => brDay(this.value()));

  /** O dia que recebe o Tab: o do foco, se está à vista; senão o primeiro dia do mês. */
  private readonly tabDay = computed(() => {
    const f = this.focusDay();
    const v = this.view();
    const d = isDay(f) ? monthDiff(v, monthOf(f)) : -1;
    return d >= 0 && d < this.shown() ? f : `${v}-01`;
  });

  protected readonly grids = computed<MonthGrid[]>(() => {
    const first = this.view();
    if (!first) return [];
    return Array.from({ length: this.shown() }, (_, i) => {
      const ym = shiftMonth(first, i);
      return {
        ym,
        title: monthTitle(ym),
        weeks: monthWeeks(ym).map((w) => w.map((iso) => (iso ? this.cell(iso) : null))),
      };
    });
  });

  constructor() {
    const mq = inject(DOCUMENT).defaultView?.matchMedia?.(WIDE_QUERY);
    if (mq) {
      this.wide.set(mq.matches);
      const onChange = (e: MediaQueryListEvent): void => this.wide.set(e.matches);
      mq.addEventListener?.('change', onChange);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener?.('change', onChange));
    }
  }

  private cell(iso: string): DayCell {
    const value = this.value();
    const start = this.rangeStart();
    const range = isDay(start) && isDay(value) && value > start;
    const off = outOfBounds(iso, this.min(), this.max());
    const sel = iso === value || (isDay(start) && iso === start);
    const cls: string[] = [];
    if (range && iso > start && iso < value) cls.push('in');
    if (range && iso === start) cls.push('s');
    if (range && iso === value) cls.push('e');
    if (sel) cls.push('on');
    if (iso === this.today()) cls.push('today');
    if (off) cls.push('off');
    return {
      iso,
      day: Number(iso.slice(8)),
      label: dayLabel(iso),
      cls: cls.join(' '),
      sel: iso === value,
      off,
      tab: iso === this.tabDay(),
      today: iso === this.today(),
    };
  }

  // ------------------------------------------------------------------ abrir e fechar
  protected toggle(): void {
    if (this.open()) this.close(false);
    else this.show();
  }

  private show(): void {
    this.today.set(todayInBusinessTz());
    const value = this.value();
    const start = this.rangeStart();
    const base = isDay(value) ? value : isDay(start) && start > this.today() ? start : this.today();
    const focus = clampDay(base, this.min(), this.max());
    this.focusDay.set(focus);
    const fm = monthOf(focus);
    let view = fm;
    if (this.shown() === 2 && isDay(start)) {
      const sm = monthOf(start);
      const d = monthDiff(sm, fm);
      view = d === 0 || d === 1 ? sm : d > 1 ? shiftMonth(fm, -1) : fm;
    }
    this.view.set(view);
    this.open.set(true);
    this.focusCell();
  }

  /** Fecha o painel; `returnFocus` devolve o foco ao campo (Pronto, Esc). */
  close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.closed.emit();
    if (returnFocus) {
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.cf-f')?.focus(), {
        injector: this.injector,
      });
    }
  }

  protected onOutside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node | null)) {
      this.close(false);
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && next && !this.host.nativeElement.contains(next)) this.close(false);
  }

  // ------------------------------------------------------------------ navegação
  protected prevMonth(): void {
    this.view.update((v) => shiftMonth(v, -1));
  }

  protected nextMonth(): void {
    this.view.update((v) => shiftMonth(v, 1));
  }

  protected pick(iso: string): void {
    if (outOfBounds(iso, this.min(), this.max())) return;
    this.value.set(iso);
    this.focusDay.set(iso);
  }

  protected onDayKey(event: KeyboardEvent, iso: string): void {
    let next: string | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(iso, -1);
        break;
      case 'ArrowRight':
        next = addDays(iso, 1);
        break;
      case 'ArrowUp':
        next = addDays(iso, -7);
        break;
      case 'ArrowDown':
        next = addDays(iso, 7);
        break;
      case 'Home':
        next = addDays(iso, -weekdayIndex(iso));
        break;
      case 'End':
        next = addDays(iso, 6 - weekdayIndex(iso));
        break;
      case 'PageUp':
        next = addMonthsClamped(iso, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonthsClamped(iso, event.shiftKey ? 12 : 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.pick(iso);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.moveFocus(next);
  }

  private moveFocus(iso: string): void {
    const m = monthOf(iso);
    const d = monthDiff(this.view(), m);
    if (d < 0) this.view.set(m);
    else if (d >= this.shown()) this.view.set(shiftMonth(m, -(this.shown() - 1)));
    this.focusDay.set(iso);
    this.focusCell();
  }

  private focusCell(): void {
    afterNextRender(
      () => {
        const day = this.tabDay();
        this.host.nativeElement.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
      },
      { injector: this.injector },
    );
  }
}
