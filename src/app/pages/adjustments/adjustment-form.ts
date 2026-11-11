import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { PageCard } from '../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { AdjustmentsService } from '../../services/adjustments.service';
import { clearServerErrors } from '../../services/api-error';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import {
  ADJUSTMENT_DESCRIPTION_MAX,
  ADJUSTMENT_MAX_DUE_DAYS_AHEAD,
  AdjustmentCreateRequest,
} from '../../types/adjustment.types';
import { DriverListItem } from '../../types/driver.types';
import {
  IdempotencyKeyKeeper,
  adjustmentAmountValidator,
  brDate,
  dueWindowValidator,
  lastAdjustmentDueDate,
} from '../../utils/adjustments-view';
import { todayInBusinessTz } from '../../utils/business-clock';
import { notBlankValidator } from '../../utils/expenses-view';
import { applyPtBrMoneyMaskToControl } from '../../utils/ptbr-money-mask';
import { ptBrMoneyCents } from '../../utils/validators/ptbr-money.validator';

/**
 * Novo ajuste (FormAjuste): motorista, valor, vencimento e motivo. Sem aluguel e sem forma de
 * pagamento: o servidor escolhe o aluguel do motorista e a cobrança é sempre Pix. Não há
 * edição: um ajuste emitido só existe no estado que o Asaas devolve.
 *
 * Cada ENVIO leva uma `Idempotency-Key`; tentar de novo o mesmo corpo reaproveita a chave (o
 * back-end devolve o ajuste já criado, sem segundo Pix).
 */
@Component({
  selector: 'app-adjustment-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DefaultPageLayout, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './adjustment-form.html',
})
export class AdjustmentForm implements OnInit {
  private readonly adjustmentsService = inject(AdjustmentsService);
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  /** Público para o spec trocar o gerador de chave por um determinístico. */
  readonly keys = new IdempotencyKeyKeeper();

  protected readonly descriptionMax = ADJUSTMENT_DESCRIPTION_MAX;
  protected readonly minDate = todayInBusinessTz();
  protected readonly maxDate = lastAdjustmentDueDate(this.minDate);
  protected readonly dueHint = `De hoje até ${brDate(this.maxDate)}.`;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly drivers = signal<DriverListItem[]>([]);
  protected readonly driversLoaded = signal(false);

  protected readonly driverMessages = { required: 'Escolha o motorista.' };
  protected readonly amountMessages = {
    required: 'Informe um valor maior que zero.',
    min: 'Informe um valor maior que zero.',
    max: 'O valor máximo de um ajuste é R$ 100.000,00.',
    moneyFormat: 'Informe um valor válido (ex.: 180,00).',
  };
  protected readonly dueMessages = {
    required: 'Informe o vencimento.',
    dateFormat: 'Informe uma data válida.',
    minDate: 'O vencimento não pode ser antes de hoje.',
    maxDate: `O vencimento pode ir até ${ADJUSTMENT_MAX_DUE_DAYS_AHEAD} dias a partir de hoje (${brDate(this.maxDate)}).`,
  };
  protected readonly descriptionMessages = {
    required: 'Informe o motivo do ajuste.',
    maxlength: `O motivo pode ter até ${ADJUSTMENT_DESCRIPTION_MAX} caracteres.`,
  };

  protected readonly form = this.fb.nonNullable.group({
    driverId: ['', [Validators.required]],
    // TEXTO pt-BR no controle (máscara de milhar), centavos no corpo.
    amountReais: ['', [adjustmentAmountValidator()]],
    dueDate: ['', [dueWindowValidator(this.minDate, this.maxDate)]],
    description: ['', [notBlankValidator(), Validators.maxLength(ADJUSTMENT_DESCRIPTION_MAX)]],
  });

  ngOnInit(): void {
    this.driverService.list({ size: 500, sort: 'name_asc' }).subscribe({
      next: (res) => {
        this.drivers.set(res.content ?? []);
        this.driversLoaded.set(true);
      },
      error: () => {
        this.drivers.set([]);
        this.driversLoaded.set(true);
      },
    });
  }

  /** O controle guarda TEXTO; a máscara reescreve o campo a cada tecla. */
  protected onMoneyInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.form.controls.amountReais);
  }

  /** Corpo enviado à API. Público para o spec conferir os centavos. */
  buildPayload(): AdjustmentCreateRequest {
    const raw = this.form.getRawValue();
    return {
      driverId: raw.driverId,
      amountCents: ptBrMoneyCents(raw.amountReais) ?? 0,
      dueDate: raw.dueDate,
      description: raw.description.trim(),
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
    const key = this.keys.keyFor(JSON.stringify(payload));
    this.adjustmentsService.create(payload, key).subscribe({
      next: ({ adjustment, httpStatus }) => {
        this.keys.reset();
        this.notifications.success(
          httpStatus === 202 || adjustment.status === 'ISSUING'
            ? 'Ajuste criado. A emissão do Pix está em andamento e termina em alguns minutos.'
            : 'Ajuste criado e Pix emitido.',
        );
        this.router.navigate(['/ajustes', adjustment.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível criar o ajuste.',
        );
        this.error.set(formMessage);
      },
    });
  }
}
