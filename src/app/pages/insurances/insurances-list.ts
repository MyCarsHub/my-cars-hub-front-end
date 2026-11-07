import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { BottomSheet } from '../../components/core/bottom-sheet/bottom-sheet';
import { PillTabOption, PillTabs } from '../../components/core/pill-tabs/pill-tabs';
import { StatusChip, StatusChipTone } from '../../components/core/status-chip/status-chip';
import { KpiCard } from '../../components/kpi-card/kpi-card';
import { KpiGlyph } from '../../components/kpi-card/kpi-glyph';
import { VehiclePicker } from '../../components/vehicles/vehicle-picker/vehicle-picker';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { InsurancesService } from '../../services/insurances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { FleetFinanceService } from '../../services/fleet-finance.service';
import {
  InsurancesSummary,
  OPEN_BLOCK_PARAM,
  VehiclePickerFilter,
} from '../../types/fleet-finance.types';
import { VehicleListItem } from '../../types/vehicle.types';
import { PagedResponse } from '../../types/paged.types';
import { InsuranceCoverage, InsuranceListItem, InsuranceStatus } from '../../types/insurance.types';
import {
  INSURANCE_COVERAGE_LABELS,
  INSURANCE_STATUS_FILTER_OPTIONS,
} from '../../utils/status-maps';
import { todayIso } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { formatPlate } from '../../utils/display-format';
import { VehicleLabelPipe } from '../../pipes/vehicle-label.pipe';

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

/** Janela do KPI "Vencem em breve" e do chip âmbar: a mesma da opção mais larga do filtro. */
export const EXPIRING_SOON_DAYS = 30;
/** Abaixo disto o vencimento é urgente: chip vermelho e linha tingida de vermelho. */
export const EXPIRING_URGENT_DAYS = 7;

/** Tom do chip por status, nas mesmas cores dos chips de antes. */
const STATUS_TONE: Record<InsuranceStatus, StatusChipTone> = {
  ACTIVE: 'green',
  EXPIRED: 'red',
  CANCELLED: 'neutral',
  SUSPENDED: 'amber',
};

/** Ações do menu da linha que atuam sobre a apólice inteira. */
type PendingAction = 'cancel' | 'delete';

