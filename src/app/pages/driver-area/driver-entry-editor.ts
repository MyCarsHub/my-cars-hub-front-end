import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { FilterChipGroup, FilterChipOption } from '../../components/filter-chip-group/filter-chip-group';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { DriverLedgerService } from '../../services/driver-ledger.service';
import { NotificationService } from '../../services/notification.service';
import {
  DriverActiveRental,
  LedgerCategory,
  LedgerEntry,
  LedgerEntryRequest,
  LedgerKind,
} from '../../types/driver-ledger.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { addDaysIso, categoriesOf, categoryLabel, minusYearsIso } from '../../utils/driver-ledger';
import { applyPtBrMoneyMaskToControl } from '../../utils/ptbr-money-mask';
import { formatPtBrMoney, parsePtBrMoneyCents } from '../../utils/ptbr-number';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../utils/validators/ptbr-money.validator';
import { MembersSheet } from '../company-settings/members/members-sheet';
import { formatBRL, formatDate } from '../../types/dashboard.types';

/** Server ceiling per entry (`DriverLedgerEntryRequestDto.MAX_AMOUNT_CENTS`): R$ 1.000.000,00. */
export const LEDGER_MAX_AMOUNT_CENTS = 100_000_000;

/** `max` of the amount: a guard-rail against a typo with too many zeros, not a commercial cap. */
export function maxAmountValidator(maxCents: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const { scaled } = parsePtBrMoneyCents(value.trim());
    return scaled !== null && scaled > maxCents ? { maxAmount: true } : null;
  };
}

/** The day cannot be in the future: the ledger records what already happened. */
export function notInTheFutureValidator(today: () => string) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    return value !== '' && value > today() ? { future: true } : null;
  };
}

/**
 * The server refuses a date older than one year (`MSG_DATE_TOO_OLD`): the field says so
 * before the round trip, and the `min` of the date input keeps the picker inside the range.
 */
export function notTooOldValidator(today: () => string) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    if (value === '') return null;
    const oldest = minusYearsIso(today(), 1);
    return oldest !== null && value < oldest ? { tooOld: true } : null;
  };
}

/**
 * The entry form of the driver's ledger — a bottom sheet on phones, a centred card above
 * `sm` (the shell is the Members page's `MembersSheet`) — plus the delete confirmation.
 *
 * ## How a page drives it
 *
 * The page keeps ONE instance and calls `openCreate(kind)` / `openEdit(entry)` /
 * `askDelete(entry)`. The editor does the I/O and reports the outcome:
 * `saved` carries the entry the server returned (so the page can patch its list in place
 * and refetch behind it) and `removed` carries the id. The kind is fixed by the button that
 * opened the sheet and cannot be changed in an edit — the category list depends on it.
 *
 * ## Money
 *
 * The amount field holds TEXT in pt-BR ("1.234,50"), masked while typing by the project's
 * money mask and read back ONLY through `ptBrMoneyCents` — the same grammar the validator
 * uses, so what the field shows is what it accepts. Nothing here calls `Number()` on it.
 */
