import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { CalendarField } from '../../../../components/calendar-field/calendar-field';
import { addDaysIso } from '../../charges-flex/charges-flex';
import { PeriodSentence, PeriodValue, onWeekday } from '../create-rules';

/**
 * Card 2 · Período (pranchas PerF1–F4 / PerG1–G3). Só "Tem data para devolver" nesta entrega:
 * a opção "Fica pelo menos até" (data mínima) é um item próprio e o "Até quando?" nem aparece.
 * O estado é da página (`RentalCreate`): aqui só se mostra e se avisa.
 */
@Component({
  selector: 'app-rc-period',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalendarField],
  host: { class: 'rc-cb' },
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

    <div class="pe-g2">
      <div>
        <app-calendar-field
          label="Devolve em"
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
            Devolve {{ d.article }} <b>{{ d.day }}</b>
          }
        </app-calendar-field>
      </div>
      @if (sentence(); as s) {
        <p class="pe-say" data-testid="period-sentence">De <b>{{ s.range }}</b>. São <b>{{ s.length }}</b>.</p>
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

  protected readonly startDay = computed(() => onWeekday(this.value().startDate));
  protected readonly pickupDay = computed(() => onWeekday(this.value().pickupDay));
  protected readonly endDay = computed(() => onWeekday(this.value().endDate));
  protected readonly startShort = computed(() => this.value().startDate.slice(8, 10) + '/' + this.value().startDate.slice(5, 7));
  /** A devolução é depois da retirada: o dia da retirada já vem apagado. */
  protected readonly endMin = computed(() => {
    const s = this.value().startDate;
    return s ? addDaysIso(s, 1) : null;
  });

  protected onTime(event: Event): void {
    this.patch.emit({ pickupTime: (event.target as HTMLInputElement).value });
  }
}
