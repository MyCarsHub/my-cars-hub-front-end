import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { InsuranceFormFields } from '../../components/vehicles/insurance-form-fields/insurance-form-fields';
import {
  insuranceDateRangeValidator,
  toCents,
  toReais,
} from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { InsurancesService } from '../../services/insurances.service';
import { InsuranceCoverage, UpdateInsuranceRequest } from '../../types/insurance.types';

/**
 * Edição de uma apólice existente (`PATCH /v1/vehicles/{vehicleId}/insurances/{id}`).
 * O cadastro acontece dentro do formulário de veículo — aqui só se edita.
 *
 * Apólice CANCELLED ou EXPIRED é recusada pelo backend; a tela bloqueia antes
 * do round-trip e explica o motivo inline.
 */
@Component({
  selector: 'app-insurance-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    InsuranceFormFields,
  ],
  templateUrl: './insurance-form.html',
})
export class InsuranceForm implements OnInit {
  private readonly insurancesService = inject(InsurancesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly insuranceId = signal<string | null>(null);
  private readonly vehicleId = signal<string | null>(null);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Apólice cancelada/expirada: somente leitura. */
  protected readonly readOnly = signal(false);

  protected readonly form = this.fb.nonNullable.group(
    {
      insurer: ['', [Validators.required, Validators.maxLength(120)]],
      policyNumber: ['', [Validators.required, Validators.maxLength(60)]],
      coverageType: ['' as InsuranceCoverage | '', [Validators.required]],
      premiumAmount: [0, [Validators.required, Validators.min(0.01)]],
      deductibleAmount: [null as number | null, [Validators.min(0)]],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      paymentMethod: [''],
      notes: [''],
    },
    { validators: [insuranceDateRangeValidator] },
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.insuranceId.set(id);
    this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.insurancesService.getOne(id).subscribe({
      next: (i) => {
        this.vehicleId.set(i.vehicleId);
        this.readOnly.set(i.status === 'CANCELLED' || i.status === 'EXPIRED');
        this.form.patchValue({
          insurer: i.insurer,
          policyNumber: i.policyNumber,
          coverageType: i.coverageType,
          premiumAmount: toReais(i.premiumAmount) ?? 0,
          deductibleAmount: toReais(i.deductibleAmount),
          startDate: i.startDate,
          endDate: i.endDate,
          paymentMethod: i.paymentMethod ?? '',
          notes: i.notes ?? '',
        });
        if (this.readOnly()) {
          this.form.disable();
          this.error.set('Apólices canceladas ou expiradas não podem ser editadas.');
        }
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Apólice não encontrada.'));
        this.loading.set(false);
      },
    });
  }

  protected submit(): void {
    if (this.saving() || this.readOnly()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    const id = this.insuranceId();
    const vehicleId = this.vehicleId();
    if (!id || !vehicleId) return;

    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);

    const raw = this.form.getRawValue();
    const payload: UpdateInsuranceRequest = {
      insurer: raw.insurer.trim(),
      policyNumber: raw.policyNumber.trim(),
      coverageType: raw.coverageType as InsuranceCoverage,
      premiumAmount: toCents(Number(raw.premiumAmount)) ?? 0,
      deductibleAmount: raw.deductibleAmount != null ? toCents(Number(raw.deductibleAmount)) : null,
      startDate: raw.startDate,
      endDate: raw.endDate,
      paymentMethod: raw.paymentMethod?.trim() || null,
      notes: raw.notes?.trim() || null,
    };

    this.insurancesService.update(vehicleId, id, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.notifications.success('Apólice atualizada.');
        this.router.navigate(['/seguros', id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível salvar a apólice.',
        );
        this.error.set(formMessage);
      },
    });
  }

  protected cancel(): void {
    const id = this.insuranceId();
    this.router.navigate(id ? ['/seguros', id] : ['/seguros']);
  }
}
