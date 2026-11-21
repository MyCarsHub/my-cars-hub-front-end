import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';

import { CalendarField } from '../../../../components/calendar-field/calendar-field';
import { InfoTip } from '../../../../components/info-tip/info-tip';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../../../../components/segmented-toggle/segmented-toggle';
import { RentalBillingFrequency, RentalLateFineType } from '../../../../types/rental.types';
import { applyPtBrMoneyMaskToControl } from '../../../../utils/ptbr-money-mask';
import { ptBrMoneyCents } from '../../../../utils/validators/ptbr-money.validator';
import { brl } from '../../rental-wizard/wizard-format';
import { CreateRentalForm } from '../create-form';
import { onWeekday } from '../create-rules';
import {
  CUSTOM_FUEL_MAX,
  FUEL_OPTIONS,
  FUEL_OTHER,
  TermsValue,
  dueStep,
  fineHint,
  firstDueHint,
  interestHint,
  interestPerDayCents,
  kmLimitHint,
  maskKm,
} from './terms-rules';

/** Opção marcada: laranja sólido com texto branco (o mesmo do card Cobranças). */
const ON = { activeBackground: 'var(--color-primary-500)', activeShadow: 'none' } as const;

export interface FuelOption {
  value: string;
  label: string;
}

/**
 * Card 5 · Condições de pagamento (pranchas CondP1–P4 / CondD1–D3). Quatro grupos: Vencimento,
 * Se atrasar, Quilometragem e Combustível. O formulário é da página (`RentalCreate`): os campos
 * escrevem nos controles dela; `value` é o valor de agora (o formulário reativo não é sinal).
 */
@Component({
  selector: 'app-rc-terms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CalendarField, InfoTip, SegmentedToggle],
  host: {
    class: 'rc-cb',
    '(document:pointerdown)': 'onOutside($event)',
  },
  templateUrl: './card-terms.html',
  styleUrl: './card-terms.css',
  // Folha compartilhada pelos cards 5 a 8, sem encapsulamento (classes rt-*).
  encapsulation: ViewEncapsulation.None,
  styles: `
    /* O rótulo do calendário fica só para o leitor de tela: o visível é o nosso, com o (i). */
    .rt-fld.rt-due .cf-anchor .cf-lb {
      position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
      clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
    .rt-lx-f {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 48px;
      font: inherit; font-size: 16px; line-height: 24px; text-align: left; cursor: pointer;
      background: var(--color-surface); color: var(--color-fg-body);
      border: 1px solid var(--color-edge-field); border-radius: 12px; padding: 11px 16px;
    }
    .rt-lx-f.empty { color: var(--color-fg-faint); }
    .rt-lx-f.open, .rt-lx-f:focus-visible { outline: none; border-color: var(--color-primary-600); box-shadow: 0 0 0 1px var(--color-primary-600); }
    .rt-lx-f svg { flex: none; color: var(--color-fg-muted); transition: transform 250ms cubic-bezier(0.32, 0.72, 0, 1); }
    .rt-lx-f.open svg { transform: rotate(180deg); }
    .rt-lx-pn {
      margin-top: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; outline: none;
      border: 1px solid var(--color-edge-field); border-radius: 12px; background: var(--color-surface);
      animation: rt-lx-in 240ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    .rt-lx-pn:focus-visible { border-color: var(--color-primary-600); }
    @keyframes rt-lx-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .rt-lx-o {
      display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border-radius: 12px;
      font-size: 16px; line-height: 24px; color: var(--color-fg); cursor: pointer;
    }
    .rt-lx-o span { flex: 1; min-width: 0; }
    .rt-lx-o.hl { background: color-mix(in srgb, var(--color-fg) 7%, transparent); }
    .rt-lx-o[aria-selected='true'] { font-weight: 600; color: var(--color-primary-700); }
    .dark .rt-lx-o[aria-selected='true'] { color: var(--color-primary-400); }
    @media (min-width: 1024px) {
      .rt-lx-pn { position: absolute; left: 0; right: 0; top: 100%; z-index: 30; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28); }
    }
    @media (prefers-reduced-motion: reduce) { .rt-lx-pn { animation: none; } .rt-lx-f svg { transition: none; } }
  `,
})
export class CardTerms {
  readonly form = input.required<CreateRentalForm>();
  /** Os valores de agora (a página passa `v()`). */
  readonly value = input.required<TermsValue>();
  readonly errors = input<Readonly<Partial<Record<string, string>>>>({});
  readonly frequency = input<RentalBillingFrequency>('WEEKLY');
  /** Valor de cada cobrança, em centavos: a base das frases da multa e dos juros. */
  readonly chargeCents = input(0);

