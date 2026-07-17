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
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import {
  VehicleSummary,
  VehicleSummaryChip,
} from '../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  MAINTENANCE_STATUS_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  Maintenance,
} from '../../types/maintenance.types';
import { licensingBadge } from '../../utils/status-maps';

@Component({
  selector: 'app-maintenance-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, ConfirmDialog, DetailActions, VehicleSummaryChip],
  templateUrl: './maintenance-detail.html',
})
export class MaintenanceDetail implements OnInit {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly item = signal<Maintenance | null>(null);
  protected readonly vehicle = signal<VehicleSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly typeInfo = computed(() => {
    const t = this.item()?.type;
    return MAINTENANCE_TYPE_OPTIONS.find((o) => o.value === t) ?? null;
  });
  protected readonly statusInfo = computed(() => {
    const s = this.item()?.status;
    return MAINTENANCE_STATUS_OPTIONS.find((o) => o.value === s) ?? null;
  });

  protected readonly nextBadge = computed(() => {
    const iso = this.item()?.nextServiceDate;
    if (!iso) return null;
    const badge = licensingBadge(iso);
    // Only surface urgency states for the "próxima manutenção" chip — "Em dia"
    // is redundant next to the plain date.
    if (badge.label === 'Vencido' || badge.label.startsWith('Vence em')) {
      return badge;
    }
    return null;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.maintenancesService.getOne(id).subscribe({
      next: (m) => {
        this.item.set(m);
        this.loading.set(false);
        this.loadVehicle(m.vehicleId);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Manutenção não encontrada.'));
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

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }
  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }
  protected confirmDelete(): void {
    const m = this.item();
    if (!m) return;
    this.deleting.set(true);
    this.maintenancesService.remove(m.id).subscribe({
      next: () => this.router.navigate(['/manutencoes']),
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.error.set(this.extractError(err, 'Não foi possível excluir.'));
      },
    });
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatNumber(n: number | null | undefined): string {
    if (n == null) return '—';
    return new Intl.NumberFormat('pt-BR').format(n);
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
