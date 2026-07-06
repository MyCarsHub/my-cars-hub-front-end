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
import { FormsModule } from '@angular/forms';
import { animate, style, transition, trigger } from '@angular/animations';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import {
  VehicleSummary,
  VehicleSummaryChip,
} from '../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { FinesService } from '../../services/fines.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import {
  FINE_SEVERITY_OPTIONS,
  FINE_STATUS_OPTIONS,
  Fine,
  FineSeverity,
  FineStatus,
} from '../../types/fine.types';

@Component({
  selector: 'app-fine-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    DetailActions,
    VehicleSummaryChip,
  ],
  templateUrl: './fine-detail.html',
  animations: [
    trigger('sheetBackdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('sheet', [
      transition(':enter', [
        style({ transform: 'translateY(100%)' }),
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateY(0)' })),
      ]),
      transition(':leave', [
        animate('150ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateY(100%)' })),
      ]),
    ]),
  ],
})
export class FineDetail implements OnInit {
  private readonly finesService = inject(FinesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly fine = signal<Fine | null>(null);
  protected readonly vehicle = signal<VehicleSummary | null>(null);
  protected readonly driverName = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly payOpen = signal(false);
  protected readonly paying = signal(false);
  protected readonly payDate = signal('');

  protected readonly statusInfo = computed(() => {
    const s = this.fine()?.status;
    return FINE_STATUS_OPTIONS.find((o) => o.value === s) ?? null;
  });
  protected readonly severityInfo = computed(() => {
    const s = this.fine()?.severity;
    return FINE_SEVERITY_OPTIONS.find((o) => o.value === s) ?? null;
  });

  protected readonly overdue = computed(() => {
    const f = this.fine();
    if (!f || f.status !== 'PENDING' || !f.dueDate) return false;
    const due = new Date(f.dueDate + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return due < today;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.finesService.getOne(id).subscribe({
      next: (f) => {
        this.fine.set(f);
        this.loading.set(false);
        this.loadVehicle(f.vehicleId);
        if (f.driverId) this.loadDriver(f.driverId);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Multa não encontrada.'));
        this.loading.set(false);
      },
    });
  }

  private loadVehicle(id: string): void {
    this.vehiclesService.getOne(id).subscribe({
      next: (v) =>
        this.vehicle.set({
          id: v.id,
          plate: v.plate,
          brand: v.brand,
          model: v.model,
          type: v.type,
          hodometer: v.hodometer,
          licensingExpiration: v.licensingExpiration,
        }),
      error: () => this.vehicle.set(null),
    });
  }

  private loadDriver(id: string): void {
    this.driverService.getOne(id).subscribe({
      next: (d) => this.driverName.set(d.name),
      error: () => this.driverName.set(null),
    });
  }

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }
  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }
  protected confirmDelete(): void {
    const f = this.fine();
    if (!f) return;
    this.deleting.set(true);
    this.finesService.remove(f.id).subscribe({
      next: () => this.router.navigate(['/multas']),
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.error.set(this.extractError(err, 'Não foi possível excluir.'));
      },
    });
  }

  protected openPay(): void {
    this.payDate.set('');
    this.payOpen.set(true);
  }
  protected closePay(): void {
    if (this.paying()) return;
    this.payOpen.set(false);
  }
  protected confirmPay(): void {
    const f = this.fine();
    if (!f) return;
    this.paying.set(true);
    this.finesService.pay(f.id, { paidDate: this.payDate() || undefined }).subscribe({
      next: (updated) => {
        this.paying.set(false);
        this.payOpen.set(false);
        this.fine.set(updated);
      },
      error: (err: HttpErrorResponse) => {
        this.paying.set(false);
        this.error.set(this.extractError(err, 'Não foi possível marcar como paga.'));
      },
    });
  }

  protected canMarkAsPaid(): boolean {
    const s = this.fine()?.status;
    return s === 'PENDING' || s === 'CONTESTED';
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
