import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { switchMap } from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { FinancingFormFields } from '../../components/vehicles/financing-form-fields/financing-form-fields';
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
import { VehiclesService } from '../../services/vehicles.service';
import {
  CreateFinancingRequest,
  CreateVehicleRequest,
  IPVA_STATUS_OPTIONS,
  IpvaStatus,
  UpdateVehicleRequest,
  VEHICLE_FUEL_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
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
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, PrimaryInput, FinancingFormFields],
  templateUrl: './vehicle-form.html',
})
export class VehicleForm implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
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

  protected readonly plateDisplay = signal('');
  protected readonly showFinancing = signal(false);

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
        this.error.set(this.extractError(err, 'Veículo não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected toggleFinancing(): void {
    this.showFinancing.update((v) => !v);
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    if (this.showFinancing() && !this.isEdit() && this.financingForm.invalid) {
      this.financingForm.markAllAsTouched();
      this.error.set('Verifique os campos do financiamento.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

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
      this.vehiclesService.update(this.editingId()!, payload).subscribe({
        next: (v) => this.router.navigate(['/veiculos', v.id]),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    } else {
      const createPayload: CreateVehicleRequest = {
        ...commonPayload,
        chassis: raw.chassis?.trim() || null,
        renavam: raw.renavam?.trim() || null,
      };

      if (this.showFinancing()) {
        const fRaw = this.financingForm.getRawValue();
        const financingPayload: CreateFinancingRequest = {
          contractDate: fRaw.contractDate,
          purchasePrice: toCents(Number(fRaw.purchasePrice)) ?? 0,
          downPayment: fRaw.downPayment ? toCents(Number(fRaw.downPayment)) : null,
          installments: fRaw.installments ? Number(fRaw.installments) : null,
          installmentAmount: fRaw.installmentAmount
            ? toCents(Number(fRaw.installmentAmount))
            : null,
          totalFinanced: null,
        };
        this.vehiclesService
          .create(createPayload)
          .pipe(
            switchMap((v) =>
              this.vehiclesService
                .createFinancing(v.id, financingPayload)
                .pipe(switchMap(() => [v])),
            ),
          )
          .subscribe({
            next: (v) => this.router.navigate(['/veiculos', v.id]),
            error: (err: HttpErrorResponse) => this.handleError(err),
          });
      } else {
        this.vehiclesService.create(createPayload).subscribe({
          next: (v) => this.router.navigate(['/veiculos', v.id]),
          error: (err: HttpErrorResponse) => this.handleError(err),
        });
      }
    }
  }

  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.error.set(this.extractError(err, 'Não foi possível salvar o veículo.'));
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
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

  protected hasYearRangeError(): boolean {
    return (
      this.form.hasError('yearModelRange') &&
      (this.form.controls.yearModel.touched || this.form.controls.yearManufacture.touched)
    );
  }
}
