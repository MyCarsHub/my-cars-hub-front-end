import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { DateField } from '../../../components/core/date-field/date-field';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';
import { formatPtBrMoney } from '../../../utils/ptbr-number';
import {
  ChargePlanDto,
  ChargePlanInstalment,
  RentalBillingFrequency,
  RentalChargePreviewBlockerDto,
  RentalChargePreviewItemDto,
} from '../../../types/rental.types';
import {
  INTERVAL_UNIT_OPTIONS,
  IntervalUnit,
  MAX_SPLIT_INTERVAL_DAYS,
  MIN_GATEWAY_CENTS,
  PlanState,
  addDaysIso,
  brDate,
  brDayMonth,
  brl,
  buildChargePlan,
  buildInstalments,
  discountFor,
  instalmentProblems,
  intervalToDays,
  percentTextToBps,
  periodWord,
  periodWordPlural,
  splitEvenly,
} from './charges-flex';
import { planBlockerMessage } from './flex-errors';

/** O que o editor entrega ao formulário a cada mudança. */
export interface ChargePlanChange {
  /** `null` = sem plano (a chave `chargePlan` nem vai no corpo). */
  plan: ChargePlanDto | null;
  /** Falso quando há algo a corrigir: o formulário não deixa criar. */
  valid: boolean;
  /** Desconto somado de todos os períodos (estimativa local para o "Total previsto"). */
  discountTotalCents: number;
}

/** Um período como a prévia o devolveu (as parcelas dele já somadas). */
interface PeriodRow {
  index: number;
  dueDate: string;
  amountCents: number;
  /** Valor cheio, antes do desconto da prévia. */
  fullCents: number;
  local: boolean;
}

interface PeriodOverride {
  periodIndex: number;
  /** Vencimento e valor CHEIO do período quando o parcelamento foi feito. */
  baseDue: string;
  fullCents: number;
  /** Valor, 1º vencimento, frequência e nº de períodos quando foi salvo (ver `contextKey`). */
  context: string;
  count: number;
  intervalN: number;
  unit: IntervalUnit;
  first: string;
}

interface CaucaoPart {
  key: number;
  amount: FormControl<string>;
  due: string;
}

let partKey = 0;

/**
 * FEAT-0573 — jornadas A, B, C e H1: "Dividir a caução" e "Como cobrar o aluguel" no Novo
 * aluguel. Só existe com `CHARGES_FLEX`; "Valor cheio" vem marcado e, assim, nada muda no
 * corpo enviado. Desconto e parcelas podem ir juntos (canvas aprovado).
 */
@Component({
  selector: 'app-charge-plan-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, BottomSheet, DateField, AlertBanner],
  templateUrl: './charge-plan-editor.html',
})
export class ChargePlanEditor {
  readonly frequency = input.required<RentalBillingFrequency>();
  readonly rateCents = input<number | null>(null);
  readonly periods = input(0);
  readonly caucaoCents = input(0);
  /** Caução marcada como recebida por fora: não há o que dividir. */
  readonly caucaoPaid = input(false);
  readonly firstDue = input<string | null>(null);
  readonly automatic = input(true);
  readonly lateFineFixedCents = input<number | null>(null);
  readonly today = input.required<string>();
  /** Linhas da última prévia do backend (já com o plano aplicado). */
  readonly previewItems = input<readonly RentalChargePreviewItemDto[]>([]);
  readonly previewBlocker = input<RentalChargePreviewBlockerDto | null>(null);

  readonly planChange = output<ChargePlanChange>();

  protected readonly word = computed(() => periodWord(this.frequency()));
  protected readonly wordPlural = computed(() => periodWordPlural(this.frequency()));
  protected readonly intervalUnits = INTERVAL_UNIT_OPTIONS;
  private readonly minCents = computed(() => (this.automatic() ? MIN_GATEWAY_CENTS : 1));

  // ------------------------------------------------------------ Como cobrar
  protected readonly discountOn = signal(false);
  protected readonly splitOn = signal(false);
  protected readonly fullValue = computed(() => !this.discountOn() && !this.splitOn());

