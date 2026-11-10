import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { clearServerErrors } from '../../services/api-error';
import { ApiErrorService } from '../../services/api-error.service';
import { ExpensesService } from '../../services/expenses.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import { formatBRL } from '../../types/dashboard.types';
import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_DESCRIPTION_MAX,
  ExpenseCategoryKey,
  ExpenseRequest,
} from '../../types/expense.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { todayInBusinessTz } from '../../utils/business-clock';
import { formatPlate, formatVehicleLabel } from '../../utils/display-format';
import { expenseAmountValidator, monthName, monthOf, notBlankValidator } from '../../utils/expenses-view';
import { applyPtBrMoneyMaskToControl } from '../../utils/ptbr-money-mask';
import { formatPtBrMoney } from '../../utils/ptbr-number';
import { ptBrMoneyCents } from '../../utils/validators/ptbr-money.validator';

/**
 * Lançar / editar gasto (FEAT-0425). Valor é TEXTO pt-BR mascarado no controle e centavos
 * inteiros no corpo; a descrição é obrigatória em toda categoria.
 */
@Component({
  selector: 'app-expense-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './expense-form.html',
})
export class ExpenseForm implements OnInit {
  private readonly expensesService = inject(ExpensesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly categoryOptions = EXPENSE_CATEGORY_OPTIONS;
  protected readonly descriptionMax = EXPENSE_DESCRIPTION_MAX;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly vehicles = signal<VehicleListItem[]>([]);

  protected readonly categoryMessages = { required: 'Escolha a categoria.' };
  protected readonly amountMessages = {
    required: 'Informe um valor maior que zero.',
    min: 'Informe um valor maior que zero.',
    max: 'O valor máximo de um gasto é R$ 100.000.000,00.',
    moneyFormat: 'Informe um valor válido (ex.: 1.200,00).',
  };
  protected readonly dateMessages = { required: 'Informe a data do gasto.' };
  protected readonly descriptionMessages = {
    required: 'Descreva o gasto. Em Outros, diga o que foi.',
    maxlength: `A descrição pode ter até ${EXPENSE_DESCRIPTION_MAX} caracteres.`,
  };

  protected readonly form = this.fb.nonNullable.group({
    category: ['FUEL' as ExpenseCategoryKey, [Validators.required]],
    // TEXTO pt-BR no controle (máscara de milhar), centavos no corpo.
    amountReais: ['', [expenseAmountValidator()]],
    expenseDate: [todayInBusinessTz(), [Validators.required]],
    vehicleId: [''],
    description: ['', [notBlankValidator(), Validators.maxLength(EXPENSE_DESCRIPTION_MAX)]],
  });

  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  protected readonly isOther = computed(() => this.values().category === 'OTHER');
  /** Centavos do que está digitado; `null` enquanto o texto não for dinheiro válido. */
  protected readonly typedCents = computed(() => {
    const cents = ptBrMoneyCents(this.values().amountReais);
    return cents !== null && cents > 0 ? cents : null;
  });
  protected readonly effectMonth = computed(() => {
    const d = this.values().expenseDate;
    return d ? monthName(monthOf(d)) : null;
  });
  protected readonly effectAmount = computed(() => {
    const c = this.typedCents();
    return c === null ? null : formatBRL(c);
  });

  ngOnInit(): void {
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.load(id);
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.expensesService.getOne(id).subscribe({
      next: (e) => {
        this.form.patchValue({
          category: e.category as ExpenseCategoryKey,
          amountReais: formatPtBrMoney(e.amountCents),
          expenseDate: e.expenseDate,
          vehicleId: e.vehicleId ?? '',
          description: e.description,
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Gasto não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected vehicleOption(v: VehicleListItem): string {
    return `${formatPlate(v.plate)} · ${formatVehicleLabel(v.brand, v.model)}`;
  }

  /** O controle guarda TEXTO; a máscara reescreve o campo a cada tecla. */
  protected onMoneyInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.form.controls.amountReais);
  }

  /** Corpo enviado à API. Público para o spec conferir centavos, data e veículo nulo. */
  protected buildPayload(): ExpenseRequest {
    const raw = this.form.getRawValue();
    return {
      vehicleId: raw.vehicleId || null,
      category: raw.category,
      description: raw.description.trim(),
      expenseDate: raw.expenseDate,
      amountCents: ptBrMoneyCents(raw.amountReais) ?? 0,
    };
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);
    const payload = this.buildPayload();
    const id = this.editingId();
    const call = id
      ? this.expensesService.update(id, payload)
      : this.expensesService.create(payload);
    call.subscribe({
      next: (e) => {
        this.notifications.success('Gasto salvo.');
        this.router.navigate(['/gastos', e.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível salvar o gasto.',
        );
        this.error.set(formMessage);
      },
    });
  }

  protected cancel(): void {
    const id = this.editingId();
    this.router.navigate(id ? ['/gastos', id] : ['/gastos']);
  }
}
