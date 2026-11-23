import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';

import { InfoTip } from '../../../../components/info-tip/info-tip';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../../../components/segmented-toggle/segmented-toggle';
import { RentalBillingFrequency } from '../../../../types/rental.types';
import { applyPtBrMoneyMaskToControl } from '../../../../utils/ptbr-money-mask';
import { PeriodWords, brl } from '../../rental-wizard/wizard-format';
import { CreateRentalForm, PeriodParts } from '../create-form';
import { PreviewModel, PreviewSheet } from './preview-sheet';

/** Opção marcada: laranja sólido com texto branco (pranchas CobK/CobD). */
const ON = { activeBackground: 'var(--color-primary-500)', activeShadow: 'none' } as const;

export interface WeekItem {
  i: number;
  label: string;
  date: string;
  on: boolean;
  past: boolean;
}

/**
 * Card 4 · Cobranças (pranchas CobK1–K4, K6 / CobD1–D4). Frequência, valor de cada período e
 * as três caixas (valor cheio · desconto nas primeiras · parcelar em partes). O formulário é da
 * página (`RentalCreate`); aqui só os campos, as frases e a prévia.
 */
@Component({
  selector: 'app-rc-charges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, NgTemplateOutlet, InfoTip, SegmentedToggle, PreviewSheet],
  host: { class: 'rc-cb' },
  // Folha compartilhada com o outro card de dinheiro, sem encapsulamento (classes rc-*).
  styleUrl: './card-form.css',
  encapsulation: ViewEncapsulation.None,
  templateUrl: './card-charges.html',
})
export class CardCharges {
  readonly form = input.required<CreateRentalForm>();
  readonly parts = input.required<PeriodParts>();
  readonly frequency = input<RentalBillingFrequency>('WEEKLY');
  readonly words = input.required<PeriodWords>();
  readonly rateCents = input(0);
  readonly rateHint = input('');
  readonly descOn = input(false);
  readonly splitOn = input(false);
  readonly scope = input<'ALL' | 'SOME'>('ALL');
  readonly discountN = input('1');
  readonly firstNOptions = input<ReadonlyArray<{ value: string; label: string }>>([]);
  readonly discountHint = input('');
  readonly partOffsets = input<readonly number[]>([]);
  readonly partOptions = input<ReadonlyArray<{ value: number; label: string }>>([]);
  readonly partsSum = input(0);
  /** N1 — o valor que as partes somam: o do período parcelado, com o desconto dele (0 = cheio). */
  readonly partsTargetCents = input(0);
  /** N1 — as partes dos períodos de outro valor, por extenso ('' = não há). */
  readonly otherPartsHint = input('');
  readonly canAddPart = input(true);
  /** Há escolha a tirar (deixou de existir ou já venceu). */
  readonly canDrop = input(false);
  readonly weeks = input<readonly WeekItem[]>([]);
  readonly errors = input<Readonly<Partial<Record<string, string>>>>({});
  readonly preview = input<PreviewModel | null>(null);

  readonly frequencyChange = output<RentalBillingFrequency>();
  readonly check = output<'full' | 'desc' | 'split'>();
  readonly scopeChange = output<'ALL' | 'SOME'>();
  readonly toggleWeek = output<number>();
  readonly dropStale = output<void>();
  readonly addPart = output<void>();
  readonly removePart = output<number>();
  /** Digitou o valor de uma parte (as partes param de se redividir sozinhas). */
  readonly partEdited = output<void>();
  readonly touched = output<string>();

  protected readonly freqOptions: SegmentedToggleOption<RentalBillingFrequency>[] = [
    { value: 'DAILY', label: 'Por dia', ...ON },
    { value: 'WEEKLY', label: 'Por semana', ...ON },
    { value: 'MONTHLY', label: 'Por mês', ...ON },
  ];
  protected readonly scopeOptions = computed<SegmentedToggleOption<'ALL' | 'SOME'>[]>(() => [
    { value: 'ALL', label: this.words().fem ? 'Todas' : 'Todos', ...ON },
    { value: 'SOME', label: this.words().fem ? 'Só algumas' : 'Só alguns', ...ON },
  ]);

  protected readonly previewOpen = signal(false);
  protected readonly full = computed(() => !this.descOn() && !this.splitOn());
  protected readonly rateText = computed(() => brl(this.rateCents()));
  private readonly target = computed(() => this.partsTargetCents() || this.rateCents());
  protected readonly sumOk = computed(() => this.target() > 0 && this.partsSum() === this.target());
  /** "o valor da semana" ou, num período com desconto, "o valor da semana com desconto". */
  protected readonly sumOf = computed(
    () => `o valor ${this.ofOne()}${this.target() < this.rateCents() ? ' com desconto' : ''}`,
  );
  protected readonly sumText = computed(() => brl(this.partsSum()));
  /** "semanas" / "dias" / "meses" com o artigo: "as semanas", "os dias". */
  protected readonly theMany = computed(() => `${this.words().fem ? 'as' : 'os'} ${this.words().lowerMany}`);
  protected readonly allMany = computed(() => `${this.words().fem ? 'todas as' : 'todos os'} ${this.words().lowerMany}`);
  protected readonly some = computed(() => `${this.words().fem ? 'algumas' : 'alguns'} ${this.words().lowerMany}`);
  protected readonly theOne = computed(() => `${this.words().fem ? 'a' : 'o'} ${this.words().lower}`);
  protected readonly ofOne = computed(() => `d${this.words().fem ? 'a' : 'o'} ${this.words().lower}`);
  /** Por semana, "Vence na" com o dia da semana; por dia e por mês, "Vence" com os dias depois. */
  protected readonly dueLabel = computed(() => (this.frequency() === 'WEEKLY' ? 'Vence na' : 'Vence'));
  protected readonly scopeLabel = computed(() => `Parcelar quais ${this.words().lowerMany}`);

  protected money(event: Event, control: AbstractControl): void {
    applyPtBrMoneyMaskToControl(event, control);
  }

  protected setDiscountN(event: Event): void {
    this.form().controls.discountN.setValue((event.target as HTMLSelectElement).value);
  }

  protected setOffset(i: number, event: Event): void {
    this.parts().at(i)?.controls.offset.setValue(Number((event.target as HTMLSelectElement).value));
  }
}
