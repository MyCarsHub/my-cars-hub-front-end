import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { CalendarField } from '../../../../components/calendar-field/calendar-field';
import { addDaysIso } from '../../charges-flex/charges-flex';
import { PeriodSentence, PeriodValue, onWeekday } from '../create-rules';

/**
 * Card 2 · Período (pranchas PerF1–F4 / PerG1–G3 e RenPerF1/F5/G4). "Até quando?": "Tem data
 * para devolver" (o fim de sempre) ou "Fica pelo menos até uma data" (tempo mínimo; no fim o
 * dono renova). O estado é da página (`RentalCreate`): aqui só se mostra e se avisa.
 */
@Component({
  selector: 'app-rc-period',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalendarField],
  host: { class: 'rc-cb' },
  // "Até quando?" (RenPerF1/F5): a mesma lista de opções do card Cobrança, marcada em branco
  // (a prancha). No computador, as duas opções lado a lado (RenPerG4).
  styles: `
    .pe-sub { display: block; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--color-fg-soft); margin-bottom: 6px; }
    .pe-rad { display: flex; flex-direction: column; gap: 4px; }
    .pe-opt {
      display: flex; gap: 14px; align-items: flex-start; width: 100%; padding: 14px 12px; border: 0; border-radius: 16px;
      background: transparent; font: inherit; text-align: left; color: var(--color-fg); cursor: pointer;
    }
    .pe-opt:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
    .pe-mk {
      flex: none; width: 22px; height: 22px; margin-top: 1px; display: grid; place-items: center; border-radius: 11px;
      border: 2px solid var(--color-edge-field); transition: border-color 200ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .pe-mk i { width: 10px; height: 10px; border-radius: 5px; background: var(--color-fg); }
    .pe-opt[aria-checked='true'] .pe-mk { border-color: var(--color-fg); }
    @media (min-width: 1024px) { .pe-rad { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } }
    @media (prefers-reduced-motion: reduce) { .pe-mk { transition: none; } }
  `,
  template: `
    <div class="pe-g2">
      <div class="pe-two">
        <app-calendar-field
          label="Pega o carro em"
          [required]="true"
          testId="start-date"
          [value]="value().startDate"
          [error]="errors()['startDate'] ?? null"
          (valueChange)="patch.emit({ startDate: $event })"
          (closed)="touched.emit('startDate')"
        >
          @if (startDay(); as d) {
            Pega {{ d.article }} <b>{{ d.day }}</b>
          }
        </app-calendar-field>
        <div class="pe-time">
          <label class="pe-lb" for="rc-pickup-time"
            >Às <span class="pe-req" aria-hidden="true">*</span></label
          >
          <input
            id="rc-pickup-time"
            type="time"
            required
            [class.bad]="!!errors()['pickupTime']"
            [value]="value().pickupTime"
            [attr.aria-invalid]="errors()['pickupTime'] ? 'true' : null"
            [attr.aria-describedby]="errors()['pickupTime'] ? 'rc-pickup-time-err' : null"
            (change)="onTime($event)"
            (blur)="touched.emit('pickupTime')"
          />
          @if (errors()['pickupTime']; as m) {
            <p class="rc-err text-rose-700 dark:text-rose-300" role="alert" id="rc-pickup-time-err">{{ m }}</p>
          }
        </div>
      </div>
      <button
        type="button"
        class="pe-tg"
        role="switch"
        [attr.aria-checked]="value().pickupOtherDay"
        data-testid="pickup-other-day"
        (click)="patch.emit({ pickupOtherDay: !value().pickupOtherDay })"
      >
        <span class="pe-ot">
          <b>Ele pega o carro em outro dia</b>
          <span>Quando a retirada não é no primeiro dia do aluguel.</span>
        </span>
        <span class="pe-sw" [class.on]="value().pickupOtherDay"></span>
      </button>
    </div>

    @if (value().pickupOtherDay) {
      <div class="pe-g2">
        <div>
          <app-calendar-field
            label="Dia da retirada"
            [required]="true"
            testId="pickup-day"
            [value]="value().pickupDay"
            [min]="value().startDate || null"
            [max]="value().endDate || null"
            [error]="errors()['pickupDay'] ?? null"
            (valueChange)="patch.emit({ pickupDay: $event })"
            (closed)="touched.emit('pickupDay')"
          >
            @if (pickupDay(); as d) {
              Pega {{ d.article }} <b>{{ d.day }}</b>
            }
          </app-calendar-field>
        </div>
        <p class="pe-help">Precisa estar dentro do período do aluguel.</p>
      </div>
    }

    <div>
      <span class="pe-sub" id="rc-until">Até quando?</span>
      <div class="pe-rad" role="radiogroup" aria-labelledby="rc-until" data-testid="until" (keydown)="onUntilKey($event)">
        <button
          type="button"
          class="pe-opt"
          role="radio"
          data-testid="until-fixed"
          [attr.aria-checked]="!minimum()"
          [attr.tabindex]="minimum() ? -1 : 0"
          (click)="pickUntil(false)"
        >
          <span class="pe-mk">@if (!minimum()) { <i></i> }</span>
          <span class="pe-ot">
            <b>Tem data para devolver</b>
            <span>O aluguel acaba nessa data.</span>
          </span>
        </button>
        <button
          type="button"
          class="pe-opt"
          role="radio"
          data-testid="until-minimum"
          [attr.aria-checked]="minimum()"
          [attr.tabindex]="minimum() ? 0 : -1"
          (click)="pickUntil(true)"
        >
          <span class="pe-mk">@if (minimum()) { <i></i> }</span>
          <span class="pe-ot">
            <b>Fica pelo menos até uma data</b>
            <span>No fim, você renova pelo tempo que quiser.</span>
          </span>
        </button>
      </div>
    </div>

    <div class="pe-g2">
      <div>
        <app-calendar-field
          [label]="minimum() ? 'Fica pelo menos até' : 'Devolve em'"
          [required]="true"
          testId="end-date"
          [months]="2"
          [value]="value().endDate"
          [rangeStart]="value().startDate || null"
          [min]="endMin()"
          [error]="errors()['endDate'] ?? null"
          (valueChange)="patch.emit({ endDate: $event })"
          (closed)="touched.emit('endDate')"
        >
          @if (sentence(); as s) {
            De {{ startShort() }} a <b>{{ s.endLong }}</b>. São {{ s.length }}.
          } @else if (endDay(); as d) {
            {{ minimum() ? 'Fica até' : 'Devolve' }} {{ d.article }} <b>{{ d.day }}</b>
          }
        </app-calendar-field>
      </div>
      @if (sentence(); as s) {
        @if (minimum()) {
          <p class="pe-say" data-testid="period-sentence">
            A partir de <b>{{ s.startShort }}</b>, <b>no mínimo {{ s.length }}</b>. Perto de {{ s.endShort }} a gente te
            avisa para renovar.
          </p>
        } @else {
          <p class="pe-say" data-testid="period-sentence">De <b>{{ s.range }}</b>. São <b>{{ s.length }}</b>.</p>
        }
      }
    </div>
  `,
})
export class CardPeriod {
  readonly value = input.required<PeriodValue>();
  readonly errors = input<Readonly<Partial<Record<string, string>>>>({});
  readonly sentence = input<PeriodSentence | null>(null);

