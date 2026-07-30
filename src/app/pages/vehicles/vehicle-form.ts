import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { EMPTY, Observable, catchError, map, of, switchMap } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { FinancingFormFields } from '../../components/vehicles/financing-form-fields/financing-form-fields';
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
import { InsuranceFormFields } from '../../components/vehicles/insurance-form-fields/insurance-form-fields';
import { insuranceDateRangeValidator } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { VehiclesService } from '../../services/vehicles.service';
import { InsurancesService } from '../../services/insurances.service';
import { CreateInsuranceRequest, InsuranceCoverage } from '../../types/insurance.types';
import {
  CreateFinancingRequest,
  CreateVehicleRequest,
  Financing,
  IPVA_STATUS_OPTIONS,
  IpvaStatus,
  UpdateVehicleRequest,
  VEHICLE_FUEL_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  Vehicle,
  VehicleFuel,
  VehicleType,
} from '../../types/vehicle.types';

const PLATE_PATTERN = /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/;

function yearRangeValidator(group: AbstractControl): ValidationErrors | null {
  const manufacture = group.get('yearManufacture')?.value;
  const model = group.get('yearModel')?.value;
  if (manufacture == null || model == null) return null;
  if (model < manufacture) return { yearModelRange: true };
  if (model > manufacture + 1) return { yearModelRange: true };
  return null;
}

