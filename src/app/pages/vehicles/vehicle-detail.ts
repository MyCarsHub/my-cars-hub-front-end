import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { DetailActions } from '../../components/core/detail-actions/detail-actions';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import { IpvaStatus, Vehicle, VehicleType } from '../../types/vehicle.types';
import { vehicleStatusMeta } from '../../utils/status-maps';

const TYPE_LABEL: Record<VehicleType, { label: string; chip: string }> = {
  CAR: { label: 'Carro', chip: 'bg-blue-100 text-blue-700' },
  MOTORCYCLE: { label: 'Moto', chip: 'bg-amber-100 text-amber-800' },
};

const IPVA_STATUS_LABEL: Record<IpvaStatus, { label: string; chip: string }> = {
  PAID: { label: 'Pago', chip: 'bg-emerald-100 text-emerald-800' },
  PENDING: { label: 'Pendente', chip: 'bg-amber-100 text-amber-800' },
  OVERDUE: { label: 'Vencido', chip: 'bg-red-100 text-red-800' },
};

@Component({
  selector: 'app-vehicle-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DecimalPipe,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    DetailActions,
  ],
  templateUrl: './vehicle-detail.html',
})
export class VehicleDetail implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  protected readonly transitioning = signal(false);

  protected readonly vehicle = signal<Vehicle | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly vehicleId = computed(() => this.vehicle()?.id ?? '');

  protected readonly typeInfo = computed(() => {
    const t = this.vehicle()?.type;
    return t ? TYPE_LABEL[t] : { label: '—', chip: 'bg-neutral-100 text-neutral-700' };
  });

  protected readonly statusInfo = computed(() => {
    const s = this.vehicle()?.status;
    return vehicleStatusMeta(s);
  });

  protected readonly canGoMaintenance = computed(() => {
    const s = this.vehicle()?.status;
    return s === 'AVAILABLE' || s === 'INACTIVE';
  });

  protected readonly canGoAvailable = computed(() => {
    const s = this.vehicle()?.status;
    return s === 'MAINTENANCE' || s === 'INACTIVE';
  });

  protected readonly canGoInactive = computed(() => {
    const s = this.vehicle()?.status;
    return s === 'AVAILABLE' || s === 'MAINTENANCE';
  });

  protected readonly deleteDisabledReason = computed(() => {
    const s = this.vehicle()?.status;
    if (s === 'RENTED') {
      return 'Veículo está alugado. Finalize o aluguel para excluir.';
    }
    return null;
  });

  protected readonly licensingBadge = computed(() => {
    const iso = this.vehicle()?.licensingExpiration;
    if (!iso) return null;
    const expiry = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((expiry - startOfToday) / 86400000);
    if (days < 0) return { label: 'Vencido', chip: 'bg-rose-100 text-rose-700' };
    if (days <= 30) return { label: `Vence em ${days}d`, chip: 'bg-amber-100 text-amber-800' };
    return null;
  });

  protected readonly hasIpva = computed(() => {
    const v = this.vehicle();
    if (!v) return false;
    return v.ipvaAmount != null || v.ipvaDueDate != null || v.ipvaStatus != null;
  });

  protected readonly ipvaStatusBadge = computed(() => {
    const s = this.vehicle()?.ipvaStatus;
    return s ? IPVA_STATUS_LABEL[s] : null;
  });

  protected readonly ipvaOverdueChip = computed(() => {
    const v = this.vehicle();
    if (!v || !v.ipvaExpired || v.ipvaStatus === 'PAID') return null;
    if (!v.ipvaDueDate) return { label: 'IPVA vencido' };
    const due = new Date(v.ipvaDueDate + 'T00:00:00').getTime();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.max(0, Math.round((startOfToday - due) / 86400000));
    if (days === 0) return { label: 'IPVA vence hoje' };
    return { label: `IPVA vencido há ${days} ${days === 1 ? 'dia' : 'dias'}` };
  });

  protected formatMoney(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getOne(id).subscribe({
      next: (v) => {
        this.vehicle.set(v);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Veículo não encontrado.'));
        this.loading.set(false);
      },
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
    const v = this.vehicle();
    if (!v) return;
    this.deleting.set(true);
    this.vehiclesService.remove(v.id).subscribe({
      next: () => {
        this.notify.success(`Veículo «${this.formatPlate(v.plate)}» excluído.`);
        this.router.navigate(['/veiculos']);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        const msg = this.extractError(err, 'Não foi possível excluir.');
        this.notify.error(msg);
      },
    });
  }

  protected transitionStatus(target: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE'): void {
    const v = this.vehicle();
    if (!v || this.transitioning()) return;
    this.transitioning.set(true);
    this.vehiclesService.updateStatus(v.id, target).subscribe({
      next: (updated) => {
        this.transitioning.set(false);
        this.vehicle.set(updated);
        this.notify.success(`Status atualizado para ${vehicleStatusMeta(updated.status).label}.`);
      },
      error: (err: HttpErrorResponse) => {
        this.transitioning.set(false);
        this.notify.error(this.extractError(err, 'Não foi possível alterar o status.'));
      },
    });
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatPlate(plate: string | undefined): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