  protected chooseFull(): void {
    this.discountOn.set(false);
    this.splitOn.set(false);
  }

  protected toggleDiscount(): void {
    this.discountOn.update((v) => !v);
  }

  protected toggleSplit(): void {
    this.splitOn.update((v) => !v);
  }

  // ------------------------------------------------------------ Desconto
  protected readonly discountType = signal<'AMOUNT' | 'PERCENT'>('AMOUNT');
  protected readonly discountPeriods = signal(1);
  protected readonly discountValue = new FormControl('', {
    nonNullable: true,
    validators: [ptBrMoneyValidator({ minCents: 1 })],
  });
  private readonly discountText = toSignal(this.discountValue.valueChanges, { initialValue: '' });

  /** AMOUNT: centavos; PERCENT: basis points. */
  private readonly discountRaw = computed<number | null>(() => {
    const text = this.discountText();
    return this.discountType() === 'AMOUNT' ? ptBrMoneyCents(text) : percentTextToBps(text);
  });
  protected readonly discountPerPeriod = computed(() => {
    const rate = this.rateCents() ?? 0;
    const raw = this.discountRaw();
    if (!rate || raw === null) return 0;
    return discountFor(rate, this.discountType(), raw);
  });
  protected readonly discountedRate = computed(() => (this.rateCents() ?? 0) - this.discountPerPeriod());
  private readonly discountPeriodsClamped = computed(() =>
    Math.max(1, Math.min(this.discountPeriods(), Math.max(1, this.periods()))),
  );

  protected readonly discountProblem = computed<string | null>(() => {
    if (!this.discountOn()) return null;
    const raw = this.discountRaw();
    if (raw === null && this.discountType() === 'PERCENT' && this.discountText().trim() !== '') {
      return 'Use um número com até duas casas decimais (ex.: 12,5).';
    }
    if (raw === null || raw <= 0) return 'Informe o desconto.';
    if (this.discountType() === 'PERCENT' && raw > 9999) return 'O desconto em porcentagem vai até 99,99%.';
    if (this.discountPeriods() < 1 || this.discountPeriods() > Math.max(1, this.periods())) {
      return `O desconto vale para 1 a ${Math.max(1, this.periods())} ${this.wordPlural()}.`;
    }
    if (this.discountedRate() < this.minCents()) {
      return this.automatic()
        ? `Com esse desconto a cobrança ficaria abaixo de ${brl(MIN_GATEWAY_CENTS)}.`
        : 'O desconto não pode ser o valor inteiro da cobrança.';
    }
    return null;
  });

  protected readonly discountSummary = computed(() => {
    const n = this.discountPeriodsClamped();
    const word = this.word();
    const names =
      n === 1
        ? `${word} 1 sai`
        : n <= 4
          ? `${this.wordPlural().charAt(0).toUpperCase() + this.wordPlural().slice(1)} ${Array.from({ length: n }, (_, i) => i + 1).join(', ').replace(/, (\d+)$/, ' e $1')} saem`
          : `As ${n} primeiras ${this.wordPlural()} saem`;
    const rest =
      n < this.periods()
        ? ` Da ${word.toLowerCase()} ${n + 1} em diante, ${brl(this.rateCents())}.`
        : '';
    return `${names} a ${brl(this.discountedRate())}.${rest} Multa e juros contam sobre o valor com desconto.`;
  });

  protected setDiscountType(type: 'AMOUNT' | 'PERCENT'): void {
    if (this.discountType() === type) return;
    this.discountType.set(type);
    this.discountValue.setValue('');
  }

  protected onDiscountInput(event: Event): void {
    if (this.discountType() === 'AMOUNT') applyPtBrMoneyMaskToControl(event, this.discountValue);
    else this.discountValue.setValue((event.target as HTMLInputElement).value);
  }

  protected setDiscountPeriods(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.discountPeriods.set(Number.isFinite(n) ? n : 1);
  }