  readonly patch = output<Partial<PeriodValue>>();
  readonly touched = output<string>();

  protected readonly minimum = computed(() => this.value().minimumTerm === true);
  protected readonly startDay = computed(() => onWeekday(this.value().startDate));
  protected readonly pickupDay = computed(() => onWeekday(this.value().pickupDay));
  protected readonly endDay = computed(() => onWeekday(this.value().endDate));
  protected readonly startShort = computed(() => this.value().startDate.slice(8, 10) + '/' + this.value().startDate.slice(5, 7));
  /** A devolução é depois da retirada: o dia da retirada já vem apagado. */
  protected readonly endMin = computed(() => {
    const s = this.value().startDate;
    return s ? addDaysIso(s, 1) : null;
  });

  protected pickUntil(minimum: boolean): void {
    if (minimum !== this.minimum()) this.patch.emit({ minimumTerm: minimum });
  }

  /** Setas trocam a opção (radiogroup). */
  protected onUntilKey(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = !this.minimum();
    this.pickUntil(next);
    const host = event.currentTarget as HTMLElement | null;
    host?.querySelector<HTMLElement>(next ? '[data-testid="until-minimum"]' : '[data-testid="until-fixed"]')?.focus();
  }

  protected onTime(event: Event): void {
    this.patch.emit({ pickupTime: (event.target as HTMLInputElement).value });
  }
}
