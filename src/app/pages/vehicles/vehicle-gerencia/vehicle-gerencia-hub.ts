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
import { GerenciaSummary } from '../../../types/gerencia-summary.types';

type KpiVariant = 'default' | 'success' | 'warning' | 'danger';

interface KpiViewModel {
  key: 'fines' | 'maintenances' | 'financing' | 'licensing';
  title: string;
  value: string;
  subtitle: string | null;
  variant: KpiVariant;
  icon: 'alert' | 'wrench' | 'money' | 'document';
  routerLink: (string | number)[] | null;
}

@Component({
  selector: 'app-vehicle-gerencia-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, VehicleSummaryChip],
  templateUrl: './vehicle-gerencia-hub.html',
})
export class VehicleGerenciaHub implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly route = inject(ActivatedRoute);

  protected readonly vehicleId = signal<string>('');
  protected readonly summary = signal<GerenciaSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

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
    };
  });

  protected readonly kpis = computed<KpiViewModel[]>(() => {
    const s = this.summary();
    const id = this.vehicleId();
    if (!s || !id) return [];

    return [
      this.buildFinesKpi(s, id),
      this.buildMaintenancesKpi(s, id),
      this.buildFinancingKpi(s, id),
      this.buildLicensingKpi(s),
    ];
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

  private buildFinesKpi(s: GerenciaSummary, id: string): KpiViewModel {
    const openCount = s.fines.openCount ?? 0;
    return {
      key: 'fines',
      title: 'Multas',
      value: openCount > 0 ? `${openCount} pendente${openCount > 1 ? 's' : ''}` : 'Nenhuma pendente',
      subtitle: openCount > 0 ? this.formatCurrency(s.fines.openAmountCents) : null,
      variant: openCount > 0 ? 'danger' : 'default',
      icon: 'alert',
      routerLink: ['/veiculos', id, 'gerencia', 'multas'],
    };
  }

  private buildMaintenancesKpi(s: GerenciaSummary, id: string): KpiViewModel {
    const openCount = s.maintenances.openCount ?? 0;
    return {
      key: 'maintenances',
      title: 'Manutenções',
      value: openCount > 0 ? `${openCount} agendada${openCount > 1 ? 's' : ''}` : 'Sem agendamentos',
      subtitle: s.maintenances.nextServiceDate
        ? `Próxima: ${this.formatDate(s.maintenances.nextServiceDate)}`
        : null,
      variant: openCount > 0 ? 'warning' : 'default',
      icon: 'wrench',
      routerLink: ['/veiculos', id, 'gerencia', 'manutencoes'],
    };
  }

  private buildFinancingKpi(s: GerenciaSummary, id: string): KpiViewModel {
    const f = s.activeFinancing;
    if (!f) {
      return {
        key: 'financing',
        title: 'Financiamento',
        value: 'Sem financiamento',
        subtitle: null,
        variant: 'default',
        icon: 'money',
        routerLink: ['/veiculos', id, 'gerencia', 'financiamentos'],
      };
    }
    return {
      key: 'financing',
      title: 'Financiamento',
      value: 'ATIVO',
      subtitle: f.installments != null ? `${f.installments} parcelas` : null,
      variant: 'success',
      icon: 'money',
      routerLink: ['/veiculos', id, 'gerencia', 'financiamentos'],
    };
  }

  private buildLicensingKpi(s: GerenciaSummary): KpiViewModel {
    const l = s.licensing;
    let value = 'Sem cadastro';
    let subtitle: string | null = null;
    let variant: KpiVariant = 'default';

    if (l.expiration) {
      if (l.expired) {
        value = 'Vencido';
        subtitle = this.formatDate(l.expiration);
        variant = 'danger';
      } else if (l.expiringSoon) {
        const days = this.daysUntil(l.expiration);
        value = days != null ? `Vence em ${days}d` : 'Vence em breve';
        subtitle = this.formatDate(l.expiration);
        variant = 'warning';
      } else {
        value = this.formatDate(l.expiration);
        subtitle = 'Em dia';
      }
    }

    return {
      key: 'licensing',
      title: 'Licenciamento',
      value,
      subtitle,
      variant,
      icon: 'document',
      routerLink: null,
    };
  }

  protected variantClasses(variant: KpiVariant): string {
    switch (variant) {
      case 'danger':
        return 'border-rose-200 bg-rose-50/60 hover:border-rose-300';
      case 'warning':
        return 'border-amber-200 bg-amber-50/60 hover:border-amber-300';
      case 'success':
        return 'border-emerald-200 bg-emerald-50/60 hover:border-emerald-300';
      default:
        return 'border-neutral-200 bg-white hover:border-primary-300';
    }
  }

  protected iconClasses(variant: KpiVariant): string {
    switch (variant) {
      case 'danger':
        return 'bg-rose-100 text-rose-700';
      case 'warning':
        return 'bg-amber-100 text-amber-700';
      case 'success':
        return 'bg-emerald-100 text-emerald-700';
      default:
        return 'bg-primary-50 text-primary-600';
    }
  }

  protected valueClasses(variant: KpiVariant): string {
    switch (variant) {
      case 'danger':
        return 'text-rose-800';
      case 'warning':
        return 'text-amber-800';
      case 'success':
        return 'text-emerald-800';
      default:
        return 'text-neutral-900';
    }
  }

  private formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-BR');
  }

  private formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  private daysUntil(iso: string): number | null {
    if (!iso) return null;
    const then = new Date(iso + 'T00:00:00').getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((then - today) / 86400000);
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
