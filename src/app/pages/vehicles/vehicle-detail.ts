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
import { Vehicle, VehicleType } from '../../types/vehicle.types';

const TYPE_LABEL: Record<VehicleType, { label: string; chip: string }> = {
  CAR: { label: 'Carro', chip: 'bg-blue-100 text-blue-700' },
  MOTORCYCLE: { label: 'Moto', chip: 'bg-amber-100 text-amber-800' },
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
      next: () => this.router.navigate(['/veiculos']),
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
