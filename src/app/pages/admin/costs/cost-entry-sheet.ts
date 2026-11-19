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
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ApiErrorService } from '../../../services/api-error.service';
import type {
  PlatformCost,
  PlatformVendor,
  PlatformVendorCategory,
} from '../../../types/admin-finance.types';
import { formatPtBrMoney } from '../../../utils/ptbr-number';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';
import { AdminFinanceService } from '../finance/admin-finance.service';
import {
  KIND_LABEL,
  brl,
  costErrorMessage,
  isStale,
  lastDayOf,
  monthName,
  monthOnly,
  vendorOptionLabel,
} from './costs-copy';
import { MAX_AMOUNT_CENTS, MAX_SERVICE } from './fixed-cost-sheet';
import { SheetMenu } from './sheet-menu';
import { FIELD, NEW_VENDOR, VendorFields, VendorForm } from './vendor-fields';

export const MAX_NOTE = 500;

/**
 * "Lançar custo avulso" (um valor só no mês escolhido) e "Editar lançamento" (muda SÓ este mês:
 * numa linha de custo fixo ela ganha a marca "editado" e o fixo nunca mais a reescreve).
 *
 * Voltar ao fixo, mudar o custo fixo daqui para frente e tirar do mês ficam no ⋮ da folha.
 */
