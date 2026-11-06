import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

import { BackLink } from '../../../components/core/back-link/back-link';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../../components/filter-chip-group/filter-chip-group';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCompaniesService } from '../admin-companies.service';
import { ContactActions } from '../contact/contact-actions';
import { AdminCompaniesTabs } from './admin-companies-tabs';
import {
  AdminCompanyListItem,
  AdminCompanyStatus,
} from '../../../types/admin-company.types';
import { subscriptionChip } from './subscription-status-chip';

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED';
type PlanFilter = 'ALL' | 'TRIAL_MONTHLY' | 'PRO_MONTHLY';

interface PendingAction {
  kind: 'SUSPEND' | 'REACTIVATE';
  company: AdminCompanyListItem;
}

interface ChipStyle {
  label: string;
  chip: string;
}

const COMPANY_STATUS_CHIPS: Record<AdminCompanyStatus, ChipStyle> = {
  ACTIVE: { label: 'Ativa', chip: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  SUSPENDED: { label: 'Suspensa', chip: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300' },
  CANCELLED: { label: 'Cancelada', chip: 'bg-surface-strong text-fg-soft' },
};

const PAGE_SIZE = 20;

/**
 * Colunas da lista (kit `app-data-list`). Valor gerenciado e MRR vêm do backend em
 * centavos; valor ausente (backend antigo) vira "—" — o 0 só aparece quando o servidor o manda.
 */
const COLUMNS: readonly DataListColumn<AdminCompanyListItem>[] = [
  { key: 'name', header: 'Empresa', primary: true, value: (c) => c.name },
  { key: 'plan', header: 'Plano', value: (c) => c.planName },
  { key: 'status', header: 'Situação', value: (c) => COMPANY_STATUS_CHIPS[c.status]?.label ?? c.status },
  { key: 'owner', header: 'Dono', value: (c) => c.ownerName, noExport: true },
  { key: 'managed', header: 'Gerenciado', kind: 'money-cents', end: true, value: (c) => c.managedMonthCents },
  { key: 'mrr', header: 'MRR', kind: 'money-cents', end: true, value: (c) => c.mrrCents },
];

/**
 * Opcoes dos dois filtros. Ficam FORA do template porque `FilterChipGroup.options`
 * e um `input` — um literal inline no template viraria um array novo a cada
 * deteccao de mudanca e derrubaria o `OnPush` do grupo a toa.
 */
const STATUS_OPTIONS: readonly FilterChipOption<StatusFilter>[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'SUSPENDED', label: 'Suspensas' },
];

const PLAN_OPTIONS: readonly FilterChipOption<PlanFilter>[] = [
  { value: 'ALL', label: 'Todos planos' },
  { value: 'TRIAL_MONTHLY', label: 'Trial' },
  { value: 'PRO_MONTHLY', label: 'Pro (mensal)' },
];

@Component({
  selector: 'app-admin-companies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminCompaniesTabs,
    ContactActions,
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    DataList,
    DataListCell,
    DataListActions,
    StatusChip,
    FilterChipGroup,
    RouterLink,
  ],
  templateUrl: './admin-companies.html',
})
export class AdminCompanies implements OnInit, OnDestroy {
  private readonly companiesService = inject(AdminCompaniesService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroy$ = new Subject<void>();

  protected readonly companies = this.companiesService.companies;
  protected readonly loading = this.companiesService.loading;
  /** Falha ao CARREGAR a lista — banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha de uma OPERACAO da tela (suspender/reativar). Banner inline: o
   * interceptor nao toasta 4xx e `messageFor()` reivindica o erro.
   */
  protected readonly actionError = signal<string | null>(null);
  protected readonly total = this.companiesService.total;

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly search = signal<string>('');
  protected readonly columns = COLUMNS;
  private readonly router = inject(Router);

  /** A linha inteira abre o detalhe (alvo de mouse e toque); o teclado usa o link do nome. */
  protected openCompany(company: AdminCompanyListItem): void {
    void this.router.navigate(['/admin/companies', company.id]);
  }

  protected readonly rowId = (company: AdminCompanyListItem): string => company.id;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly planOptions = PLAN_OPTIONS;

  protected readonly statusFilter = signal<StatusFilter>('ALL');
  protected readonly planFilter = signal<PlanFilter>('ALL');
  protected readonly currentPage = signal(0);

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly rowPending = signal<Record<string, boolean>>({});

  protected readonly totalPages = computed(() => {
    const t = this.total();
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / PAGE_SIZE));
  });

  protected readonly canPrev = computed(() => this.currentPage() > 0);
  protected readonly canNext = computed(() => this.currentPage() + 1 < this.totalPages());

  protected readonly confirmVariant = computed<'info' | 'warning' | 'danger'>(() => {
    const a = this.pendingAction();
    if (!a) return 'info';
    return a.kind === 'SUSPEND' ? 'danger' : 'warning';
  });

  protected readonly confirmTitle = computed(() => {
    const a = this.pendingAction();
    if (!a) return '';
    return a.kind === 'SUSPEND' ? 'Suspender empresa' : 'Reativar empresa';
  });

  protected readonly confirmMessage = computed(() => {
    const a = this.pendingAction();
    if (!a) return '';
    const label = a.company.name;
    return a.kind === 'SUSPEND'
      ? `«${label}» perderá acesso imediatamente à plataforma. Continuar?`
      : `«${label}» voltará a ter acesso normal à plataforma.`;
  });

  protected readonly confirmLabel = computed(() => {
    const a = this.pendingAction();
    if (!a) return 'Confirmar';
    return a.kind === 'SUSPEND' ? 'Suspender' : 'Reativar';
  });

  constructor() {
    effect(() => {
      const search = this.search();
      const status = this.statusFilter();
      const plan = this.planFilter();
      const page = this.currentPage();
      this.error.set(null);
      this.companiesService
        .load({
          search,
          status,
          planCode: plan === 'ALL' ? null : plan,
          page,
          size: PAGE_SIZE,
        })
        .subscribe({
          error: (err: HttpErrorResponse) =>
            this.error.set(
              this.apiErrors.messageFor(
                err,
                'Não foi possível carregar as empresas. Tente novamente.',
              ),
            ),
        });
    });
  }

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.currentPage.set(0);
        this.search.set(value ?? '');
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  protected setStatusFilter(value: StatusFilter): void {
    this.currentPage.set(0);
    this.statusFilter.set(value);
  }

  protected setPlanFilter(value: PlanFilter): void {
    this.currentPage.set(0);
    this.planFilter.set(value);
  }

  protected prevPage(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
  }

  protected requestToggleStatus(company: AdminCompanyListItem): void {
    if (company.active) {
      this.pendingAction.set({ kind: 'SUSPEND', company });
    } else {
      // reactivate is safe — apply direct
      this.applyStatus(company, true);
    }
  }

  protected cancelPending(): void {
    this.pendingAction.set(null);
  }

  protected confirmPending(): void {
    const a = this.pendingAction();
    if (!a) return;
    this.applyStatus(a.company, a.kind !== 'SUSPEND');
    this.pendingAction.set(null);
  }

  protected isPending(id: string): boolean {
    return !!this.rowPending()[id];
  }

  protected companyChip(status: AdminCompanyStatus): ChipStyle {
    return COMPANY_STATUS_CHIPS[status] ?? { label: status, chip: 'bg-surface-sunken text-fg-soft' };
  }

  protected subChip(company: AdminCompanyListItem): ChipStyle | null {
    return subscriptionChip(company.subscriptionStatus, company.trialEndsAt);
  }

  /** "Campinas, SP" / "Campinas" / "SP" / "—" — cadastro parcial é estado normal. */
  protected place(company: AdminCompanyListItem): string {
    const parts = [company.city, company.uf].map((p) => (p ?? '').trim()).filter((p) => p !== '');
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  /**
   * FEAT-0141 — liga/desliga a marca de empresa INTERNA (backend: FEAT-0138).
   *
   * Sem dialogo de confirmacao de proposito: a acao e reversivel no mesmo menu
   * e nao tira a empresa de lugar nenhum — ela SO sai da conta das metricas,
   * e continua na listagem.
   */
  protected toggleInternal(company: AdminCompanyListItem): void {
    const target = !company.internal;
    this.actionError.set(null);
    this.setRowPending(company.id, true);
    this.companiesService.updateInternal(company.id, target).subscribe({
      next: () => {
        this.setRowPending(company.id, false);
        this.notify.success(
          target
            ? 'Empresa marcada como interna. Fica fora das métricas.'
            : 'Marca de interna desfeita. Empresa volta a contar nas métricas.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(company.id, false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar a marca de empresa interna.'),
        );
      },
    });
  }

  private setRowPending(id: string, value: boolean): void {
    this.rowPending.update((state) => ({ ...state, [id]: value }));
  }

  private applyStatus(company: AdminCompanyListItem, active: boolean): void {
    this.actionError.set(null);
    this.setRowPending(company.id, true);
    this.companiesService.updateStatus(company.id, active).subscribe({
      next: () => {
        this.setRowPending(company.id, false);
        this.notify.success(active ? 'Empresa reativada.' : 'Empresa suspensa.');
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(company.id, false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status da empresa.'),
        );
      },
    });
  }
}
