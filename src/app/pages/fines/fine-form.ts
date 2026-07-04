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
  Validators,
} from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
import { FinesService } from '../../services/fines.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import {
  CreateFineRequest,
  FINE_SEVERITY_OPTIONS,
  FINE_STATUS_OPTIONS,
  FineSeverity,
  FineStatus,
  UpdateFineRequest,
} from '../../types/fine.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { DriverListItem } from '../../types/driver.types';

const SEVERITY_VALUES: FineSeverity[] = ['LEVE', 'MEDIA', 'GRAVE', 'GRAVISSIMA'];
const STATUS_VALUES: FineStatus[] = ['PENDING', 'PAID', 'CONTESTED', 'CANCELED'];

@Component({
  selector: 'app-fine-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard],
  templateUrl: './fine-form.html',
})
export class FineForm implements OnInit {
  private readonly finesService = inject(FinesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly severityOptions = FINE_SEVERITY_OPTIONS.filter((o) => o.value !== '');
  protected readonly statusOptions = FINE_STATUS_OPTIONS.filter((o) => o.value !== '');

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly vehicles = signal<VehicleListItem[]>([]);
  protected readonly drivers = signal<DriverListItem[]>([]);

  protected readonly form = this.fb.nonNullable.group({
    vehicleId: ['', [Validators.required]],
    driverId: [''],
    infractionCode: ['', [Validators.maxLength(20)]],
    description: ['', [Validators.required, Validators.maxLength(300)]],
    infractionDate: ['', [Validators.required]],
    location: ['', [Validators.maxLength(200)]],
    amountReais: [0, [Validators.required, Validators.min(0.01)]],
    points: [null as number | null],
    severity: ['MEDIA' as FineSeverity, [Validators.required]],
    dueDate: [''],
    status: ['PENDING' as FineStatus, [Validators.required]],
    paidDate: [''],
    notes: [''],
  });

  ngOnInit(): void {
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
    this.driverService.list({ size: 500, sort: 'name_asc' }).subscribe({
      next: (res) => this.drivers.set(res.content ?? []),
      error: () => this.drivers.set([]),
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.load(id);
      this.form.controls.vehicleId.disable();
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.finesService.getOne(id).subscribe({
      next: (f) => {
        this.form.patchValue({
          vehicleId: f.vehicleId,
          driverId: f.driverId ?? '',
          infractionCode: f.infractionCode ?? '',
          description: f.description,
          infractionDate: this.isoToInputDateTime(f.infractionDate),
          location: f.location ?? '',
          amountReais: f.amountCents / 100,
          points: f.points,
          severity: f.severity,
          dueDate: f.dueDate ?? '',
          status: f.status,
          paidDate: f.paidDate ?? '',
          notes: f.notes ?? '',
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Multa não encontrada.'));
        this.loading.set(false);
      },
    });
  }

  protected onSeverityChange(): void {
    // Prefill default points when field is empty.
    const sev = this.form.controls.severity.value;
    const cur = this.form.controls.points.value;
    if (cur == null) {
      const opt = FINE_SEVERITY_OPTIONS.find((o) => o.value === sev);
      if (opt && opt.defaultPoints > 0) {
        this.form.controls.points.setValue(opt.defaultPoints);
      }
    }
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
    const raw = this.form.getRawValue();
    const amountCents = toCents(Number(raw.amountReais)) ?? 0;

    if (this.isEdit()) {
      const payload: UpdateFineRequest = {
        driverId: raw.driverId || null,
        infractionCode: raw.infractionCode?.trim() || null,
        description: raw.description.trim(),
        infractionDate: this.inputDateTimeToIso(raw.infractionDate),
        location: raw.location?.trim() || null,
        amountCents,
        points: raw.points ?? null,
        severity: raw.severity,
        dueDate: raw.dueDate || null,
        status: raw.status,
        paidDate: raw.paidDate || null,
        notes: raw.notes?.trim() || null,
      };
      this.finesService.update(this.editingId()!, payload).subscribe({
        next: (f) => this.router.navigate(['/multas', f.id]),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    } else {
      const payload: CreateFineRequest = {
        vehicleId: raw.vehicleId,
        driverId: raw.driverId || null,
        infractionCode: raw.infractionCode?.trim() || null,
        description: raw.description.trim(),
        infractionDate: this.inputDateTimeToIso(raw.infractionDate),
        location: raw.location?.trim() || null,
        amountCents,
        points: raw.points ?? null,
        severity: raw.severity,
        dueDate: raw.dueDate || null,
        status: raw.status,
        paidDate: raw.paidDate || null,
        notes: raw.notes?.trim() || null,
      };
      this.finesService.create(payload).subscribe({
        next: (f) => this.router.navigate(['/multas', f.id]),
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
    }
  }

  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.error.set(this.extractError(err, 'Não foi possível salvar a multa.'));
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }

  /** Converts backend LocalDateTime (yyyy-MM-ddTHH:mm:ss[.SSS]) to <input type="datetime-local"> value. */
  private isoToInputDateTime(iso: string): string {
    if (!iso) return '';
    // slice to minute precision
    return iso.length >= 16 ? iso.slice(0, 16) : iso;
  }

  /** datetime-local returns yyyy-MM-ddTHH:mm → add ':00' for backend LocalDateTime. */
  private inputDateTimeToIso(v: string): string {
    if (!v) return '';
    return v.length === 16 ? `${v}:00` : v;
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/multas', this.editingId()]);
    } else {
      this.router.navigate(['/multas']);
    }
  }

  protected fieldInvalid(name: string): boolean {
    const ctrl: AbstractControl | null = this.form.get(name);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }
}