  /** Um campo foi visitado (a página passa a mostrar o erro dele). */
  readonly touched = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly fuelOther = FUEL_OTHER;
  protected readonly customFuelMax = CUSTOM_FUEL_MAX;
  protected readonly fuelOptions: readonly FuelOption[] = [
    ...FUEL_OPTIONS.map((o) => ({ value: o, label: o })),
    { value: FUEL_OTHER, label: 'Outra regra' },
  ];
  protected readonly fineOptions: SegmentedToggleOption<RentalLateFineType>[] = [
    { value: 'PERCENT', label: '%', ...ON },
    { value: 'FIXED', label: 'R$', ...ON },
  ];
  protected readonly limitOptions: SegmentedToggleOption<boolean>[] = [
    { value: false, label: 'Sem limite', ...ON },
    { value: true, label: 'Com limite por dia', ...ON },
  ];

  protected readonly dueDay = computed(() => onWeekday(this.value().firstPaymentDate));
  protected readonly dueHint = computed(() => firstDueHint(this.value().firstPaymentDate, this.frequency()));
  protected readonly step = computed(() => dueStep(this.frequency()));
  protected readonly fixed = computed(() => this.value().lateFineType === 'FIXED');
  protected readonly fineText = computed(() =>
    fineHint(this.value().lateFineType, this.value().lateFineValue, this.chargeCents()),
  );
  protected readonly interestText = computed(() => interestHint(this.value().lateInterestPercent, this.chargeCents()));
  /** O exemplo do (i) dos juros, com os números de agora ("1,5% ao mês sobre R$ 600,00…"). */
  protected readonly interestExample = computed(() => {
    const day = interestPerDayCents(this.value().lateInterestPercent, this.chargeCents());
    if (day === null) return null;
    const pct = (ptBrMoneyCents(this.value().lateInterestPercent) ?? 0) / 100;
    return { pct: pct.toLocaleString('pt-BR'), charge: brl(this.chargeCents()), day: brl(day) };
  });
  protected readonly limitText = computed(() =>
    kmLimitHint(this.value().franchiseKm, this.value().extraKmPriceReais),
  );

  // ------------------------------------------------------------------ campos
  protected setFirstDue(iso: string): void {
    this.form().controls.firstPaymentDate.setValue(iso);
    this.touched.emit('firstPaymentDate');
  }

  /** Trocar % por R$ muda o significado do número: o campo recomeça vazio (o passo a passo faz igual). */
  protected setFineType(t: RentalLateFineType): void {
    if (this.form().controls.lateFineType.value === t) return;
    this.form().patchValue({ lateFineType: t, lateFineValue: '' });
  }

  protected setLimit(on: boolean): void {
    this.form().controls.hasKmLimit.setValue(on);
  }

  protected money(event: Event, control: AbstractControl): void {
    applyPtBrMoneyMaskToControl(event, control);
  }

  /** A multa em R$ usa a máscara de dinheiro; em %, o número como foi digitado. */
  protected fineInput(event: Event): void {
    if (this.fixed()) this.money(event, this.form().controls.lateFineValue);
  }

  protected km(event: Event, control: FormControl<string>): void {
    const el = event.target as HTMLInputElement;
    const { value, caret } = maskKm(el.value, el.selectionStart ?? el.value.length);
    control.setValue(value);
    el.value = value;
    el.setSelectionRange(caret, caret);
  }

  // ------------------------------------------------------------------ lista do combustível
  protected readonly fuelOpen = signal(false);
  protected readonly fuelActive = signal(0);
  protected readonly fuelLabel = computed(
    () => this.fuelOptions.find((o) => o.value === this.value().fuel)?.label ?? '',
  );

  protected toggleFuel(): void {
    if (this.fuelOpen()) {
      this.closeFuel(true);
      return;
    }
    const sel = this.fuelOptions.findIndex((o) => o.value === this.value().fuel);
    this.fuelActive.set(sel >= 0 ? sel : 0);
    this.fuelOpen.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.rt-lx-pn')?.focus(), {
      injector: this.injector,
    });
  }

  protected closeFuel(returnFocus: boolean): void {
    if (!this.fuelOpen()) return;
    this.fuelOpen.set(false);
    this.touched.emit('fuel');
    if (returnFocus) {
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.rt-lx-f')?.focus(), {
        injector: this.injector,
      });
    }
  }

  protected pickFuel(value: string): void {
    this.form().controls.fuel.setValue(value);
    this.closeFuel(true);
  }

  protected onFuelTriggerKey(event: KeyboardEvent): void {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !this.fuelOpen()) {
      event.preventDefault();
      this.toggleFuel();
    }
  }

  protected onFuelKey(event: KeyboardEvent): void {
    const last = this.fuelOptions.length - 1;
    const move: Record<string, number> = {
      ArrowDown: Math.min(this.fuelActive() + 1, last),
      ArrowUp: Math.max(this.fuelActive() - 1, 0),
      Home: 0,
      End: last,
    };
    if (event.key in move) {
      event.preventDefault();
      this.fuelActive.set(move[event.key]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.pickFuel(this.fuelOptions[this.fuelActive()].value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeFuel(true);
    } else if (event.key === 'Tab') {
      this.closeFuel(false);
    }
  }

  protected onOutside(event: Event): void {
    if (!this.fuelOpen()) return;
    const box = this.host.nativeElement.querySelector('.rt-lx');
    if (!box?.contains(event.target as Node | null)) this.closeFuel(false);
  }
}