@Component({
  selector: 'app-driver-entry-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBanner,
    ConfirmDialog,
    FieldControl,
    FilterChipGroup,
    FormField,
    MembersSheet,
  ],
  template: `
    <app-members-sheet [open]="open()" [title]="title()" [subtitle]="subtitle()" (closed)="close()">
      <form
        id="driver-entry-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="px-4 pb-4 space-y-5"
      >
        @if (error(); as message) {
          <app-alert-banner variant="error" [message]="message" />
        }

        <div>
          <p id="driver-entry-category-label" class="block text-sm font-medium text-neutral-700 mb-1.5">
            Categoria <span class="text-primary-700" aria-hidden="true">*</span>
          </p>
          <app-filter-chip-group
            [options]="categoryOptions()"
            [value]="category()"
            ariaLabelledby="driver-entry-category-label"
            (selectionChange)="chooseCategory($event)"
          />
          @if (categoryMissing()) {
            <p class="text-xs text-rose-600 mt-1" role="alert">Escolha uma categoria.</p>
          }
        </div>

        <app-form-field
          label="Valor (R$)"
          controlId="driver-entry-amount"
          [required]="true"
          [control]="form.controls.amount"
          [messages]="amountMessages"
        >
          <input
            appFieldControl
            formControlName="amount"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0,00"
            (input)="onMoneyInput($event)"
            [class]="amountClass"
          />
        </app-form-field>

        <app-form-field
          label="Data"
          controlId="driver-entry-date"
          [required]="true"
          [control]="form.controls.occurredOn"
          [messages]="dateMessages"
        >
          <input
            appFieldControl
            formControlName="occurredOn"
            type="date"
            [attr.min]="oldest()"
            [attr.max]="today()"
            [class]="inputClass"
          />
          <div class="mt-2 flex gap-2">
            <button type="button" (click)="setDay(0)" [class]="quickDayClass">Hoje</button>
            <button type="button" (click)="setDay(-1)" [class]="quickDayClass">Ontem</button>
          </div>
        </app-form-field>

        <app-form-field
          label="Observação (opcional)"
          controlId="driver-entry-description"
          [control]="form.controls.description"
          [messages]="descriptionMessages"
        >
          <input
            appFieldControl
            formControlName="description"
            type="text"
            maxlength="200"
            autocomplete="off"
            placeholder="Ex.: posto da avenida, corrida do aeroporto"
            [class]="inputClass"
          />
        </app-form-field>

        @if (canLinkRental()) {
          <label
            class="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 min-h-12 cursor-pointer"
          >
            <input
              type="checkbox"
              formControlName="linkRental"
              class="mt-0.5 h-5 w-5 shrink-0 accent-primary-700
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
            />
            <span class="flex-1 min-w-0 text-sm text-neutral-800">{{ rentalLabel() }}</span>
          </label>
        }
      </form>

      <div sheetFooter>
        <div
          class="border-t border-neutral-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col-reverse sm:flex-row gap-2"
        >
          <button
            type="button"
            (click)="close()"
            [disabled]="saving()"
            class="min-h-12 w-full sm:w-auto sm:px-6 rounded-xl text-base font-medium text-neutral-700
                   bg-neutral-100 hover:bg-neutral-200 disabled:opacity-60
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="driver-entry-form"
            [disabled]="saving()"
            [attr.aria-busy]="saving() ? 'true' : null"
            [class]="submitClass()"
          >
            {{ saving() ? 'Salvando…' : submitLabel() }}
          </button>
        </div>
      </div>
    </app-members-sheet>

    <app-confirm-dialog
      [open]="pendingDelete() !== null"
      title="Excluir este lançamento?"
      [message]="deleteMessage()"
      confirmLabel="Excluir"
      variant="danger"
      (confirmed)="confirmDelete()"
      (cancelled)="cancelDelete()"
    />
  `,
})
export class DriverEntryEditor {
  private readonly fb = inject(FormBuilder);
  private readonly ledger = inject(DriverLedgerService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  /** The rental the driver is in now, or `null`. Drives the "link to my rental" option. */
  readonly activeRental = input<DriverActiveRental | null>(null);

  /** The server's answer after a create or an update. */
  readonly saved = output<LedgerEntry>();
  /** The id of an entry the server deleted. */
  readonly removed = output<string>();

  protected readonly open = signal(false);
  private readonly kind = signal<LedgerKind>('INCOME');
  private readonly editing = signal<LedgerEntry | null>(null);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly category = signal<LedgerCategory | null>(null);
  protected readonly categoryMissing = signal(false);

  protected readonly pendingDelete = signal<LedgerEntry | null>(null);
  private readonly deleting = signal(false);

  protected readonly today = signal(todayInBusinessTz());
  /** Oldest day the server accepts: one year back from today. */
  protected readonly oldest = computed(() => minusYearsIso(this.today(), 1));

  protected readonly isEdit = computed(() => this.editing() !== null);

  protected readonly title = computed(() => {
    if (this.isEdit()) return this.kind() === 'INCOME' ? 'Editar ganho' : 'Editar custo';
    return this.kind() === 'INCOME' ? 'Registrar ganho' : 'Registrar custo';
  });
  protected readonly subtitle = computed(() =>
    this.kind() === 'INCOME'
      ? 'Quanto entrou, de onde veio e quando.'
      : 'Quanto saiu, com o quê e quando.',
  );
  protected readonly submitLabel = computed(() => {
    if (this.isEdit()) return 'Salvar alterações';
    return this.kind() === 'INCOME' ? 'Salvar ganho' : 'Salvar custo';
  });

  /** Income is green and expense is the brand orange, both at the 5.5:1 white-text floor. */
  protected readonly submitClass = computed(
    () =>
      'min-h-12 w-full sm:flex-1 rounded-xl text-base font-semibold text-white shadow-sm ' +
      'disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
      (this.kind() === 'INCOME'
        ? 'bg-success-800 hover:bg-success-900 focus-visible:ring-success-500'
        : 'bg-primary-700 hover:bg-primary-800 focus-visible:ring-primary-400'),
  );

  protected readonly categoryOptions = computed<readonly FilterChipOption<LedgerCategory | null>[]>(
    () => categoriesOf(this.kind()).map((c) => ({ value: c.value, label: c.label })),
  );

  protected readonly canLinkRental = computed(
    () => this.activeRental() !== null || this.editing()?.rentalId != null,
  );

  protected readonly rentalLabel = computed(() => {
    const active = this.activeRental();
    const linked = this.editing()?.rentalId ?? null;
    if (active && (linked === null || linked === active.rentalId)) {
      const plate = active.plate ? ` (${active.plate})` : '';
      return `Vincular ao meu aluguel ativo${plate}`;
    }
    return 'Vinculado a um aluguel';
  });

  protected readonly deleteMessage = computed(() => {
    const entry = this.pendingDelete();
    if (!entry) return '';
    const sign = entry.kind === 'INCOME' ? 'ganho' : 'custo';
    return `O ${sign} de ${formatBRL(entry.amountCents)} (${categoryLabel(entry.category)}, ${formatDate(entry.occurredOn)}) será removido do seu painel. Isso não pode ser desfeito.`;
  });

  protected readonly inputClass =
    'w-full min-h-12 bg-white border rounded-xl px-3 text-base text-neutral-800 ' +
    'placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-400 ' +
    'focus:border-primary-400 disabled:opacity-60 disabled:cursor-not-allowed';

  /** Bigger and tabular: the number is what the driver checks, often at a glance. */
  protected readonly amountClass =
    'w-full min-h-14 bg-white border rounded-xl px-3 text-2xl font-semibold tabular-nums ' +
    'text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 ' +
    'focus:ring-primary-400 focus:border-primary-400';

  protected readonly quickDayClass =
    'min-h-11 px-4 rounded-full border border-neutral-200 bg-white text-sm font-medium ' +
    'text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-primary-400 focus-visible:ring-offset-1';

  protected readonly amountMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor.',
    min: 'Informe um valor maior que zero.',
    moneyFormat: 'Informe um valor válido (ex.: 1.200,00).',
    maxAmount: 'O valor máximo por lançamento é R$ 1.000.000,00.',
  };
  protected readonly dateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data.',
    future: 'A data não pode ser no futuro.',
    tooOld: 'A data não pode ser anterior a um ano atrás.',
  };
  protected readonly descriptionMessages: Readonly<Record<string, string>> = {
    maxlength: 'Use no máximo 200 caracteres.',
  };

  protected readonly form = this.fb.nonNullable.group({
    amount: [
      '',
      [
        ptBrMoneyValidator({ minCents: 1 }),
        maxAmountValidator(LEDGER_MAX_AMOUNT_CENTS),
      ],
    ],
    occurredOn: [
      todayInBusinessTz(),
      [
        Validators.required,
        notInTheFutureValidator(() => todayInBusinessTz()),
        notTooOldValidator(() => todayInBusinessTz()),
      ],
    ],
    description: ['', [Validators.maxLength(200)]],
    linkRental: [false],
  });

  // ---- Public API (the page calls these) --------------------------------------------

  openCreate(kind: LedgerKind): void {
    this.kind.set(kind);
    this.editing.set(null);
    this.category.set(null);
    this.categoryMissing.set(false);
    this.error.set(null);
    this.today.set(todayInBusinessTz());
    this.form.reset({
      amount: '',
      occurredOn: todayInBusinessTz(),
      description: '',
      linkRental: this.activeRental() !== null,
    });
    this.open.set(true);
  }

  openEdit(entry: LedgerEntry): void {
    this.kind.set(entry.kind);
    this.editing.set(entry);
    this.category.set(entry.category);
    this.categoryMissing.set(false);
    this.error.set(null);
    this.today.set(todayInBusinessTz());
    this.form.reset({
      amount: formatPtBrMoney(entry.amountCents),
      occurredOn: entry.occurredOn,
      description: entry.description ?? '',
      linkRental: entry.rentalId !== null,
    });
    this.open.set(true);
  }

  askDelete(entry: LedgerEntry): void {
    this.pendingDelete.set(entry);
  }

  // ---- Template handlers -------------------------------------------------------------

  protected chooseCategory(value: LedgerCategory | null): void {
    this.category.set(value);
    this.categoryMissing.set(false);
  }

  protected onMoneyInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.form.controls.amount);
  }

  protected setDay(offset: number): void {
    const base = todayInBusinessTz();
    const day = offset === 0 ? base : addDaysIso(base, offset);
    if (day) {
      this.form.controls.occurredOn.setValue(day);
      this.form.controls.occurredOn.markAsDirty();
    }
  }

  protected close(): void {
    if (this.saving()) return;
    this.open.set(false);
  }

  protected submit(): void {
    if (this.saving()) return;
    const category = this.category();
    if (this.form.invalid || category === null) {
      this.form.markAllAsTouched();
      this.categoryMissing.set(category === null);
      return;
    }

    const raw = this.form.getRawValue();
    const amountCents = ptBrMoneyCents(raw.amount);
    if (amountCents === null) {
      this.form.controls.amount.markAsTouched();
      return;
    }

    const payload: LedgerEntryRequest = {
      kind: this.kind(),
      category,
      amountCents,
      occurredOn: raw.occurredOn,
      description: raw.description.trim() || null,
      rentalId: this.rentalIdToSend(raw.linkRental),
    };

    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);

    const editing = this.editing();
    const request = editing
      ? this.ledger.update(editing.id, payload)
      : this.ledger.create(payload);

    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.open.set(false);
        this.notifications.success(
          editing
            ? 'Lançamento atualizado.'
            : payload.kind === 'INCOME'
              ? 'Ganho registrado.'
              : 'Custo registrado.',
        );
        this.saved.emit(entry);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível salvar o lançamento. Tente novamente.',
        );
        this.error.set(formMessage);
      },
    });
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.pendingDelete.set(null);
  }

  protected confirmDelete(): void {
    const entry = this.pendingDelete();
    if (!entry || this.deleting()) return;
    this.deleting.set(true);
    this.ledger.remove(entry.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
        this.notifications.success('Lançamento excluído.');
        this.removed.emit(entry.id);
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.pendingDelete.set(null);
        this.notifications.error(
          this.apiErrors.messageFor(err, 'Não foi possível excluir o lançamento.'),
        );
      },
    });
  }

  /**
   * Which rental id the entry carries. Unchecked is `null` — an explicit "not tied to a
   * rental", which also lets a driver detach an old entry. Checked keeps the rental the
   * entry already had (an edit never silently re-points it) and falls back to the active one.
   */
  private rentalIdToSend(linked: boolean): string | null {
    if (!linked) return null;
    return this.editing()?.rentalId ?? this.activeRental()?.rentalId ?? null;
  }
}
