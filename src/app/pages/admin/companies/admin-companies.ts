import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import { BackLink } from '../../../components/core/back-link/back-link';
import type { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
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
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListFilterSelect, ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCompaniesService } from '../admin-companies.service';
import { ContactActions } from '../contact/contact-actions';
import { AdminCompaniesTabs } from './admin-companies-tabs';
import {
  AdminCompanyListItem,
  AdminCompanyStatus,
} from '../../../types/admin-company.types';
import { subscriptionChip, type SubscriptionChip } from './subscription-status-chip';
import { PersonNamePipe } from '../../../pipes/person-name.pipe';

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED';
type PlanFilter = 'ALL' | 'TRIAL_MONTHLY' | 'PRO_MONTHLY';

interface PendingAction {
  kind: 'SUSPEND' | 'REACTIVATE';
  company: AdminCompanyListItem;
}

interface ChipStyle {
  label: string;
  tone: StatusChipTone;
}

/** Situação da empresa: cor só no chip (verde ativa, vermelho suspensa, neutro cancelada). */
const COMPANY_STATUS_CHIPS: Record<AdminCompanyStatus, ChipStyle> = {
  ACTIVE: { label: 'Ativa', tone: 'green' },
  SUSPENDED: { label: 'Suspensa', tone: 'red' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

const PAGE_SIZE = 20;

/**
 * Colunas da lista (kit `app-data-list`). Valor gerenciado e MRR vêm do backend em
 * centavos e saem com centavos ("R$ 1.234,56"); valor ausente (backend antigo) vira "—" —
 * o 0 só aparece quando o servidor o manda.
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
 * Situação = UMA fileira de pílulas (`app-list-toolbar`); plano = select "Plano: X" na linha da
 * busca, como Membros (padrão de lista, 18/11/2026). Ficam fora do template porque `options` é
 * `input` de componente OnPush: um literal inline viraria um array novo a cada ciclo.
 */
const STATUS_OPTIONS: readonly FilterChipOption<StatusFilter>[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'SUSPENDED', label: 'Suspensas' },
];

const PLAN_OPTIONS: readonly { value: PlanFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'TRIAL_MONTHLY', label: 'Em teste' },
  { value: 'PRO_MONTHLY', label: 'Pro (mensal)' },
];

/**
 * Empresas (padrão de lista da plataforma, 18/11/2026): abas em `app-pill-tabs`,
 * `app-page-card "Lista"`, `app-list-toolbar` (busca no servidor + pílulas de situação + select de
 * plano + contagem + "Limpar filtros") e `app-data-list` (tabela a partir de 1024px, cartões
 * abaixo, kebab por linha, paginação do servidor no rodapé do componente).
 */
@Component({
  selector: 'app-admin-companies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PersonNamePipe,
    AdminCompaniesTabs,
    ContactActions,
    BackLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    ListToolbar,
    ListFilterSelect,
    StatusChip,
    RouterLink,
  ],
  templateUrl: './admin-companies.html',
})
export class AdminCompanies {
  private readonly companiesService = inject(AdminCompaniesService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);

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

  protected readonly search = signal<string>('');
  protected readonly columns = COLUMNS;

  /** A linha inteira abre o detalhe (alvo de mouse e toque); o teclado usa o link do nome. */
  protected openCompany(company: AdminCompanyListItem): void {
    void this.router.navigate(['/admin/companies', company.id]);
  }

  protected readonly rowId = (company: AdminCompanyListItem): string => company.id;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (company: AdminCompanyListItem): string => `Ações da empresa ${company.name}`;
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

  /** Algum filtro fora do padrão: o toolbar mostra "Limpar filtros". */
  protected readonly filtersActive = computed(
    () => this.search() !== '' || this.statusFilter() !== 'ALL' || this.planFilter() !== 'ALL',
  );

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

  /** Busca no servidor (o toolbar já espera 300ms depois da última tecla). */
  protected setSearch(value: string): void {
    const next = value.trim();
    if (next === this.search()) return;
    this.currentPage.set(0);
    this.search.set(next);
  }

  protected setStatusFilter(value: StatusFilter): void {
    this.currentPage.set(0);
    this.statusFilter.set(value);
  }

  protected setPlanFilter(value: PlanFilter): void {
    this.currentPage.set(0);
    this.planFilter.set(value);
  }

  protected onPlanChange(event: Event): void {
    this.setPlanFilter((event.target as HTMLSelectElement).value as PlanFilter);
  }

  protected clearFilters(): void {
    this.currentPage.set(0);
    this.search.set('');
    this.statusFilter.set('ALL');
    this.planFilter.set('ALL');
  }

  protected goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) return;
    this.currentPage.set(page);
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
    return COMPANY_STATUS_CHIPS[status] ?? { label: status, tone: 'neutral' };
  }

  protected subChip(company: AdminCompanyListItem): SubscriptionChip | null {
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