@Component({
  selector: 'app-vehicle-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    PrimaryInput,
    FinancingFormFields,
    InsuranceFormFields,
    AlertBanner,
    FormField,
    FieldControl,
    RouterLink,
  ],
  templateUrl: './vehicle-form.html',
})
export class VehicleForm implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly insurancesService = inject(InsurancesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly typeOptions = VEHICLE_TYPE_OPTIONS;
  protected readonly ipvaStatusOptions = IPVA_STATUS_OPTIONS;
  protected readonly fuelOptions = VEHICLE_FUEL_OPTIONS;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly plateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a placa.',
    pattern: 'Placa inválida. Use ABC1234 ou ABC1D23.',
  };
  protected readonly chassisMessages: Readonly<Record<string, string>> = {
    pattern: 'Chassi deve ter 17 caracteres (sem I, O, Q).',
  };
  protected readonly renavamMessages: Readonly<Record<string, string>> = {
    pattern: 'RENAVAM deve ter entre 9 e 11 dígitos.',
  };

  protected readonly plateDisplay = signal('');
  protected readonly showFinancing = signal(false);
  /**
   * Bloco de seguro (opcional). O backend admite apenas UMA apólice ACTIVE por
   * veículo e responde 409 no POST quando já existe — o erro cai no banner
   * inline (`handleInsuranceError`), nunca em toast.
   */
  protected readonly showInsurance = signal(false);

  /**
   * Financiamento ATIVO já vinculado ao veículo (vem em `GET /vehicles/{id}`).
   * O backend só admite um ativo por veículo — `createFinancing` responde 409
   * quando já existe — e não expõe endpoint de atualização (apenas quitar e
   * excluir). Por isso a edição do veículo só oferece ADICIONAR quando este
   * signal está `null`; havendo um ativo, mostramos o resumo somente-leitura
   * com link para a tela do financiamento.
   */
  protected readonly existingFinancing = signal<Financing | null>(null);
  protected readonly canAddFinancing = computed(
    () => !this.isEdit() || this.existingFinancing() === null,
  );

  protected readonly form = this.fb.nonNullable.group(
    {
      plate: ['', [Validators.required, Validators.pattern(PLATE_PATTERN)]],
      type: ['CAR' as VehicleType, [Validators.required]],
      brand: ['', [Validators.required, Validators.maxLength(60)]],
      model: ['', [Validators.required, Validators.maxLength(80)]],
      yearManufacture: [
        new Date().getFullYear(),
        [Validators.required, Validators.min(1900), Validators.max(2100)],
      ],
      yearModel: [
        new Date().getFullYear(),
        [Validators.required, Validators.min(1900), Validators.max(2100)],
      ],
      chassis: ['', [Validators.pattern(/^[A-HJ-NPR-Z0-9]{17}$/)]],
      hodometer: [0, [Validators.required, Validators.min(0)]],
      licensingExpiration: [''],
      renavam: ['', [Validators.pattern(/^\d{9,11}$/)]],
      color: [''],
      purchaseDate: [''],
      ipvaAmount: [null as number | null, [Validators.min(0)]],
      ipvaDueDate: [''],
      ipvaStatus: ['' as IpvaStatus | ''],
      fuel: ['' as VehicleFuel | ''],
    },
    { validators: [yearRangeValidator] },
  );

  protected readonly financingForm = this.fb.nonNullable.group({
    contractDate: ['', [Validators.required]],
    purchasePrice: [0, [Validators.required, Validators.min(0.01)]],
    downPayment: [0, [Validators.min(0)]],
    installments: [0, [Validators.min(0)]],
    installmentAmount: [0, [Validators.min(0)]],
  });

  protected readonly insuranceForm = this.fb.nonNullable.group(
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
    if (id) {
      this.editingId.set(id);
      this.loadVehicle(id);
      this.form.controls.chassis.disable();
      this.form.controls.renavam.disable();
    }
  }

  protected onPlateInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 7);
    this.form.controls.plate.setValue(raw);
    this.form.controls.plate.markAsTouched();
    this.plateDisplay.set(raw);
  }

  protected onChassisInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 17);
    this.form.controls.chassis.setValue(raw);
    this.form.controls.chassis.markAsTouched();
  }

  protected onRenavamInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11);
    this.form.controls.renavam.setValue(raw);
    this.form.controls.renavam.markAsTouched();
  }

  private loadVehicle(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getOne(id).subscribe({
      next: (v) => {
        this.plateDisplay.set(v.plate ?? '');
        this.existingFinancing.set(v.activeFinancing ?? null);
        this.form.patchValue({
          plate: v.plate,
          type: v.type,
          brand: v.brand,
          model: v.model,
          yearManufacture: v.yearManufacture,
          yearModel: v.yearModel,
          chassis: v.chassis ?? '',
          hodometer: v.hodometer,
          licensingExpiration: v.licensingExpiration ?? '',
          renavam: v.renavam ?? '',
          color: v.color ?? '',
          purchaseDate: v.purchaseDate ?? '',
          ipvaAmount: v.ipvaAmount != null ? v.ipvaAmount / 100 : null,
          ipvaDueDate: v.ipvaDueDate ?? '',
          ipvaStatus: (v.ipvaStatus ?? '') as IpvaStatus | '',
          fuel: (v.fuel ?? '') as VehicleFuel | '',
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Veículo não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected toggleFinancing(): void {
    this.showFinancing.update((v) => !v);
  }

  protected toggleInsurance(): void {
    this.showInsurance.update((v) => !v);
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    // Vale tanto na criação quanto na edição: se o usuário abriu o bloco, ele é validado.
    if (this.willSubmitFinancing() && this.financingForm.invalid) {
      this.financingForm.markAllAsTouched();
      this.error.set('Verifique os campos do financiamento.');
      return;
    }
    if (this.willSubmitInsurance() && this.insuranceForm.invalid) {
      this.insuranceForm.markAllAsTouched();
      this.error.set('Verifique os campos do seguro.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);
    clearServerErrors(this.financingForm);
    clearServerErrors(this.insuranceForm);

    const raw = this.form.getRawValue();
    const ipvaAmountCents =
      raw.ipvaAmount != null && !Number.isNaN(Number(raw.ipvaAmount))
        ? toCents(Number(raw.ipvaAmount))
        : null;
    const commonPayload = {
      plate: raw.plate.trim().toUpperCase(),
      type: raw.type,
      brand: raw.brand.trim(),
      model: raw.model.trim(),
      yearManufacture: Number(raw.yearManufacture),
      yearModel: Number(raw.yearModel),
      hodometer: Number(raw.hodometer),
      licensingExpiration: raw.licensingExpiration || null,
      color: raw.color?.trim() || null,
      purchaseDate: raw.purchaseDate || null,
      ipvaAmount: ipvaAmountCents,
      ipvaDueDate: raw.ipvaDueDate || null,
      ipvaStatus: (raw.ipvaStatus || null) as IpvaStatus | null,
      fuel: (raw.fuel || null) as VehicleFuel | null,
    };

    if (this.isEdit()) {
      const payload: UpdateVehicleRequest = commonPayload;
      const vehicleId = this.editingId()!; // isEdit() === true garante o id.
      this.saveChildren(this.vehiclesService.update(vehicleId, payload));
    } else {
      const createPayload: CreateVehicleRequest = {
        ...commonPayload,
        chassis: raw.chassis?.trim() || null,
        renavam: raw.renavam?.trim() || null,
      };
      this.saveChildren(this.vehiclesService.create(createPayload));
    }
  }

  /**
   * Encadeia os blocos opcionais (financiamento e seguro) depois do save do
   * veículo. Cada filho trata o próprio erro inline e completa com `EMPTY`, de
   * modo que uma falha do filho NÃO navega nem dispara o handler do veículo —
   * o PUT/POST do veículo já pode ter passado e o usuário precisa saber disso.
   */
  private saveChildren(save$: Observable<Vehicle>): void {
    save$
      .pipe(
        switchMap((v) => this.financingStep(v)),
        switchMap((v) => this.insuranceStep(v)),
      )
      .subscribe({
        next: (v) => {
          this.saving.set(false);
          if (this.willSubmitFinancing()) {
            this.notifications.success('Financiamento adicionado ao veículo.');
          }
          if (this.willSubmitInsurance()) {
            this.notifications.success('Seguro adicionado ao veículo.');
          }
          this.router.navigate(['/veiculos', v.id]);
        },
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
  }

  private financingStep(v: Vehicle): Observable<Vehicle> {
    if (!this.willSubmitFinancing()) return of(v);
    return this.vehiclesService.createFinancing(v.id, this.buildFinancingPayload()).pipe(
      map(() => v),
      catchError((err: HttpErrorResponse) => {
        this.handleFinancingError(err);
        return EMPTY;
      }),
    );
  }

  private insuranceStep(v: Vehicle): Observable<Vehicle> {
    if (!this.willSubmitInsurance()) return of(v);
    return this.insurancesService.create(v.id, this.buildInsurancePayload()).pipe(
      map(() => v),
      catchError((err: HttpErrorResponse) => {
        this.handleInsuranceError(err);
        return EMPTY;
      }),
    );
  }

  /**
   * O bloco de financiamento só é enviado quando o usuário o abriu E o veículo
   * ainda não tem um financiamento ativo (na criação `canAddFinancing()` é sempre true).
   */
  protected willSubmitFinancing(): boolean {
    return this.showFinancing() && this.canAddFinancing();
  }

  /** O bloco de seguro só é enviado quando o usuário o abriu. */
  protected willSubmitInsurance(): boolean {
    return this.showInsurance();
  }

  private buildInsurancePayload(): CreateInsuranceRequest {
    const raw = this.insuranceForm.getRawValue();
    return {
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
  }

  private buildFinancingPayload(): CreateFinancingRequest {
    const fRaw = this.financingForm.getRawValue();
    return {
      contractDate: fRaw.contractDate,
      purchasePrice: toCents(Number(fRaw.purchasePrice)) ?? 0,
      downPayment: fRaw.downPayment ? toCents(Number(fRaw.downPayment)) : null,
      installments: fRaw.installments ? Number(fRaw.installments) : null,
      installmentAmount: fRaw.installmentAmount ? toCents(Number(fRaw.installmentAmount)) : null,
      totalFinanced: null,
    };
  }

  /**
   * Backend `fieldErrors` land on the matching controls (inline, under the field);
   * only what is left over goes to the form banner. Never a toast — the interceptor
   * skips 4xx and `ApiErrorService.handleForm` claims the error so the safety net
   * stays quiet.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar o veículo.',
    );
    this.error.set(formMessage);
  }

  /**
   * Falha do POST do financiamento durante a EDIÇÃO. `fieldErrors` de
   * `contractDate` / `purchasePrice` / … caem inline no `financingForm`; o que
   * sobrar (ex.: 409 "já existe financiamento ativo") vai para o banner.
   */
  private handleFinancingError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage, applied } = this.apiErrors.handleForm(
      err,
      this.financingForm,
      'Não foi possível adicionar o financiamento.',
    );
    this.error.set(
      formMessage ??
        (applied.length > 0
          ? 'Verifique os campos do financiamento destacados e tente novamente.'
          : 'Não foi possível adicionar o financiamento.'),
    );
  }

  /**
   * Falha do POST do seguro. `fieldErrors` caem inline no `insuranceForm`; o que
   * sobrar (ex.: 409 "veículo já possui apólice ativa") vai para o banner —
   * nunca para um toast.
   */
  private handleInsuranceError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage, applied } = this.apiErrors.handleForm(
      err,
      this.insuranceForm,
      'Não foi possível adicionar o seguro.',
    );
    this.error.set(
      formMessage ??
        (applied.length > 0
          ? 'Verifique os campos do seguro destacados e tente novamente.'
          : 'Não foi possível adicionar o seguro.'),
    );
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/veiculos', this.editingId()]);
    } else {
      this.router.navigate(['/veiculos']);
    }
  }

  protected fieldInvalid(path: string[]): boolean {
    let ctrl: AbstractControl | null = this.form;
    for (const seg of path) ctrl = ctrl?.get(seg) ?? null;
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  protected financingFieldInvalid(name: string): boolean {
    const ctrl = this.financingForm.get(name);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      cents / 100,
    );
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
  }

  protected hasYearRangeError(): boolean {
    return (
      this.form.hasError('yearModelRange') &&
      (this.form.controls.yearModel.touched || this.form.controls.yearManufacture.touched)
    );
  }
}
