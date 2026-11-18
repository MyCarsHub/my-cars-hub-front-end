import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BackLink } from '../../../components/core/back-link/back-link';
import { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import {
  DataList,
  DataListActions,
  DataListCell,
  DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import { ListFilterSelect, ListToolbar } from '../../../components/lists/list-toolbar/list-toolbar';
import { PageCard } from '../../../components/core/page-card/page-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminUsersService } from '../admin-users.service';
import { ContactActions } from '../contact/contact-actions';
import { AdminUserListItem } from '../../../types/admin-user.types';
import {
  RESEND_FALLBACK,
  UsersRoleFilter,
  UsersStatusFilter,
  companiesDetail,
  companiesSummary,
  exactDateTime,
  hasPendingInvite,
  isLocalFilter,
  lastAccessLabel,
  matchesLocalFilters,
  resendRefusal,
  serverQueryFor,
  userRole,
  userSituation,
} from './admin-users-view';
import { PersonNamePipe } from '../../../pipes/person-name.pipe';

interface PendingAction {
  kind: 'DEACTIVATE' | 'ACTIVATE';
  user: AdminUserListItem;
}

const PAGE_SIZE = 20;

/** Fora do template: `options` e um `input`, e um literal inline recriaria o array a cada ciclo. */
const STATUS_OPTIONS: readonly FilterChipOption<UsersStatusFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'INACTIVE', label: 'Inativos' },
  { value: 'PENDING', label: 'Convite pendente' },
  { value: 'ONLINE', label: 'Online agora' },
];

/** Papel vai no select da linha da busca ("Papel: Donos"), nunca numa segunda fileira de pilulas. */
const ROLE_OPTIONS: readonly { value: UsersRoleFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OWNER', label: 'Donos' },
  { value: 'MANAGER', label: 'Gerenciadores' },
  { value: 'DRIVER', label: 'Motoristas' },
];

