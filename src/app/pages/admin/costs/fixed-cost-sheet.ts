import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable, concatMap, of, tap } from 'rxjs';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { PillTabs, type PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { ApiErrorService } from '../../../services/api-error.service';
import type {
  PlatformCostSchedule,
  PlatformVendor,
  PlatformVendorCategory,
} from '../../../types/admin-finance.types';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';
import { AdminFinanceService } from '../finance/admin-finance.service';
import { addMonths, brl, costErrorMessage, isStale, monthName, vendorOptionLabel } from './costs-copy';
import { FIELD, NEW_VENDOR, VendorFields, VendorForm } from './vendor-fields';

export const MAX_SERVICE = 120;
/** Teto do servidor: R$ 100 milhões em centavos. */
export const MAX_AMOUNT_CENTS = 10_000_000_000;
/** Quantos meses para trás um custo fixo pode começar (o servidor lança esses meses na hora). */
export const BACKFILL_MONTHS = 60;

type EndChoice = 'none' | 'month';

const END_OPTIONS: readonly PillTabOption<EndChoice>[] = [
  { value: 'none', label: 'Sem fim' },
  { value: 'month', label: 'Em um mês' },
];

/** Dia de cobrança digitado: 1..31, ou `invalid`. */
export function parseBillingDay(raw: string): number | 'invalid' {
  const t = raw.trim();
  if (!/^\d{1,2}$/.test(t)) return 'invalid';
  const n = Number(t);
  return n >= 1 && n <= 31 ? n : 'invalid';
}

/**
 * "Novo custo fixo" (cadastre uma vez, ele lança sozinho no dia 1 de cada mês até o fim) e
 * "Editar custo fixo" (serviço e dia de cobrança da cadeia inteira; o valor muda por "Mudar valor
 * daqui para frente"). Dinheiro é TEXTO mascarado: só vira centavos no envio.
 */
@Component({
  selector: 'app-fixed-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, BottomSheet, PillTabs, VendorFields],
  templateUrl: './fixed-cost-sheet.html',
})
export class FixedCostSheet implements OnInit {
  private readonly service = inject(AdminFinanceService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly sheet = viewChild.required(BottomSheet);

  readonly vendors = input<readonly PlatformVendor[]>([]);
  /** Nulo = novo custo fixo; com valor = editar serviço e dia. */
  readonly schedule = input<PlatformCostSchedule | null>(null);
  readonly currentMonth = input.required<string>();
  /** Total do mês corrente, para a frase "custos do mês passam de A para B" (nulo = sem custos). */
  readonly currentTotalCents = input<number | null>(null);
  /** Fornecedor já escolhido (atalho "Aquisição" do Painel). */
  readonly presetCategory = input<PlatformVendorCategory | null>(null);
  readonly saved = output<PlatformCostSchedule>();
  /** Um fornecedor novo foi cadastrado no caminho: a página recarrega a lista. */
  readonly vendorCreated = output<PlatformVendor>();
  readonly closed = output<void>();
  /** O servidor disse que a tela ficou velha: a página recarrega. */
  readonly stale = output<void>();

  protected readonly field = FIELD;
  protected readonly newVendor = NEW_VENDOR;
  protected readonly maxService = MAX_SERVICE;
  protected readonly endOptions = END_OPTIONS;
  protected readonly optionLabel = vendorOptionLabel;

  protected readonly vendorForm = new VendorForm();
  protected readonly vendorControl = new FormControl('', { nonNullable: true });
  protected readonly serviceControl = new FormControl('', { nonNullable: true });
  protected readonly amountControl = new FormControl('', {
    nonNullable: true,
    validators: [ptBrMoneyValidator()],
  });
  protected readonly dayControl = new FormControl('', { nonNullable: true });
  protected readonly startControl = new FormControl('', { nonNullable: true });
  protected readonly endControl = new FormControl('', { nonNullable: true });

  protected readonly endChoice = signal<EndChoice>('none');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal(false);
  /** Fornecedor cadastrado numa tentativa que falhou depois: a próxima usa ele. */
  private readonly createdVendor = signal<PlatformVendor | null>(null);

  private readonly vendorValue = signal('');
  private readonly amountText = signal('');
  private readonly dayText = signal('');
  private readonly startValue = signal('');
  private readonly endValue = signal('');

  protected readonly editing = computed(() => this.schedule() !== null);
  protected readonly creatingVendor = computed(() => !this.editing() && this.vendorValue() === NEW_VENDOR);
  protected readonly activeVendors = computed(() => this.vendors().filter((v) => v.active));
  protected readonly title = computed(() => (this.editing() ? 'Editar custo fixo' : 'Novo custo fixo'));
  protected readonly subtitle = computed(() => {
    const s = this.schedule();
    return s
      ? `${s.vendorName} · o valor muda em "Mudar valor daqui para frente".`
      : 'Cadastre uma vez. Ele lança sozinho no dia 1 de cada mês até a data de fim.';
  });
  protected readonly minStart = computed(() => addMonths(this.currentMonth(), -BACKFILL_MONTHS));

  /** A frase de resumo, atualizada enquanto se digita. */
  protected readonly summary = computed(() => {
    if (this.editing()) return null;
    const cents = ptBrMoneyCents(this.amountText());
    const day = parseBillingDay(this.dayText());
    const start = this.startValue();
    if (cents === null || day === 'invalid' || !/^\d{4}-\d{2}$/.test(start)) return null;
    const end = this.endChoice() === 'month' && /^\d{4}-\d{2}$/.test(this.endValue()) ? this.endValue() : null;
    const current = this.currentMonth();
    const range = end ? `de ${monthName(start)} até ${monthName(end)}` : `de ${monthName(start)} em diante`;
    let text = `Vai lançar ${brl(cents)} no dia 1 de cada mês, ${range}; o dia ${day} só define o vencimento.`;
    const coversCurrent = start <= current && (!end || end >= current);
    if (start < current) text += ` Os meses desde ${monthName(start)} são lançados agora.`;
    if (coversCurrent) {
      const before = this.currentTotalCents();
      const after = (before ?? 0) + cents;
      text +=
        before === null
          ? ` ${monthName(current)} já entra com ${brl(after)}.`
          : ` ${monthName(current)} já entra: custos do mês passam de ${brl(before)} para ${brl(after)}.`;
    }
    return text;
  });

  ngOnInit(): void {
    this.vendorControl.valueChanges.subscribe((v) => this.vendorValue.set(v));
    this.amountControl.valueChanges.subscribe((v) => this.amountText.set(v));
    this.dayControl.valueChanges.subscribe((v) => this.dayText.set(v));
    this.startControl.valueChanges.subscribe((v) => this.startValue.set(v));
    this.endControl.valueChanges.subscribe((v) => this.endValue.set(v));

    const s = this.schedule();
    if (s) {
      this.serviceControl.setValue(s.service);
      this.dayControl.setValue(String(s.billingDay));
      return;
    }
    this.startControl.setValue(this.currentMonth());
    const preset = this.presetCategory();
    const list = this.activeVendors();
    const match = preset ? list.find((v) => v.category === preset) : list[0];
    this.vendorControl.setValue(match?.id ?? NEW_VENDOR);
    if (!match && preset) this.vendorForm.fill(null, preset);
  }

  protected onAmountInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.amountControl);
  }

  protected cancel(): void {
    this.sheet().requestClose();
  }

  protected setEnd(choice: EndChoice): void {
    this.endChoice.set(choice);
    if (choice === 'month' && !this.endControl.value) this.endControl.setValue(this.startControl.value);
  }

  protected amountError(): string | null {
    if (!this.submitted() || !this.amountControl.errors) return null;
    return this.amountControl.errors['moneyFormat'] ? 'Valor inválido. Use o formato 1.234,56.' : 'Informe o valor.';
  }

  private validate(): string | null {
    if (this.creatingVendor()) {
      const vendorError = this.vendorForm.validate();
      if (vendorError) return vendorError;
    } else if (!this.editing() && !this.vendorControl.value) {
      return 'Escolha o fornecedor.';
    }
    const service = this.serviceControl.value.trim();
    if (!service || service.length > MAX_SERVICE) return `Informe o serviço (até ${MAX_SERVICE} caracteres).`;
    if (parseBillingDay(this.dayControl.value) === 'invalid') return 'O dia de cobrança vai de 1 a 31.';
    if (this.editing()) return null;
    if (this.amountControl.invalid) return 'Confira o valor.';
    const cents = ptBrMoneyCents(this.amountControl.value) ?? 0;
    if (cents > MAX_AMOUNT_CENTS) return 'O valor passa do limite.';
    const start = this.startControl.value;
    if (!/^\d{4}-\d{2}$/.test(start)) return 'Escolha o mês de começo.';
    if (start < this.minStart()) return `O custo fixo pode começar no máximo em ${monthName(this.minStart())}.`;
    if (this.endChoice() === 'month') {
      const end = this.endControl.value;
      if (!/^\d{4}-\d{2}$/.test(end)) return 'Escolha o último mês.';
      if (end < start) return 'O último mês vem depois do começo.';
    }
    return null;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    const invalid = this.validate();
    if (invalid) {
      this.error.set(invalid);
      return;
    }
    const day = parseBillingDay(this.dayControl.value) as number;
    const service = this.serviceControl.value.trim();
    const s = this.schedule();
    const request$: Observable<PlatformCostSchedule> = s
      ? this.service.updateSchedule(s.id, { service, billingDay: day })
      : this.resolveVendor().pipe(
          concatMap((vendorId) =>
            this.service.createSchedule({
              vendorId,
              service,
              amountCents: ptBrMoneyCents(this.amountControl.value) ?? 0,
              billingDay: day,
              startMonth: this.startControl.value,
              endMonth: this.endChoice() === 'month' ? this.endControl.value : null,
            }),
          ),
        );
    this.saving.set(true);
    request$.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
        this.sheet().requestClose(true);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.apiErrors.claim(err);
        this.error.set(costErrorMessage(err));
        if (isStale(err)) this.stale.emit();
      },
    });
  }

  private resolveVendor(): Observable<string> {
    if (!this.creatingVendor()) return of(this.vendorControl.value);
    const created = this.createdVendor();
    if (created) return of(created.id);
    return this.service.createVendor(this.vendorForm.request(true)).pipe(
      tap((vendor) => {
        this.createdVendor.set(vendor);
        this.vendorCreated.emit(vendor);
      }),
      concatMap((vendor) => of(vendor.id)),
    );
  }
}
