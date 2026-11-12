import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Subject, catchError, of, switchMap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../components/core/bottom-sheet/bottom-sheet';
import { PageCard } from '../../components/core/page-card/page-card';
import {
  DRIVER_PICKER_PAGE_SIZE,
  DriverPicker,
  DriverPickerItem,
} from '../../components/drivers/driver-picker/driver-picker';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PersonNamePipe } from '../../pipes/person-name.pipe';
import { formatPersonName } from '../../utils/display-format';
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
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FormField,
    FieldControl,
    BottomSheet,
    DriverPicker,
    PersonNamePipe,
  ],
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
  protected readonly driversError = signal<string | null>(null);
  /** Total no servidor; acima de {@link DRIVER_PICKER_PAGE_SIZE} o seletor avisa o corte. */
  protected readonly driversTotal = signal(0);
  protected readonly driversEmpty = computed(
    () => this.driversLoaded() && !this.driversError() && this.drivers().length === 0,
  );

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

  /** Folha do seletor de motorista (no lugar do `<select>` nativo). */
  protected readonly driverPickerOpen = signal(false);
  private readonly driverSheet = viewChild(BottomSheet);
  private readonly driverId = toSignal(this.form.controls.driverId.valueChanges, {
    initialValue: this.form.controls.driverId.value,
  });
  /** O que a folha lista: a primeira página ou o resultado da busca no servidor. */
  protected readonly pickerDrivers = signal<readonly DriverPickerItem[]>([]);
  /** Escolhido via busca no servidor pode não estar na primeira página. */
  private readonly pickedDriver = signal<DriverPickerItem | null>(null);
  private readonly driverSearch$ = new Subject<string>();
  protected readonly selectedDriver = computed(() => {
    const id = this.driverId();
    if (!id) return null;
    const picked = this.pickedDriver();
    return this.drivers().find((d) => d.id === id) ?? (picked?.id === id ? picked : null);
  });
  /** A `<label>` sozinha daria só "Motorista": o nome acessível leva o valor atual. */
  protected readonly driverAriaLabel = computed(() => {
    const d = this.selectedDriver();
    if (d) return `Motorista: ${formatPersonName(d.name)}`;
    return this.driversLoaded() ? 'Motorista: escolha o motorista' : 'Motorista: carregando';
  });

  constructor() {
    this.driverSearch$
      .pipe(
        switchMap((name) =>
          name
            ? this.driverService
                .list({ name, size: DRIVER_PICKER_PAGE_SIZE, sort: 'name_asc' })
                .pipe(catchError(() => of(null)))
            : of({ content: this.drivers() }),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        if (res) this.pickerDrivers.set(res.content ?? []);
      });
  }

  ngOnInit(): void {
    this.loadDrivers();
  }

  /** Só chamada com a lista cortada em {@link DRIVER_PICKER_PAGE_SIZE}. */
  protected onDriverSearch(name: string): void {
    this.driverSearch$.next(name);
  }

  /**
   * Falha NÃO vira lista vazia: "nenhum motorista cadastrado" seria uma afirmação falsa sobre
   * os dados. Erro mostra a mensagem e "Tentar novamente"; vazio leva ao cadastro.
   */
  protected loadDrivers(): void {
    this.driversLoaded.set(false);
    this.driversError.set(null);
    this.driverService.list({ size: DRIVER_PICKER_PAGE_SIZE, sort: 'name_asc' }).subscribe({
      next: (res) => {
        const content = res.content ?? [];
        this.drivers.set(content);
        this.pickerDrivers.set(content);
        this.driversTotal.set(Math.max(res.total ?? 0, content.length));
        this.driversLoaded.set(true);
      },
      error: (err: unknown) => {
        this.drivers.set([]);
        this.driversTotal.set(0);
        this.driversError.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os motoristas.'));
        this.driversLoaded.set(true);
      },
    });
  }

  protected openDriverPicker(): void {
    this.pickerDrivers.set(this.drivers());
    this.driverPickerOpen.set(true);
  }

  protected pickDriver(driver: DriverPickerItem): void {
    const control = this.form.controls.driverId;
    this.pickedDriver.set(driver);
    control.setValue(driver.id);
    control.markAsDirty();
    this.driverSheet()?.requestClose();
  }

  /** Passar pelo campo com Tab marca como tocado, como o blur do `<select>`. */
  protected onDriverTriggerBlur(): void {
    if (!this.driverPickerOpen()) this.form.controls.driverId.markAsTouched();
  }

  /** Fechar sem escolher conta como ter passado pelo campo (o `<select>` marcava no blur). */
  protected onDriverPickerClosed(): void {
    this.form.controls.driverId.markAsTouched();
    this.driverPickerOpen.set(false);
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
