import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { InsurancesService } from '../../services/insurances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { VehicleListItem } from '../../types/vehicle.types';
import {
  InsuranceCoverage,
  InsuranceListItem,
  InsuranceStatus,
} from '../../types/insurance.types';
import {
  INSURANCE_COVERAGE_LABELS,
  INSURANCE_STATUS_FILTER_OPTIONS,
} from '../../utils/status-maps';
import { todayIso } from '../../components/vehicles/insurance-form-fields/insurance-utils';

const STATUS_OPTIONS = INSURANCE_STATUS_FILTER_OPTIONS;

/**
 * Janelas de vencimento. `expiringInDays` já implica ACTIVE no backend e é
 * mutuamente exclusivo com `status` — a UI zera um ao usar o outro.
 */
const EXPIRING_OPTIONS = [
  { value: '', label: 'Vencimento: Todos' },
  { value: '30', label: 'Vence em 30 dias' },
  { value: '15', label: 'Vence em 15 dias' },
  { value: '7', label: 'Vence em 7 dias' },
] as const;

const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Cadastro (recente)' },
  { value: 'created_asc', label: 'Cadastro (antigo)' },
  { value: 'end_date_asc', label: 'Vencimento (mais próximo)' },
  { value: 'end_date_desc', label: 'Vencimento (mais distante)' },
] as const;

/** Ações do menu da linha que atuam sobre a apólice inteira. */
type PendingAction = 'cancel' | 'delete';