  // ------------------------------------------------------------ Parcelar
  protected readonly splitScope = signal<'ALL' | 'SOME'>('SOME');
  protected readonly splitCount = signal(2);
  protected readonly splitIntervalN = signal(7);
  protected readonly splitIntervalUnit = signal<IntervalUnit>('DAYS');
  private readonly splitIntervalDays = computed(() =>
    intervalToDays(this.splitIntervalN(), this.splitIntervalUnit()),
  );

  protected readonly splitAllProblem = computed<string | null>(() => {
    if (!this.splitOn() || this.splitScope() !== 'ALL') return null;
    if (this.splitCount() < 2 || this.splitCount() > 12) return 'Escolha de 2 a 12 parcelas.';
    const days = this.splitIntervalDays();
    if (days < 1 || days > MAX_SPLIT_INTERVAL_DAYS) {
      return `Para parcelar todas, o intervalo entre as parcelas vai de 1 a ${MAX_SPLIT_INTERVAL_DAYS} dias.`;
    }
    const smallest = Math.floor(this.discountedRateForSplit() / this.splitCount());
    if (smallest < this.minCents()) {
      return `Cada parcela precisa ser de pelo menos ${brl(this.minCents())}. Cada uma ficaria com ${brl(smallest)}.`;
    }
    return this.fineShareProblem(
      this.splitCount(),
      splitEvenly(this.discountedRateForSplit(), this.splitCount()).map((amountCents) => ({ dueDate: '', amountCents })),
    );
  });

  /**
   * B2: a multa FIXA dividida (centavos na última) precisa ser menor que cada parcela.
   * Conferido aqui para o aviso sair junto do de R$ 5,00, antes da prévia.
   */
  private fineShareProblem(count: number, instalments: readonly ChargePlanInstalment[]): string | null {
    const fine = this.lateFineFixedCents();
    if (!fine || fine <= 0 || instalments.length === 0) return null;
    const shares = splitEvenly(fine, count);
    const i = instalments.findIndex((p, k) => (shares[k] ?? 0) >= p.amountCents);
    if (i < 0) return null;
    return `A multa fixa dividida (${brl(shares[i])}) precisa ser menor que a parcela (${brl(instalments[i].amountCents)}).`;
  }

  /** O menor valor de período que vai ser dividido (com desconto, se houver). */
  private discountedRateForSplit(): number {
    return this.discountOn() && this.discountPerPeriod() > 0 ? this.discountedRate() : (this.rateCents() ?? 0);
  }

  protected setSplitScope(scope: 'ALL' | 'SOME'): void {
    this.splitScope.set(scope);
  }

  protected setSplitCount(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.splitCount.set(Number.isFinite(n) ? n : 2);
  }

  protected setSplitIntervalN(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.splitIntervalN.set(Number.isFinite(n) && n > 0 ? n : 1);
  }

  protected setSplitIntervalUnit(event: Event): void {
    this.splitIntervalUnit.set((event.target as HTMLSelectElement).value as IntervalUnit);
  }

  /** Períodos da prévia (parcelas somadas por período). */
  protected readonly periodRows = computed<PeriodRow[]>(() => {
    const groups = new Map<number, PeriodRow>();
    for (const item of this.previewItems()) {
      if (item.kind !== 'RENTAL_PERIOD') continue;
      const g = groups.get(item.index);
      const discount = item.discountCents ?? 0;
      if (g) {
        g.amountCents += item.amountCents;
        g.fullCents += item.amountCents + discount;
        if (item.dueDate < g.dueDate) g.dueDate = item.dueDate;
      } else {
        groups.set(item.index, {
          index: item.index,
          dueDate: item.dueDate,
          amountCents: item.amountCents,
          fullCents: item.amountCents + discount,
          local: item.destination === 'LOCAL',
        });
      }
    }
    return [...groups.values()].sort((a, b) => a.index - b.index);
  });

  protected readonly showAllPeriods = signal(false);
  protected readonly visiblePeriods = computed(() =>
    this.showAllPeriods() ? this.periodRows() : this.periodRows().slice(0, 3),
  );

