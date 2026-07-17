import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import {
  VehicleSummaryChip,
  VehicleSummary,
} from '../../../components/vehicles/vehicle-summary-chip/vehicle-summary-chip';
import { VehiclesService } from '../../../services/vehicles.service';
import { GerenciaFinanceChunk, GerenciaSummary } from '../../../types/gerencia-summary.types';
import { FinancingsList } from '../../financings/financings-list';
import { MaintenancesList } from '../../maintenances/maintenances-list';
import { RentalService } from '../../rentals/rental.service';
import { RentalListItemDto, rentalStatusInfo } from '../../../types/rental.types';
import { licensingBadge } from '../../../utils/status-maps';

type TabKey = 'financeiro' | 'manutencoes' | 'alugueis' | 'documentos';

interface TabDef {
  key: TabKey;
  label: string;
}

@Component({
  selector: 'app-vehicle-gerencia-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DefaultPageLayout,
    VehicleSummaryChip,
    FinancingsList,
    MaintenancesList,
  ],
  templateUrl: './vehicle-gerencia-hub.html',
})
export class VehicleGerenciaHub implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly rentalService = inject(RentalService);
  private readonly route = inject(ActivatedRoute);

  protected readonly vehicleId = signal<string>('');
  protected readonly summary = signal<GerenciaSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly rentals = signal<RentalListItemDto[]>([]);
  protected readonly rentalsLoading = signal(false);
  protected readonly rentalsError = signal<string | null>(null);
  private rentalsFetched = false;

  protected readonly activeTab = signal<TabKey>('financeiro');

  protected readonly tabs: TabDef[] = [
    { key: 'financeiro', label: 'Financeiro' },
    { key: 'manutencoes', label: 'Manutenções' },
    { key: 'alugueis', label: 'Aluguéis' },
    { key: 'documentos', label: 'Documentos' },
  ];

  protected readonly chipVehicle = computed<VehicleSummary | null>(() => {
    const s = this.summary();
    if (!s) return null;
    return {
      id: s.vehicle.id,
      plate: s.vehicle.plate,
      brand: s.vehicle.brand,
      model: s.vehicle.model,
      hodometer: s.vehicle.hodometer,
      licensingExpiration: s.vehicle.licensingExpiration,
      type: s.vehicle.type,
      status: s.vehicle.status,
    };
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.vehicleId.set(id);
    this.load(id);
  }

  protected retry(): void {
    const id = this.vehicleId();
    if (id) this.load(id);
  }

  protected selectTab(key: TabKey): void {
    this.activeTab.set(key);
    if (key === 'alugueis' && !this.rentalsFetched) {
      this.loadRentals(this.vehicleId());
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getGerenciaSummary(id).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.extractError(err, 'Não foi possível carregar a gerência do veículo.'));
      },
    });
  }

  private loadRentals(vehicleId: string): void {
    if (!vehicleId) return;
    this.rentalsLoading.set(true);
    this.rentalsError.set(null);
    this.rentalService.list({ vehicleId, size: 50 }).subscribe({
      next: (res) => {
        this.rentals.set(res.content ?? []);
        this.rentalsFetched = true;
        this.rentalsLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.rentalsLoading.set(false);
        this.rentalsError.set(this.extractError(err, 'Não foi possível carregar os aluguéis.'));
      },
    });
  }

  protected retryRentals(): void {
    this.rentalsFetched = false;
    this.loadRentals(this.vehicleId());
  }

  protected formatMoney(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-BR');
  }

  protected daysUntil(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const then = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((then - today) / 86400000);
  }

  protected rentalStatusChip(status: RentalListItemDto['status']): { label: string; chip: string } {
    return rentalStatusInfo(status);
  }

  /** Sign-aware currency: negative results shown in red, positive in green. */
  protected resultClass(cents: number): string {
    if (cents > 0) return 'text-emerald-700';
    if (cents < 0) return 'text-rose-700';
    return 'text-neutral-900';
  }

  /**
   * Color for the "Recebido" amount vs contracted revenue:
   * - equal (fully paid) → emerald
   * - < revenue but > 0 (partial) → amber
   * - 0 with revenue > 0 → neutral gray (hint shown separately)
   * - both zero → neutral
   */
  protected receivedClass(finance: GerenciaFinanceChunk): string {
    const rev = finance.totalRentalRevenueCents;
    const recv = finance.totalRentalReceivedCents;
    if (rev === 0 && recv === 0) return 'text-neutral-900';
    if (recv === 0) return 'text-neutral-500';
    if (recv >= rev) return 'text-emerald-700';
    return 'text-amber-700';
  }

  protected licensingChipLabel(): { label: string; chip: string } | null {
    const s = this.summary();
    if (!s) return null;
    const iso = s.licensing.expiration;
    if (!iso) return null;
    return licensingBadge(iso);
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
