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
import { DriverService } from '../../services/driver.service';
import { DriverResponse, DriverStatus } from '../../types/driver.types';
import { driverStatusMeta, rentalStatusMeta } from '../../utils/status-maps';
import { RentalService } from '../rentals/rental.service';
import { RentalListItemDto } from '../../types/rental.types';

@Component({
  selector: 'app-driver-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, ConfirmDialog, DetailActions],
  templateUrl: './driver-detail.html',
})
export class DriverDetail implements OnInit {
  private readonly driverService = inject(DriverService);
  private readonly rentalService = inject(RentalService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly driver = signal<DriverResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly toggleStatusOpen = signal(false);
  protected readonly togglingStatus = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rentals = signal<RentalListItemDto[]>([]);
  protected readonly rentalsLoading = signal(false);
  protected readonly activeRental = computed<RentalListItemDto | null>(() => {
    const list = this.rentals();
    // ACTIVE takes precedence over RESERVED (driver becomes WORKING in both,
    // see backend RentalService.create) so the banner reflects the ongoing rental.
    return (
      list.find((r) => r.status === 'ACTIVE') ??
      list.find((r) => r.status === 'RESERVED') ??
      null
    );
  });

  protected readonly activeRentalBanner = computed(() => {
    const rental = this.activeRental();
    if (!rental) return null;
    if (rental.status === 'RESERVED') {
      return {
        label: 'Aluguel reservado',
        container: 'bg-amber-50 border-amber-200',
        eyebrow: 'text-amber-700',
        body: 'text-amber-900',
        link: 'text-amber-700 hover:text-amber-900',
        icon: 'clock' as const,
      };
    }
    return {
      label: 'Aluguel ativo',
      container: 'bg-blue-50 border-blue-200',
      eyebrow: 'text-blue-700',
      body: 'text-blue-900',
      link: 'text-blue-700 hover:text-blue-900',
      icon: 'arrow' as const,
    };
  });
  protected readonly recentRentals = computed(() => this.rentals().slice(0, 5));

  protected readonly statusInfo = computed(() => {
    const s = this.driver()?.status;
    if (!s) return { label: '—', chip: 'bg-neutral-100 text-neutral-700' };
    const meta = driverStatusMeta(s);
    return { label: meta.label, chip: meta.chip };
  });

  protected readonly expiringSoon = computed(() => {
    const iso = this.driver()?.licenseExpiry;
    if (!iso) return false;
    const days = (new Date(iso + 'T00:00:00').getTime() - Date.now()) / 86400000;
    return days < 30;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.load(id);
      this.loadRentals(id);
    }
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.driverService.getOne(id).subscribe({
      next: (d) => {
        this.driver.set(d);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Motorista não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  private loadRentals(driverId: string): void {
    this.rentalsLoading.set(true);
    // We rely on a fresh HTTP call — the rentals list signal in RentalService is
    // shared with the rentals page, so we don't read from it.
    this.rentalService.list({ driverId, size: 20, page: 0 }).subscribe({
      next: (res) => {
        this.rentals.set(res.content ?? []);
        this.rentalsLoading.set(false);
      },
      error: () => {
        this.rentals.set([]);
        this.rentalsLoading.set(false);
      },
    });
  }

  protected rentalStatusInfo(status: RentalListItemDto['status']): { label: string; chip: string } {
    const meta = rentalStatusMeta(status);
    return { label: meta.label, chip: meta.chip };
  }

  protected formatMoney(cents: number): string {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  protected canToggleStatus(): boolean {
    const s = this.driver()?.status;
    return s === 'AVAILABLE' || s === 'SUSPENDED';
  }

  protected canDelete(): boolean {
    return this.driver()?.status !== 'WORKING';
  }

  protected toggleStatusLabel(): string {
    return this.driver()?.status === 'SUSPENDED' ? 'Reativar' : 'Suspender';
  }

  protected askToggleStatus(): void {
    if (!this.canToggleStatus()) return;
    this.toggleStatusOpen.set(true);
  }

  protected cancelToggleStatus(): void {
    if (this.togglingStatus()) return;
    this.toggleStatusOpen.set(false);
  }

  protected confirmToggleStatus(): void {
    const d = this.driver();
    if (!d) return;
    const next: DriverStatus = d.status === 'SUSPENDED' ? 'AVAILABLE' : 'SUSPENDED';
    this.actionError.set(null);
    this.togglingStatus.set(true);
    this.driverService.changeStatus(d.id, next).subscribe({
      next: (updated) => {
        this.driver.set(updated);
        this.togglingStatus.set(false);
        this.toggleStatusOpen.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.togglingStatus.set(false);
        this.toggleStatusOpen.set(false);
        this.actionError.set(this.extractError(err, 'Não foi possível alterar o status.'));
      },
    });
  }

  protected toggleConfirmMessage(): string {
    const d = this.driver();
    if (!d) return '';
    return d.status === 'SUSPENDED'
      ? `Reativar «${d.name}»? O motorista voltará a ficar disponível para novos aluguéis.`
      : `Suspender «${d.name}»? O motorista ficará bloqueado para novos aluguéis até ser reativado.`;
  }

  protected askDelete(): void {
    if (!this.canDelete()) {
      this.actionError.set(
        'Motorista em serviço não pode ser excluído. Encerre o aluguel primeiro.',
      );
      return;
    }
    this.deleteOpen.set(true);
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }

  protected confirmDelete(): void {
    const d = this.driver();
    if (!d) return;
    this.actionError.set(null);
    this.deleting.set(true);
    this.driverService.remove(d.id).subscribe({
      next: () => this.router.navigate(['/motoristas']),
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.actionError.set(this.extractError(err, 'Não foi possível excluir.'));
      },
    });
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    if (iso.length === 10) return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected formatDoc(type: string | null, value: string | null): string {
    if (!type || !value) return '—';
    if (type === 'CPF' && value.length === 11) {
      return `${value.slice(0,3)}.${value.slice(3,6)}.${value.slice(6,9)}-${value.slice(9)}`;
    }
    if (type === 'CNPJ' && value.length === 14) {
      return `${value.slice(0,2)}.${value.slice(2,5)}.${value.slice(5,8)}/${value.slice(8,12)}-${value.slice(12)}`;
    }
    return value;
  }

  protected formatPhone(phone: string | null | undefined): string {
    const d = (phone ?? '').replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return phone ?? '—';
  }

  protected formatCep(cep: string): string {
    const d = (cep ?? '').replace(/\D/g, '');
    return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5)}` : cep;
  }

  protected fullAddress(): string {
    const a = this.driver()?.address;
    if (!a) return '—';
    const parts = [
      a.street,
      a.number ? `, ${a.number}` : '',
      a.complement ? ` — ${a.complement}` : '',
    ].join('');
    return `${parts} · ${a.district} · ${a.city}/${a.uf} · CEP ${this.formatCep(a.cep)}`;
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