  protected readonly overrides = signal<ReadonlyMap<number, PeriodOverride>>(new Map());

  protected overrideOf(index: number): PeriodOverride | null {
    return this.overrides().get(index) ?? null;
  }

  /** Desconto que o plano ATUAL dá ao período `index` (0 fora dos primeiros). */
  private discountAt(index: number): number {
    if (!this.discountOn() || this.discountProblem()) return 0;
    return index < this.discountPeriodsClamped() ? this.discountPerPeriod() : 0;
  }

  /** Valor do período com o desconto atual — o que as parcelas precisam somar (B2). */
  protected periodAmount(index: number, fullCents: number): number {
    return fullCents - this.discountAt(index);
  }

  protected overrideInstalments(o: PeriodOverride): ChargePlanInstalment[] {
    return buildInstalments(
      this.periodAmount(o.periodIndex, o.fullCents),
      o.count,
      o.first,
      intervalToDays(o.intervalN, o.unit),
    );
  }

  protected overrideCaption(o: PeriodOverride): string {
    const list = this.overrideInstalments(o);
    const amounts = new Set(list.map((i) => i.amountCents));
    const value = amounts.size === 1 ? brl(list[0].amountCents) : `${brl(list[0].amountCents)} a ${brl(list[list.length - 1].amountCents)}`;
    return `${value} em ${list.map((i) => brDayMonth(i.dueDate)).join(', ').replace(/, ([^,]+)$/, ' e $1')}`;
  }

  // ------------------------------------------------------------ folha "Parcelar a Semana N"
  protected readonly editing = signal<{ index: number; full: number; due: string; existing: boolean } | null>(null);
  protected readonly editingAmount = computed(() => {
    const e = this.editing();
    return e ? this.periodAmount(e.index, e.full) : 0;
  });
  protected readonly sheetCount = signal(3);
  protected readonly sheetIntervalN = signal(2);
  protected readonly sheetUnit = signal<IntervalUnit>('DAYS');
  protected readonly sheetFirst = signal('');

  protected readonly sheetInstalments = computed(() => {
    const e = this.editing();
    if (!e) return [];
    return buildInstalments(
      this.editingAmount(),
      this.sheetCount(),
      this.sheetFirst() || e.due,
      intervalToDays(this.sheetIntervalN(), this.sheetUnit()),
    );
  });

  protected readonly sheetFineShares = computed<number[] | null>(() => {
    const fine = this.lateFineFixedCents();
    if (!fine || fine <= 0) return null;
    return splitEvenly(fine, this.sheetCount());
  });

  protected readonly sheetProblems = computed(() => {
    const e = this.editing();
    if (!e) return [];
    const problems = instalmentProblems(this.sheetInstalments(), {
      expectedTotal: this.editingAmount(),
      today: this.today(),
      minCents: this.minCents(),
    });
    if (this.sheetCount() < 2 || this.sheetCount() > 24) problems.unshift('Escolha de 2 a 24 parcelas.');
    const fine = this.fineShareProblem(this.sheetCount(), this.sheetInstalments());
    if (fine) problems.push(fine);
    return problems;
  });

  protected openPeriod(row: PeriodRow): void {
    const o = this.overrideOf(row.index);
    this.editing.set({
      index: row.index,
      full: o?.fullCents ?? row.fullCents,
      due: o?.baseDue ?? row.dueDate,
      existing: !!o,
    });
    this.sheetCount.set(o?.count ?? 3);
    this.sheetIntervalN.set(o?.intervalN ?? 2);
    this.sheetUnit.set(o?.unit ?? 'DAYS');
    this.sheetFirst.set(o?.first ?? (row.dueDate < this.today() ? this.today() : row.dueDate));
  }

  protected setSheetCount(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.sheetCount.set(Number.isFinite(n) ? n : 2);
  }

  protected setSheetIntervalN(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.sheetIntervalN.set(Number.isFinite(n) && n > 0 ? n : 1);
  }

