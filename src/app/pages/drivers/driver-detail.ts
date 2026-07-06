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

const STATUS_LABEL: Record<DriverStatus, { label: string; chip: string }> = {
  AVAILABLE: { label: 'Disponível', chip: 'bg-emerald-100 text-emerald-800' },
  WORKING:   { label: 'Em serviço', chip: 'bg-blue-100 text-blue-700' },
  SUSPENDED: { label: 'Suspenso',   chip: 'bg-red-100 text-red-700' },
};

@Component({
  selector: 'app-driver-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, ConfirmDialog, DetailActions],
  templateUrl: './driver-detail.html',
})
export class DriverDetail implements OnInit {
  private readonly driverService = inject(DriverService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly driver = signal<DriverResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);

  protected readonly statusInfo = computed(() => {
    const s = this.driver()?.status;
    return s ? STATUS_LABEL[s] : { label: '—', chip: 'bg-neutral-100 text-neutral-700' };
  });

  protected readonly expiringSoon = computed(() => {
    const iso = this.driver()?.licenseExpiry;
    if (!iso) return false;
    const days = (new Date(iso + 'T00:00:00').getTime() - Date.now()) / 86400000;
    return days < 30;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
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

  protected askDelete(): void {
    this.deleteOpen.set(true);
  }

  protected cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
  }

  protected confirmDelete(): void {
    const d = this.driver();
    if (!d) return;
    this.deleting.set(true);
    this.driverService.remove(d.id).subscribe({
      next: () => this.router.navigate(['/motoristas']),
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
