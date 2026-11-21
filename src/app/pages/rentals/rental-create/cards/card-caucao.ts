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

import { CalendarField } from '../../../../components/calendar-field/calendar-field';
import { InfoTip } from '../../../../components/info-tip/info-tip';
import { applyPtBrMoneyMaskToControl } from '../../../../utils/ptbr-money-mask';
import { brl } from '../../rental-wizard/wizard-format';
import { CaucaoParts, CreateRentalForm } from '../create-form';
import { PreviewModel, PreviewSheet } from './preview-sheet';

/**
 * Card 3 · Caução (pranchas CauC1–C5 / CauD1–D4). Valor, "Recebi por fora" e as três caixas
 * (valor cheio · desconto · parcelar). O formulário é da página (`RentalCreate`); aqui só os
 * campos, as frases e a prévia.
 */
@Component({
  selector: 'app-rc-caucao',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, NgTemplateOutlet, CalendarField, InfoTip, PreviewSheet],
  host: { class: 'rc-cb' },
  // Folha compartilhada com o outro card de dinheiro, sem encapsulamento (classes rc-*).
  styleUrl: './card-form.css',
  encapsulation: ViewEncapsulation.None,
  templateUrl: './card-caucao.html',
})
export class CardCaucao {
  readonly form = input.required<CreateRentalForm>();
  readonly parts = input.required<CaucaoParts>();
  /** Valores de agora (o formulário reativo não é sinal). */
  readonly paid = input(false);
  readonly descOn = input(false);
  readonly splitOn = input(false);
  readonly grossCents = input(0);
  readonly netCents = input(0);
  readonly partDues = input<readonly string[]>([]);
  readonly partsSum = input(0);
  readonly errors = input<Readonly<Partial<Record<string, string>>>>({});
  readonly today = input('');
  readonly preview = input<PreviewModel | null>(null);

  readonly check = output<'full' | 'desc' | 'split'>();
  readonly togglePaid = output<void>();
  readonly addPart = output<void>();
  readonly removePart = output<number>();
  /** Digitou o valor de uma parte (as partes param de se redividir sozinhas). */
  readonly partEdited = output<void>();
  readonly touched = output<string>();

  protected readonly previewOpen = signal(false);
  protected readonly full = computed(() => !this.descOn() && !this.splitOn());
  protected readonly grossText = computed(() => brl(this.grossCents()));
  protected readonly netText = computed(() => brl(this.netCents()));
  protected readonly sumOk = computed(() => this.partsSum() === this.netCents() && this.netCents() > 0);
  protected readonly sumText = computed(() => brl(this.partsSum()));

  protected money(event: Event, control: AbstractControl): void {
    applyPtBrMoneyMaskToControl(event, control);
  }

  protected setDue(i: number, due: string): void {
    this.parts().at(i)?.controls.due.setValue(due);
  }
}
