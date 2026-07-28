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
import { VehiclesService } from '../../services/vehicles.service';
import {
  FinancingListItem,
  FinancingStatus,
  VehicleListItem,
} from '../../types/vehicle.types';
import { FINANCING_STATUS_FILTER_OPTIONS } from '../../utils/status-maps';

const STATUS_OPTIONS = FINANCING_STATUS_FILTER_OPTIONS;

const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Cadastro (recente)' },
  { value: 'created_asc', label: 'Cadastro (antigo)' },
  { value: 'contract_date_desc', label: 'Contrato (recente)' },
  { value: 'contract_date_asc', label: 'Contrato (antigo)' },
] as const;

/**
 * Ações do menu da linha. São as duas únicas operações do backend que atuam
 * sobre o financiamento inteiro (`PATCH .../paid-off` e `DELETE ...`); marcar /
 * desmarcar parcela é por parcela e continua só no detalhe.
 */
type PendingAction = 'payOff' | 'delete';

@Component({
  selector: 'app-financings-list',
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
  templateUrl: './financings-list.html',
})
export class FinancingsList implements OnInit {
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
  protected readonly sortOptions = SORT_OPTIONS;

  protected readonly items = this.vehiclesService.financings;
  protected readonly loading = this.vehiclesService.financingsLoading;
  protected readonly error = this.vehiclesService.financingsError;
  protected readonly page = this.vehiclesService.financingsPage;
  protected readonly size = this.vehiclesService.financingsSize;
  protected readonly total = this.vehiclesService.financingsTotal;

  protected readonly vehicles = signal<VehicleListItem[]>([]);

  protected readonly vehicleFilter = signal<string>('');
  protected readonly statusFilter = signal<FinancingStatus | ''>('');
  protected readonly sort = signal<string>('created_desc');
  protected readonly pageSize = signal(20);

  /** Ação de linha aguardando confirmação no diálogo. */
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly pendingFinancing = signal<FinancingListItem | null>(null);
  protected readonly actionBusy = signal(false);
  /** Falha de uma ação de linha. Banner logo acima da lista. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly dialogOpen = computed(() => this.pendingAction() !== null);

  protected readonly dialogTitle = computed(() =>
    this.pendingAction() === 'payOff' ? 'Quitar financiamento' : 'Excluir financiamento',
  );

  protected readonly dialogMessage = computed(() =>
    this.pendingAction() === 'payOff'
      ? 'Marcar este financiamento como quitado? O contrato deixa de contar como em aberto na frota.'
      : 'Tem certeza que deseja excluir este financiamento? O cronograma de parcelas será removido junto e esta ação não pode ser desfeita.',
  );

  protected readonly dialogConfirmLabel = computed(() =>
    this.pendingAction() === 'payOff' ? 'Quitar' : 'Excluir',
  );

  protected readonly dialogVariant = computed<'info' | 'warning' | 'danger'>(() =>
    this.pendingAction() === 'payOff' ? 'warning' : 'danger',
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

  protected clearFilters(): void {
    this.vehicleFilter.set(this.vehicleIdPrefilter() ?? '');
    this.statusFilter.set('');
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
    this.vehiclesService
      .listFleetFinancings({
        vehicleId: this.vehicleFilter() || undefined,
        status: this.statusFilter() || undefined,
        sort: this.sort(),
        page,
        size: this.pageSize(),
      })
      // `VehiclesService` already writes the failure into its `financingsError` signal,
      // rendered as a banner — claim it so the safety net doesn't toast it too.
      .subscribe({ error: (err: unknown) => this.apiErrors.claim(err) });
  }

  protected statusInfo(s: FinancingStatus): { label: string; chip: string } {
    const o = STATUS_OPTIONS.find((x) => x.value === s);
    return o ? { label: o.label, chip: o.chip } : { label: s, chip: 'bg-neutral-100' };
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

  protected openDetail(f: FinancingListItem): void {
    // Route to the financing detail page itself (not the vehicle).
    this.router.navigate(['/financiamentos', f.id]);
  }

  /** Contrato já quitado não pode ser quitado de novo. */
  protected canPayOff(f: FinancingListItem): boolean {
    return f.status !== 'PAID_OFF';
  }

  protected askAction(action: PendingAction, f: FinancingListItem, event?: Event): void {
    event?.stopPropagation();
    this.pendingAction.set(action);
    this.pendingFinancing.set(f);
  }

  protected cancelAction(): void {
    if (this.actionBusy()) return;
    this.pendingAction.set(null);
    this.pendingFinancing.set(null);
  }

  protected confirmAction(): void {
    const action = this.pendingAction();
    const f = this.pendingFinancing();
    if (!action || !f || this.actionBusy()) return;
    this.actionBusy.set(true);
    this.actionError.set(null);

    // Nunca remove otimisticamente: só recarrega depois do 2xx do servidor.
    const onSuccess = (message: string): void => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingFinancing.set(null);
      this.notifications.success(message);
      this.reload(this.page());
    };

    // Erros de negócio (409/404) vão pro banner inline: o diálogo fecha e não há
    // campo pra ancorar a mensagem.
    const onError = (fallback: string) => (err: unknown) => {
      this.actionBusy.set(false);
      this.pendingAction.set(null);
      this.pendingFinancing.set(null);
      this.actionError.set(this.apiErrors.messageFor(err, fallback));
    };

    if (action === 'payOff') {
      this.vehiclesService.markPaidOff(f.vehicleId, f.id).subscribe({
        next: () => onSuccess('Financiamento quitado.'),
        error: onError('Não foi possível quitar o financiamento.'),
      });
      return;
    }

    this.vehiclesService.deleteFinancing(f.vehicleId, f.id).subscribe({
      next: () => onSuccess('Financiamento excluído.'),
      error: onError('Não foi possível excluir o financiamento.'),
    });
  }

  /**
   * Badge derivado do agregado `overdueInstallments` do backend, que consulta
   * `financing_installments` (V24). Substituiu a projeção mensal do client.
   */
  protected progressBadge(f: FinancingListItem): { label: string; chip: string } {
    if (f.status === 'PAID_OFF') {
      return { label: 'Quitado', chip: 'bg-emerald-100 text-emerald-800' };
    }
    if ((f.overdueInstallments ?? 0) > 0) {
      return { label: 'Atrasado', chip: 'bg-rose-100 text-rose-700' };
    }
    return { label: 'Em dia', chip: 'bg-blue-100 text-blue-700' };
  }
}