  protected setSheetUnit(event: Event): void {
    this.sheetUnit.set((event.target as HTMLSelectElement).value as IntervalUnit);
  }

  protected saveSheet(sheet: BottomSheet): void {
    const e = this.editing();
    if (!e || this.sheetProblems().length > 0) return;
    const next = new Map(this.overrides());
    next.set(e.index, {
      periodIndex: e.index,
      baseDue: e.due,
      fullCents: e.full,
      context: this.contextKey(),
      count: this.sheetCount(),
      intervalN: this.sheetIntervalN(),
      unit: this.sheetUnit(),
      first: this.sheetFirst() || e.due,
    });
    this.overrides.set(next);
    sheet.requestClose(true);
  }

  protected removeOverride(sheet: BottomSheet): void {
    const e = this.editing();
    if (!e) return;
    const next = new Map(this.overrides());
    next.delete(e.index);
    this.overrides.set(next);
    sheet.requestClose(true);
  }

  protected onSheetClosed(): void {
    this.editing.set(null);
  }

  // ------------------------------------------------------------ Dividir a caução
  protected readonly caucaoSplitOn = signal(false);
  protected readonly parts = signal<CaucaoPart[]>([]);
  private readonly partsVersion = signal(0);
  protected readonly canSplitCaucao = computed(() => this.caucaoCents() > 0 && !this.caucaoPaid());

  protected toggleCaucaoSplit(): void {
    const on = !this.caucaoSplitOn();
    this.caucaoSplitOn.set(on);
    if (on && this.parts().length === 0) {
      const first = this.firstDue() && this.firstDue()! >= this.today() ? this.firstDue()! : this.today();
      const [a, b] = splitEvenly(this.caucaoCents(), 2);
      this.parts.set([this.newPart(a, first), this.newPart(b, addDaysIso(first, 7))]);
    }
  }

  private newPart(cents: number | null, due: string): CaucaoPart {
    const amount = new FormControl(cents !== null && cents > 0 ? formatPtBrMoney(cents) : '', {
      nonNullable: true,
      validators: [ptBrMoneyValidator({ minCents: 1 })],
    });
    amount.valueChanges.subscribe(() => this.partsVersion.update((v) => v + 1));
    return { key: ++partKey, amount, due };
  }

  protected onPartInput(event: Event, part: CaucaoPart): void {
    applyPtBrMoneyMaskToControl(event, part.amount);
  }

  protected setPartDue(part: CaucaoPart, value: string): void {
    this.parts.update((list) => list.map((p) => (p.key === part.key ? { ...p, due: value } : p)));
  }

  protected addPart(): void {
    if (this.parts().length >= 24) return;
    const last = this.parts()[this.parts().length - 1];
    this.parts.update((list) => [...list, this.newPart(null, addDaysIso(last?.due ?? this.today(), 7))]);
  }

  protected removePart(part: CaucaoPart): void {
    if (this.parts().length <= 2) return;
    this.parts.update((list) => list.filter((p) => p.key !== part.key));
  }

  private readonly caucaoInstalments = computed<ChargePlanInstalment[]>(() => {
    this.partsVersion();
    return this.parts().map((p) => ({ dueDate: p.due, amountCents: ptBrMoneyCents(p.amount.value) ?? 0 }));
  });

  protected readonly partsSum = computed(() =>
    this.caucaoInstalments().reduce((acc, p) => acc + p.amountCents, 0),
  );

  protected readonly caucaoProblems = computed(() => {
    if (!this.caucaoSplitOn() || !this.canSplitCaucao()) return [];
    return instalmentProblems(this.caucaoInstalments(), {
      expectedTotal: this.caucaoCents(),
      today: this.today(),
      minCents: this.minCents(),
    }).map((p) =>
      p
        .replace(/parcelas/g, 'partes')
        .replace(/parcela/g, 'parte')
        .replace(/Parcela/g, 'Parte')
        .replace('valor da cobrança', 'valor da caução'),
    );
  });