@Component({
  selector: 'app-insurances-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VehicleLabelPipe,
    FormsModule,
    RouterLink,
    DefaultPageLayout,
    BottomSheet,
    ConfirmDialog,
    ActionsMenu,
    AlertBanner,
    KpiCard,
    KpiGlyph,
    PillTabs,
    StatusChip,
    VehiclePicker,
  ],
  templateUrl: './insurances-list.html',
})
export class InsurancesList implements OnInit {
  private readonly insurancesService = inject(InsurancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly fleetFinance = inject(FleetFinanceService);

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

  // ---- topo (KPIs) e "Adicionar seguro" -------------------------------------

  protected readonly expiringSoonDays = EXPIRING_SOON_DAYS;
  protected readonly summary = signal<InsurancesSummary | null>(null);
  protected readonly summaryLoading = signal(true);
  protected readonly summaryError = signal<string | null>(null);
  protected readonly kpiLoading = computed(() => this.summaryLoading() && !this.summary());

  protected readonly cancelledCaption = computed(() => {
    const n = this.summary()?.cancelledCount ?? 0;
    return n === 1 ? '1 cancelada' : `${n} canceladas`;
  });

  protected readonly pickerOpen = signal(false);
  protected readonly pickerFilter: VehiclePickerFilter = { kind: 'withoutActiveInsurance' };

  /** Troca a cada filtro: a lista é refeita e a cascata de entrada recomeça. */
  private readonly epoch = signal(0);
  protected readonly epochs = computed(() => [{ id: this.epoch() }]);

  protected readonly statusTabs = computed<readonly PillTabOption<InsuranceStatus | ''>[]>(() =>
    STATUS_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      shortLabel: o.value === 'SUSPENDED' ? 'Susp.' : o.value === 'CANCELLED' ? 'Canc.' : undefined,
      testId: `status-${o.value || 'ALL'}`,
    })),
  );

  protected readonly anyFilter = computed(
    () =>
      this.vehicleFilter() !== (this.vehicleIdPrefilter() ?? '') ||
      this.statusFilter() !== '' ||
      this.expiringFilter() !== '' ||
      this.sort() !== 'created_desc',
  );

  /**
   * Lista com algo (ou filtrada): mostra filtros e o "Adicionar" do cabeçalho, como em Cupons.
   * O total conta também a página que ficou vazia depois de excluir a última linha dela.
   */
  protected readonly hasRows = computed(
    () => this.items().length > 0 || this.total() > 0 || this.anyFilter(),
  );

  protected readonly resultsText = computed(() => {
    const n = this.total();
    return n === 0 ? 'Nenhum resultado' : n === 1 ? '1 apólice' : `${n} apólices`;
  });

  /**
   * O prefiltro de veículo é reativo: navegar da gerência de um veículo para a
   * de outro reusa esta instância (mesma configuração de rota), e ler o input
   * só no `ngOnInit` deixava a lista presa no primeiro veículo. `untracked`
   * isola a leitura dos demais filtros para o efeito não virar um watcher de
   * `reload()` e duplicar requisições a cada troca de filtro.
   */
  constructor() {
    effect(() => {
      const prefilter = this.vehicleIdPrefilter();
      untracked(() => {
        this.vehicleFilter.set(prefilter ?? '');
        this.reload(0);
      });
    });
  }

  ngOnInit(): void {
    if (!this.vehicleIdPrefilter()) this.loadSummary();
    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });
  }

  protected onFilterChange(): void {
    this.epoch.update((n) => n + 1);
    this.reload(0);
  }

  protected loadSummary(): void {
    this.summaryLoading.set(true);
    this.summaryError.set(null);
    this.fleetFinance.insurancesSummary(EXPIRING_SOON_DAYS).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.summaryLoading.set(false);
      },
      error: (err: unknown) => {
        this.summaryLoading.set(false);
        this.summaryError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar o resumo dos seguros.'),
        );
      },
    });
  }

  protected openPicker(): void {
    this.pickerOpen.set(true);
  }

  /** O cadastro da apólice continua no formulário do veículo, com o bloco já aberto. */
  protected onPicked(vehicle: VehicleListItem): void {
    this.pickerOpen.set(false);
    void this.router.navigate(['/veiculos', vehicle.id, 'editar'], {
      queryParams: { [OPEN_BLOCK_PARAM]: 'seguro' },
    });
  }

  /** Cliques no kebab e nos itens dele têm dono próprio e não abrem o detalhe. */
  protected onRowClick(event: Event, i: InsuranceListItem): void {
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, [role="menuitem"]')) return;
    this.openDetail(i);
  }

  /** Enter e Espaço na própria linha; nas teclas dos controles de dentro, nada. */
  protected onRowKey(event: KeyboardEvent, i: InsuranceListItem): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openDetail(i);
  }

  protected chipTone(s: InsuranceStatus): StatusChipTone {
    return STATUS_TONE[s] ?? 'neutral';
  }

  /**
   * Tom do chip de vencimento: vermelho até `EXPIRING_URGENT_DAYS` (e vencida), âmbar até
   * `EXPIRING_SOON_DAYS`, senão o do status.
   */
  protected expiryTone(i: InsuranceListItem): StatusChipTone {
    const days = i.daysToExpiry;
    if (i.status !== 'ACTIVE' || days == null || days > EXPIRING_SOON_DAYS) {
      return this.chipTone(i.status);
    }
    return days <= EXPIRING_URGENT_DAYS ? 'red' : 'amber';
  }

  /** Escolher uma janela de vencimento zera o status (filtros exclusivos). */
  protected onExpiringChange(value: string): void {
    this.epoch.update((n) => n + 1);
    this.expiringFilter.set(value);
    if (value) this.statusFilter.set('');
    this.reload(0);
  }

  /** Escolher um status zera a janela de vencimento (filtros exclusivos). */
  protected onStatusChange(value: InsuranceStatus | ''): void {
    this.epoch.update((n) => n + 1);
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
    // Banner de falha de ação não sobrevive a uma nova carga da lista.
    this.actionError.set(null);
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
      .subscribe({
        next: (res) => this.clampPage(res, page),
        error: (err: unknown) => this.apiErrors.claim(err),
      });
  }

  /**
   * Excluir a última linha da última página deixava o usuário numa página que
   * não existe mais: lista vazia e paginador escondido, sem como voltar. Quando
   * a página pedida volta vazia mas ainda há registros, recarrega a última
   * página válida. Só recua (`last < requested`), então não há laço.
   */
  private clampPage(res: PagedResponse<InsuranceListItem>, requested: number): void {
    const total = res.total ?? 0;
    if (total === 0 || (res.content?.length ?? 0) > 0) return;
    const size = res.size || this.pageSize();
    const last = Math.max(0, Math.ceil(total / size) - 1);
    if (last < requested) this.reload(last);
  }

  protected statusInfo(s: InsuranceStatus): { label: string; chip: string } {
    const o = STATUS_OPTIONS.find((x) => x.value === s);
    return o ? { label: o.label, chip: o.chip } : { label: s, chip: 'bg-surface-sunken' };
  }

  protected coverageLabel(c: InsuranceCoverage): string {
    return INSURANCE_COVERAGE_LABELS[c] ?? c;
  }

  /**
   * Badge de vencimento derivado de `daysToExpiry` (calculado no backend).
   *
   * Contagem regressiva só faz sentido para apólice ACTIVE — a mesma regra do
   * detalhe (`insurance-detail.ts`). SUSPENDED/EXPIRED/CANCELLED caem no chip do
   * próprio status; antes SUSPENDED escapava e aparecia como "Vence em Xd" âmbar,
   * indistinguível de uma apólice em vigor.
   */
  protected expiryBadge(i: InsuranceListItem): { label: string; chip: string } {
    if (i.status !== 'ACTIVE') {
      return this.statusInfo(i.status);
    }
    const days = i.daysToExpiry;
    if (days == null) {
      return this.statusInfo(i.status);
    }
    if (days < 0) {
      return { label: 'Vencida', chip: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300' };
    }
    if (days <= EXPIRING_URGENT_DAYS) {
      return { label: `Vence em ${days}d`, chip: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300' };
    }
    if (days <= EXPIRING_SOON_DAYS) {
      return { label: `Vence em ${days}d`, chip: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200' };
    }
    return this.statusInfo(i.status);
  }

  protected formatPlate(plate: string): string {
    return formatPlate(plate);
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
      if (!this.vehicleIdPrefilter()) this.loadSummary();
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
      this.insurancesService.cancel(i.vehicleId, i.id, { cancelledDate: todayIso() }).subscribe({
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