@Component({
  selector: 'app-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PersonNamePipe,
    ContactActions,
    BackLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    RouterLink,
    DataList,
    DataListCell,
    DataListActions,
    DataListMenuItem,
    ListToolbar,
    ListFilterSelect,
  ],
  templateUrl: './admin-users.html',
})
export class AdminUsers implements OnInit {
  private readonly usersService = inject(AdminUsersService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly caps = inject(AdminCapabilitiesService);

  protected readonly items = this.usersService.items;
  protected readonly total = this.usersService.total;
  protected readonly size = this.usersService.size;
  protected readonly loading = this.usersService.loading;
  /** Falha ao CARREGAR a lista: banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);
  /** Falha de uma OPERACAO (ativar/desativar/reenviar convite): banner inline, erro reivindicado. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly search = signal<string>('');
  /** Nasce de `?online=true`: o cartao "Online agora" do painel abre a lista ja filtrada. */
  protected readonly status = signal<UsersStatusFilter>(
    this.route.snapshot.queryParamMap.get('online') === 'true' ? 'ONLINE' : 'ALL',
  );
  protected readonly role = signal<UsersRoleFilter>('ALL');
  protected readonly currentPage = signal(0);

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly rowPending = signal<Record<string, boolean>>({});

  /** Falha fechada: sem a capacidade (ou sem resposta do /admin/me) nenhuma acao de escrita aparece. */
  protected readonly canManage = computed(() => this.caps.can('usuario.gerir'));

  /** Papel e convite pendente o servidor nao filtra: valem para as linhas carregadas. */
  protected readonly localFilter = computed(() => isLocalFilter(this.status(), this.role()));
  protected readonly rows = computed(() => {
    const status = this.status();
    const role = this.role();
    return this.items().filter((u) => matchesLocalFilters(u, status, role));
  });
  /**
   * Sem filtro local: o total do servidor. Com ele: as linhas que sobraram NESTA pagina, e a
   * nota diz que o recorte e da pagina. (Nao passar `null`: com filtro ativo o toolbar
   * escreveria "0 usuarios".)
   */
  protected readonly resultCount = computed(() =>
    this.localFilter() ? this.rows().length : this.total(),
  );
  protected readonly anyFilter = computed(
    () => this.search().trim() !== '' || this.status() !== 'ALL' || this.role() !== 'ALL',
  );

  protected readonly columns: readonly DataListColumn<AdminUserListItem>[] = [
    {
      key: 'user',
      header: 'Usuário',
      primary: true,
      value: (u) => (u.name ? `${u.name} <${u.email}>` : u.email),
    },
    { key: 'phone', header: 'Telefone', value: (u) => u.phoneMasked, noExport: true },
    // Papel e quem a pessoa e: chip neutro (cor so na situacao).
    { key: 'role', header: 'Papel', kind: 'status', value: (u) => userRole(u)?.label },
    { key: 'companies', header: 'Empresas', value: (u) => companiesSummary(u) },
    {
      key: 'last',
      header: 'Último acesso',
      value: (u) => {
        const label = lastAccessLabel(u, Date.now());
        if (!label) return 'Nunca visto';
        const exact = this.exactSeen(u);
        return exact ? `${label} (${exact})` : label;
      },
    },
    {
      key: 'status',
      header: 'Situação',
      kind: 'status',
      value: (u) => userSituation(u).label,
      tone: (u) => userSituation(u).tone,
    },
  ];

  protected readonly rowId = (u: AdminUserListItem): string => u.id;

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size() || PAGE_SIZE;
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / s));
  });

  protected readonly confirmVariant = computed<'info' | 'warning' | 'danger'>(() =>
    this.pendingAction()?.kind === 'DEACTIVATE' ? 'danger' : 'warning',
  );
  protected readonly confirmTitle = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    return action.kind === 'DEACTIVATE' ? 'Desativar usuário' : 'Ativar usuário';
  });
  protected readonly confirmMessage = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    const label = action.user.name ?? action.user.email;
    return action.kind === 'DEACTIVATE'
      ? `«${label}» perderá acesso imediatamente à plataforma. Continuar?`
      : `«${label}» poderá voltar a acessar a plataforma.`;
  });
  protected readonly confirmLabel = computed(() => {
    const action = this.pendingAction();
    if (!action) return 'Confirmar';
    return action.kind === 'DEACTIVATE' ? 'Desativar' : 'Ativar';
  });

  constructor() {
    effect(() => {
      const search = this.search();
      const { status, online } = serverQueryFor(this.status());
      const page = this.currentPage();
      this.error.set(null);
      this.usersService.load({ search, status, online, page, size: PAGE_SIZE }).subscribe({
        error: (err: HttpErrorResponse) => {
          this.error.set(
            this.apiErrors.messageFor(err, 'Não foi possível carregar os usuários. Tente novamente.'),
          );
        },
      });
    });
  }

  ngOnInit(): void {
    this.caps.ensureLoaded().subscribe();
  }

  /** "Visto há 3 dias" da celula (o texto curto). */
  protected lastAccess(u: AdminUserListItem): string | null {
    return lastAccessLabel(u, Date.now());
  }

  /** Data e hora exatas embaixo do texto relativo; online nao precisa. */
  protected exactSeen(u: AdminUserListItem): string | null {
    return u.online ? null : exactDateTime(u.lastSeenAt);
  }

  protected companiesText(u: AdminUserListItem): string {
    return companiesSummary(u);
  }

  /** Todas as empresas com o papel em cada uma (balao no mouse e texto do leitor de tela). */
  protected companiesTitle(u: AdminUserListItem): string {
    return companiesDetail(u);
  }

  /** A linha inteira abre o detalhe (alvo de mouse e toque); o teclado usa o link do nome. */
  protected openUser(user: AdminUserListItem): void {
    void this.router.navigate(['/admin/users', user.id]);
  }

  /** O toolbar ja espera 300 ms (`searchDebounce`); aqui so volta para a primeira pagina. */
  protected setSearch(value: string): void {
    if (value === this.search()) return;
    this.currentPage.set(0);
    this.search.set(value);
  }

  protected setStatus(value: UsersStatusFilter): void {
    this.currentPage.set(0);
    this.status.set(value);
  }

  /** Filtro local: nao recarrega nem muda de pagina. */
  protected setRole(value: string): void {
    this.role.set(value as UsersRoleFilter);
  }

  protected clearFilters(): void {
    this.currentPage.set(0);
    this.search.set('');
    this.status.set('ALL');
    this.role.set('ALL');
  }

  protected goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) return;
    this.currentPage.set(page);
  }

  protected canResend(user: AdminUserListItem): boolean {
    return this.canManage() && user.active && hasPendingInvite(user);
  }

  protected requestToggleStatus(user: AdminUserListItem): void {
    if (user.active) {
      this.pendingAction.set({ kind: 'DEACTIVATE', user });
    } else {
      this.applyStatus(user, true);
    }
  }

  protected cancelPending(): void {
    this.pendingAction.set(null);
  }

  protected confirmPending(): void {
    const action = this.pendingAction();
    if (!action) return;
    this.applyStatus(action.user, action.kind === 'ACTIVATE');
    this.pendingAction.set(null);
  }

  protected isPending(id: string): boolean {
    return !!this.rowPending()[id];
  }

  protected resendInvite(user: AdminUserListItem): void {
    this.actionError.set(null);
    this.setRowPending(user.id, true);
    this.usersService.resendInvite(user.id).subscribe({
      next: () => {
        this.setRowPending(user.id, false);
        this.notify.success('Convite reenviado.');
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(user.id, false);
        const generic = this.apiErrors.messageFor(err, RESEND_FALLBACK);
        this.actionError.set(resendRefusal(err) ?? generic);
      },
    });
  }

  private setRowPending(id: string, value: boolean): void {
    this.rowPending.update((state) => ({ ...state, [id]: value }));
  }

  private applyStatus(user: AdminUserListItem, active: boolean): void {
    this.actionError.set(null);
    this.setRowPending(user.id, true);
    this.usersService.updateStatus(user.id, active).subscribe({
      next: () => {
        this.setRowPending(user.id, false);
        this.notify.success(active ? 'Usuário ativado.' : 'Usuário desativado.');
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(user.id, false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status do usuário.'),
        );
      },
    });
  }
}