@Component({
  selector: 'app-insurances-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    ActionsMenu,
    AlertBanner,
  ],
  templateUrl: './insurances-list.html',
})
export class InsurancesList implements OnInit {
  private readonly insurancesService = inject(InsurancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  /**
   * When provided, scopes the listing to a single vehicle and hides the vehicle dropdown.
   * Used by the vehicle Gerência drill-down pages.
   */
  readonly vehicleIdPrefilter = input<string | undefined>(undefined);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly expiringOptions = EXPIRING_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;

  protected readonly items = this.insurancesService.insurances;
  protected readonly loading = this.insurancesService.loading;
  protected readonly error = this.insurancesService.error;
  protected readonly page = this.insurancesService.page;
  protected readonly size = this.insurancesService.size;
  protected readonly total = this.insurancesService.total;

  protected readonly vehicles = signal<VehicleListItem[]>([]);

  protected readonly vehicleFilter = signal<string>('');
  protected readonly statusFilter = signal<InsuranceStatus | ''>('');
  protected readonly expiringFilter = signal<string>('');
  protected readonly sort = signal<string>('created_desc');
  protected readonly pageSize = signal(20);

  /** Ação de linha aguardando confirmação no diálogo. */
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly pendingInsurance = signal<InsuranceListItem | null>(null);
  protected readonly actionBusy = signal(false);
  /** Falha de uma ação de linha. Banner logo acima da lista. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly dialogOpen = computed(() => this.pendingAction() !== null);

  protected readonly dialogTitle = computed(() =>
    this.pendingAction() === 'cancel' ? 'Cancelar apólice' : 'Excluir apólice',
  );

  protected readonly dialogMessage = computed(() =>
    this.pendingAction() === 'cancel'
      ? 'Cancelar esta apólice com a data de hoje? Ela deixa de contar como cobertura ativa do veículo.'
      : 'Tem certeza que deseja excluir esta apólice? Esta ação não pode ser desfeita.',
  );

  protected readonly dialogConfirmLabel = computed(() =>
    this.pendingAction() === 'cancel' ? 'Cancelar apólice' : 'Excluir',
  );

  protected readonly dialogVariant = computed<'info' | 'warning' | 'danger'>(() =>
    this.pendingAction() === 'cancel' ? 'warning' : 'danger',
  );

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size();
    return t === 0 ? 1 : Math.ceil(t / s);
  });

  protected readonly pageNumber = computed(() => this.page() + 1);

  ngOnInit(): void {
    const prefilter = this.vehicleIdPrefilter();
    if (prefilter) {
      this.vehicleFilter.set(prefilter);
    }
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
    this.reload(0);
  }

  protected onFilterChange(): void {
    this.reload(0);
  }

  /** Escolher uma janela de vencimento zera o status (filtros exclusivos). */
  protected onExpiringChange(value: string): void {
    this.expiringFilter.set(value);
    if (value) this.statusFilter.set('');
    this.reload(0);
  }

  /** Escolher um status zera a janela de vencimento (filtros exclusivos). */
  protected onStatusChange(value: InsuranceStatus | ''): void {
    this.statusFilter.set(value);
    if (value) this.expiringFilter.set('');
    this.reload(0);
  }

  protected clearFilters(): void {
    this.vehicleFilter.set(this.vehicleIdPrefilter() ?? '');
    this.statusFilter.set('');
    this.expiringFilter.set('');
    this.sort.set('created_desc');
    this.reload(0);
  }

  protected prev(): void {
    if (this.page() > 0) this.reload(this.page() - 1);
  }
  protected next(): void {
    if (this.page() + 1 < this.totalPages()) this.reload(this.page() + 1);
  }

  private reload(page: number): void {
    const expiring = this.expiringFilter();
    this.insurancesService
      .list({
        vehicleId: this.vehicleFilter() || undefined,
        status: expiring ? undefined : this.statusFilter() || undefined,
        expiringInDays: expiring ? Number(expiring) : null,
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      // `InsurancesService` já escreve a falha no signal `error`, renderizado como
      // banner — reivindica o erro para a rede de segurança não exibir um toast.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  protected statusInfo(s: InsuranceStatus): { label: string; chip: string } {
    const o = STATUS_OPTIONS.find((x) => x.value === s);
    return o ? { label: o.label, chip: o.chip } : { label: s, chip: 'bg-neutral-100' };
  }

  protected coverageLabel(c: InsuranceCoverage): string {
    return INSURANCE_COVERAGE_LABELS[c] ?? c;
  }

  /**
   * Badge de vencimento derivado de `daysToExpiry` (calculado no backend).
   * ≤ 7 dias → danger; ≤ 30 dias → warning; vencida/cancelada → neutro.
   */
  protected expiryBadge(i: InsuranceListItem): { label: string; chip: string } {
    if (i.status === 'CANCELLED') {
      return { label: 'Cancelada', chip: 'bg-neutral-200 text-neutral-700' };
    }
    const days = i.daysToExpiry;
    if (i.status === 'EXPIRED' || (days != null && days < 0)) {
      return { label: 'Vencida', chip: 'bg-rose-100 text-rose-700' };
    }
    if (days == null) {
      return this.statusInfo(i.status);
    }
    if (days <= 7) {
      return { label: `Vence em ${days}d`, chip: 'bg-rose-100 text-rose-700' };
    }
    if (days <= 30) {
      return { label: `Vence em ${days}d`, chip: 'bg-amber-100 text-amber-800' };
    }
    return this.statusInfo(i.status);
  }

  /** Linha destacada quando a apólice ativa vence em ≤ 7 dias. */
  protected rowHighlight(i: InsuranceListItem): string {
    const days = i.daysToExpiry;
    if (i.status !== 'ACTIVE' || days == null) return '';
    if (days <= 7) return 'bg-rose-50/60';
    if (days <= 30) return 'bg-amber-50/50';
    return '';
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

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(cents / 100);
  }

  protected openDetail(i: InsuranceListItem): void {
    this.router.navigate(['/seguros', i.id]);
  }

  /** Apólice CANCELLED ou EXPIRED não pode ser editada nem cancelada. */
  protected canModify(i: InsuranceListItem): boolean {
    return i.status !== 'CANCELLED' && i.status !== 'EXPIRED';
  }

  protected askAction(action: PendingAction, i: InsuranceListItem, event?: Event): void {
    event?.stopPropagation();
    this.pendingAction.set(action);
    this.pendingInsurance.set(i);
  }

  protected cancelAction(): void {
    if (this.actionBusy()) return;
    this.pendingAction.set(null);
    this.pendingInsurance.set(null);
  }

  protected confirmAction(): void {
    const action = this.pendingAction();
    const i = this.pendingInsurance();
    if (!action || !i || this.actionBusy()) return;
    this.actionBusy.set(true);
    this.actionError.set(null);

    // Nunca remove otimisticamente: só recarrega depois do 2xx do servidor.
    const onSuccess = (message: string): void => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingInsurance.set(null);
      this.notifications.success(message);
      this.reload(this.page());
    };

    // Erros de negócio (409/404) vão pro banner inline: o diálogo fecha e não há
    // campo pra ancorar a mensagem.
    const onError = (fallback: string) => (err: unknown) => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingInsurance.set(null);
      this.actionError.set(this.apiErrors.messageFor(err, fallback));
    };

    if (action === 'cancel') {
      // `cancelledDate` precisa estar em [startDate, hoje]; hoje é sempre válido
      // para uma apólice já iniciada.
      this.insurancesService
        .cancel(i.vehicleId, i.id, { cancelledDate: todayIso() })
        .subscribe({
          next: () => onSuccess('Apólice cancelada.'),
          error: onError('Não foi possível cancelar a apólice.'),
        });
      return;
    }

    this.insurancesService.remove(i.vehicleId, i.id).subscribe({
      next: () => onSuccess('Apólice excluída.'),
      error: onError('Não foi possível excluir a apólice.'),
    });
  }
}