  // ------------------------------------------------------------ plano
  private readonly state = computed<PlanState>(() => ({
    discount:
      this.discountOn() && this.discountRaw() !== null
        ? { type: this.discountType(), value: this.discountRaw(), firstPeriods: this.discountPeriods() }
        : null,
    splitAll:
      this.splitOn() && this.splitScope() === 'ALL'
        ? { count: this.splitCount(), intervalDays: this.splitIntervalDays() }
        : null,
    periodOverrides:
      this.splitOn() && this.splitScope() === 'SOME'
        ? [...this.overrides().values()].map((o) => ({
            periodIndex: o.periodIndex,
            instalments: this.overrideInstalments(o),
          }))
        : [],
    caucaoParts: this.caucaoSplitOn() && this.canSplitCaucao() ? this.caucaoInstalments() : null,
  }));

  protected readonly plan = computed(() => buildChargePlan(this.state()));

  /**
   * O que define um período: valor, 1ª cobrança, frequência e quantos períodos há. Mudou
   * qualquer um, o parcelamento salvo não vale mais (soma, datas ou o próprio período).
   */
  private readonly contextKey = computed(
    () => `${this.rateCents() ?? ''}|${this.firstDue() ?? ''}|${this.frequency()}|${this.periods()}`,
  );

  /** Avisa que parcelamentos foram desfeitos porque o aluguel mudou. */
  protected readonly staleNotice = signal<string | null>(null);

  /** Problemas das parcelas salvas, com o desconto ATUAL (B2: precisam somar o período). */
  protected readonly overrideProblems = computed<string[]>(() => {
    if (!this.splitOn() || this.splitScope() !== 'SOME') return [];
    const out: string[] = [];
    for (const o of this.overrides().values()) {
      const problems = instalmentProblems(this.overrideInstalments(o), {
        expectedTotal: this.periodAmount(o.periodIndex, o.fullCents),
        today: this.today(),
        minCents: this.minCents(),
      });
      const fine = this.fineShareProblem(o.count, this.overrideInstalments(o));
      if (fine) problems.push(fine);
      for (const p of problems) out.push(`${this.word()} ${o.periodIndex + 1}: ${p}`);
    }
    return out;
  });

  protected readonly valid = computed(
    () =>
      !this.discountProblem() &&
      !this.splitAllProblem() &&
      this.caucaoProblems().length === 0 &&
      this.overrideProblems().length === 0,
  );

  private readonly discountTotal = computed(() =>
    this.discountOn() && !this.discountProblem()
      ? this.discountPerPeriod() * this.discountPeriodsClamped()
      : 0,
  );

  private lastEmitted = '';

  constructor() {
    // Valor, datas ou nº de períodos mudaram: o parcelamento salvo desfaz-se (avisando) em vez
    // de viajar com uma soma ou um período que o backend recusaria.
    effect(() => {
      const key = this.contextKey();
      const current = untracked(() => this.overrides());
      const stale = [...current.values()].filter((o) => o.context !== key || o.periodIndex >= this.periods());
      if (stale.length === 0) return;
      const next = new Map(current);
      for (const o of stale) next.delete(o.periodIndex);
      untracked(() => {
        this.overrides.set(next);
        const names = stale.map((o) => `${this.word()} ${o.periodIndex + 1}`).join(', ');
        this.staleNotice.set(
          `O parcelamento de ${names} foi desfeito porque o valor ou as datas do aluguel mudaram. Parcele de novo.`,
        );
      });
    });
    effect(() => {
      const change: ChargePlanChange = {
        plan: this.plan(),
        valid: this.valid(),
        discountTotalCents: this.discountTotal(),
      };
      const key = JSON.stringify(change);
      if (key === this.lastEmitted) return;
      this.lastEmitted = key;
      untracked(() => this.planChange.emit(change));
    });
  }

  // ------------------------------------------------------------ texto
  protected blockerMessage(b: RentalChargePreviewBlockerDto): string {
    return planBlockerMessage(b);
  }

  protected money(cents: number | null | undefined): string {
    return brl(cents);
  }

  protected date(iso: string | null | undefined): string {
    return brDate(iso);
  }
}