@Component({
  selector: 'app-cost-entry-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, BottomSheet, StatusChip, DataListMenuItem, SheetMenu, VendorFields],
  templateUrl: './cost-entry-sheet.html',
})
export class CostEntrySheet implements OnInit {
  private readonly service = inject(AdminFinanceService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly sheet = viewChild.required(BottomSheet);

  readonly vendors = input<readonly PlatformVendor[]>([]);
  /** Nulo = lançar avulso; com valor = editar este lançamento. */
  readonly cost = input<PlatformCost | null>(null);
  /** Mês em que o avulso cai (o da lista na tela). */
  readonly month = input.required<string>();
  /** O custo fixo desta linha ainda aceita "mudar daqui para frente". */
  readonly canChangeFixed = input(false);
  /** Atalho "Aquisição" do Painel: abre no fornecedor de aquisição (ou no cadastro dele). */
  readonly presetCategory = input<PlatformVendorCategory | null>(null);
  readonly saved = output<PlatformCost>();
  readonly vendorCreated = output<PlatformVendor>();
  readonly remove = output<PlatformCost>();
  readonly changeFixed = output<PlatformCost>();
  readonly stale = output<void>();
  readonly closed = output<void>();

  protected readonly field = FIELD;
  protected readonly newVendor = NEW_VENDOR;
  protected readonly maxNote = MAX_NOTE;
  protected readonly maxDescription = MAX_SERVICE;
  protected readonly optionLabel = vendorOptionLabel;
  protected readonly kindLabel = KIND_LABEL;

  protected readonly vendorForm = new VendorForm();
  protected readonly vendorControl = new FormControl('', { nonNullable: true });
  protected readonly monthControl = new FormControl('', { nonNullable: true });
  protected readonly descriptionControl = new FormControl('', { nonNullable: true });
  protected readonly amountControl = new FormControl('', { nonNullable: true, validators: [ptBrMoneyValidator()] });
  protected readonly dueControl = new FormControl('', { nonNullable: true });
  protected readonly noteControl = new FormControl('', { nonNullable: true });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal(false);
  private readonly createdVendor = signal<PlatformVendor | null>(null);
  private readonly vendorValue = signal('');
  private readonly monthValue = signal('');

  protected readonly editing = computed(() => this.cost() !== null);
  protected readonly fixed = computed(() => this.cost()?.kind === 'FIXED');
  protected readonly creatingVendor = computed(() => !this.editing() && this.vendorValue() === NEW_VENDOR);
  protected readonly activeVendors = computed(() => this.vendors().filter((v) => v.active));
  /** O mês da linha (editar) ou o escolhido no campo (lançar). */
  protected readonly entryMonth = computed(() => this.cost()?.month ?? (this.monthValue() || this.month()));
  protected readonly monthWord = computed(() => monthOnly(this.entryMonth()));
  protected readonly dueMin = computed(() => `${this.entryMonth()}-01`);
  protected readonly dueMax = computed(() => lastDayOf(this.entryMonth()));

  protected readonly title = computed(() => (this.editing() ? 'Editar lançamento' : 'Lançar custo avulso'));
  protected readonly subtitle = computed(() => {
    const c = this.cost();
    if (!c) return 'Um valor só no mês escolhido. Entra no total do mês e no Lucro do Painel.';
    // A linha lançada à mão antes dos custos fixos (LEGACY) não tem descrição: nunca "null" na tela.
    const what = c.description?.trim() || (c.kind === 'LEGACY' ? 'lançado à mão' : null);
    return [c.vendorName, what, monthName(c.month)].filter(Boolean).join(' · ');
  });
  /** "Muda só este mês": o que acontece com os outros meses. */
  protected readonly onlyThisMonth = computed(() => {
    const c = this.cost();
    if (!c || c.kind !== 'FIXED') return null;
    const fixedAmount = c.scheduleAmountCents ?? c.amountCents;
    const what = c.description?.trim() ? ` (${c.description.trim()})` : '';
    return `O custo fixo de ${c.vendorName}${what} continua ${brl(fixedAmount)} nos outros meses.`;
  });
  protected readonly revertText = computed(() => {
    const c = this.cost();
    return c?.scheduleAmountCents != null ? `${this.monthWord()} volta a ${brl(c.scheduleAmountCents)}` : null;
  });

  ngOnInit(): void {
    this.vendorControl.valueChanges.subscribe((v) => this.vendorValue.set(v));
    this.monthControl.valueChanges.subscribe((v) => this.monthValue.set(v));
    const c = this.cost();
    if (c) {
      this.amountControl.setValue(formatPtBrMoney(c.amountCents));
      this.dueControl.setValue(c.dueDate ?? '');
      this.noteControl.setValue(c.note ?? '');
      this.descriptionControl.setValue(c.description ?? '');
      return;
    }
    this.monthControl.setValue(this.month());
    const preset = this.presetCategory();
    const list = this.activeVendors();
    const match = preset ? list.find((v) => v.category === preset) : list[0];
    this.vendorControl.setValue(match?.id ?? NEW_VENDOR);
    if (!match && preset) this.vendorForm.fill(null, preset, preset === 'ACQUISITION' ? 'Aquisição' : '');
  }

  protected onAmountInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.amountControl);
  }

  protected cancel(): void {
    this.sheet().requestClose();
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
    if (!this.editing() && !/^\d{4}-\d{2}$/.test(this.monthControl.value)) return 'Escolha o mês.';
    if (!this.fixed()) {
      const d = this.descriptionControl.value.trim();
      if (!d || d.length > MAX_SERVICE) return `Diga o que foi pago (até ${MAX_SERVICE} caracteres).`;
    }
    if (this.amountControl.invalid) return 'Confira o valor.';
    if ((ptBrMoneyCents(this.amountControl.value) ?? 0) > MAX_AMOUNT_CENTS) return 'O valor passa do limite.';
    const due = this.dueControl.value;
    if (due && (due < this.dueMin() || due > this.dueMax())) {
      return `O vencimento fica dentro de ${monthName(this.entryMonth())}.`;
    }
    if (this.noteControl.value.length > MAX_NOTE) return `A nota passa de ${MAX_NOTE} caracteres.`;
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
    const amountCents = ptBrMoneyCents(this.amountControl.value) ?? 0;
    const dueDate = this.dueControl.value || null;
    const note = this.noteControl.value.trim() || null;
    const description = this.descriptionControl.value.trim();
    const c = this.cost();
    const request$: Observable<PlatformCost> = c
      ? this.service.updateCost(c.id, {
          amountCents,
          dueDate,
          note,
          ...(c.kind === 'FIXED' ? {} : { description }),
        })
      : this.resolveVendor().pipe(
          concatMap((vendorId) =>
            this.service.createCost({ vendorId, month: this.monthControl.value, description, amountCents, dueDate, note }),
          ),
        );
    this.run(request$);
  }

  /** "Voltar ao valor do fixo": o mês volta a seguir o custo fixo. */
  protected revert(): void {
    const c = this.cost();
    if (!c) return;
    this.error.set(null);
    this.run(this.service.revertCost(c.id));
  }

  protected askRemove(): void {
    const c = this.cost();
    if (c) this.remove.emit(c);
  }

  protected askChangeFixed(): void {
    const c = this.cost();
    if (c) this.changeFixed.emit(c);
  }

  private run(request$: Observable<PlatformCost>): void {
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
