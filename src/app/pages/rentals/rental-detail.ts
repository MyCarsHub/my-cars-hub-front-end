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
import { NotificationService } from '../../services/notification.service';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import {
  RentalChargeDto,
  RentalResponseDto,
  RentalStatus,
  RentalStatusHistoryDto,
  billingFrequencyLabel,
  chargeKindLabel,
  chargeStatusInfo,
  rentalRateLabel,
  rentalStatusInfo,
} from '../../types/rental.types';
import { RENTAL_STATUS_META } from '../../utils/status-maps';

@Component({
  selector: 'app-rental-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, ConfirmDialog, DetailActions],
  templateUrl: './rental-detail.html',
})
export class RentalDetail implements OnInit {
  private readonly rentalService = inject(RentalService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly driverService = inject(DriverService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly rental = signal<RentalResponseDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly vehiclePlate = signal<string>('—');
  protected readonly vehicleLabel = signal<string>('');
  protected readonly driverNameSig = signal<string>('—');

  protected readonly history = signal<RentalStatusHistoryDto[]>([]);
  protected readonly historyLoading = signal(false);
  protected readonly historyOpen = signal(false);

  protected readonly cancelOpen = signal(false);
  protected readonly cancelBusy = signal(false);

  protected readonly completeOpen = signal(false);
  protected readonly completeBusy = signal(false);

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly statusInfo = computed(() => {
    const r = this.rental();
    return r ? rentalStatusInfo(r.status) : null;
  });

  protected readonly totalDays = computed(() => {
    const r = this.rental();
    if (!r) return 0;
    const s = new Date(r.startDate + 'T00:00:00').getTime();
    const e = new Date(r.endDate + 'T00:00:00').getTime();
    const diff = Math.round((e - s) / 86_400_000);
    return diff > 0 ? diff : 1;
  });

  protected readonly canCancel = computed(() => this.rental()?.status === 'RESERVED');
  protected readonly canComplete = computed(() => this.rental()?.status === 'ACTIVE');
  /**
   * Manual activation is only offered when the rental was created without
   * automatic charge (there's no Asaas webhook to move it to ACTIVE).
   */
  protected readonly canActivate = computed(() => {
    const r = this.rental();
    return r?.status === 'RESERVED' && r?.automaticCharge === false;
  });
  protected readonly activateBusy = signal(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.rentalService.getById(id).subscribe({
      next: (r) => {
        this.rental.set(r);
        this.loading.set(false);
        this.loadVehicle(r.vehicleId);
        this.loadDriver(r.driverId);
        this.loadHistory(r.id);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Aluguel não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  private loadVehicle(id: string): void {
    this.vehiclesService.getOne(id).subscribe({
      next: (v) => {
        this.vehiclePlate.set(this.formatPlate(v.plate));
        this.vehicleLabel.set(`${v.brand} ${v.model}`);
      },
      error: () => {
        this.vehiclePlate.set('—');
        this.vehicleLabel.set('');
      },
    });
  }

  private loadDriver(id: string): void {
    this.driverService.getOne(id).subscribe({
      next: (d) => this.driverNameSig.set(d.name),
      error: () => this.driverNameSig.set('—'),
    });
  }

  protected askCancel(): void {
    this.cancelOpen.set(true);
  }
  protected cancelCancel(): void {
    if (this.cancelBusy()) return;
    this.cancelOpen.set(false);
  }
  protected confirmCancel(): void {
    const r = this.rental();
    if (!r) return;
    this.cancelBusy.set(true);
    this.rentalService.cancel(r.id).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.cancelBusy.set(false);
        this.cancelOpen.set(false);
        this.refreshHistoryAfterTransition();
      },
      error: (err: HttpErrorResponse) => {
        this.cancelBusy.set(false);
        this.cancelOpen.set(false);
        this.error.set(this.extractError(err, 'Não foi possível cancelar.'));
      },
    });
  }

  protected askComplete(): void {
    this.completeOpen.set(true);
  }
  protected cancelComplete(): void {
    if (this.completeBusy()) return;
    this.completeOpen.set(false);
  }
  protected confirmComplete(): void {
    const r = this.rental();
    if (!r) return;
    this.completeBusy.set(true);
    this.rentalService.complete(r.id).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.completeBusy.set(false);
        this.completeOpen.set(false);
        this.refreshHistoryAfterTransition();
      },
      error: (err: HttpErrorResponse) => {
        this.completeBusy.set(false);
        this.completeOpen.set(false);
        this.error.set(this.extractError(err, 'Não foi possível concluir.'));
      },
    });
  }

  protected activate(): void {
    const r = this.rental();
    if (!r || this.activateBusy()) return;
    this.activateBusy.set(true);
    this.rentalService.activate(r.id).subscribe({
      next: (updated) => {
        this.rental.set(updated);
        this.activateBusy.set(false);
        this.notifications.push('success', 'Aluguel marcado como ativo.');
        this.refreshHistoryAfterTransition();
      },
      error: (err: HttpErrorResponse) => {
        this.activateBusy.set(false);
        this.notifications.push(
          'error',
          this.extractError(err, 'Não foi possível ativar o aluguel.'),
        );
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
    const r = this.rental();
    if (!r) return;
    this.deleting.set(true);
    this.rentalService.remove(r.id).subscribe({
      next: () => this.router.navigate(['/alugueis']),
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.error.set(this.extractError(err, 'Não foi possível excluir.'));
      },
    });
  }

  protected payCharge(charge: RentalChargeDto): void {
    if (!charge.checkoutUrl) return;
    window.open(charge.checkoutUrl, '_blank', 'noopener,noreferrer');
  }

  protected chargeKindLabel(kind: RentalChargeDto['kind']): string {
    return chargeKindLabel(kind);
  }

  protected billingFrequencyLabel(f: RentalResponseDto['billingFrequency']): string {
    return billingFrequencyLabel(f);
  }

  /** Dynamic label for the `dailyRate` field based on billing frequency. */
  protected rateLabel(f: RentalResponseDto['billingFrequency']): string {
    return rentalRateLabel(f);
  }

  protected chargeStatusInfo(status: RentalChargeDto['status']): { label: string; chip: string } {
    return chargeStatusInfo(status);
  }

  protected canPayCharge(charge: RentalChargeDto): boolean {
    return charge.status === 'PENDING' && !!charge.checkoutUrl;
  }

  private loadHistory(id: string): void {
    this.historyLoading.set(true);
    this.rentalService.history(id).subscribe({
      next: (list) => {
        this.history.set(list);
        this.historyLoading.set(false);
      },
      error: () => {
        this.history.set([]);
        this.historyLoading.set(false);
      },
    });
  }

  protected toggleHistory(): void {
    this.historyOpen.update((v) => !v);
  }

  /**
   * Refresh history após qualquer transição de status. Chamado depois de
   * activate/cancel/complete pra manter a timeline sincronizada com o rental.
   */
  private refreshHistoryAfterTransition(): void {
    const r = this.rental();
    if (r) this.loadHistory(r.id);
  }

  protected historyStatusMeta(status: RentalStatus | null | undefined): {
    label: string;
    chip: string;
    color: string;
  } {
    if (!status) {
      return { label: 'Criado', chip: 'bg-neutral-100 text-neutral-700', color: '#6b7280' };
    }
    return RENTAL_STATUS_META[status];
  }

  protected backToList(): void {
    this.router.navigate(['/alugueis']);
  }

  protected formatPlate(plate: string): string {
    const p = (plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-BR');
  }

  protected formatDateTime(iso: string | null): string {
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
