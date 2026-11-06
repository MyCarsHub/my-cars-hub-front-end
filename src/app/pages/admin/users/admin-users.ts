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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { BackLink } from '../../../components/core/back-link/back-link';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../../components/filter-chip-group/filter-chip-group';
import {
  DataList,
  DataListActions,
  DataListCell,
  DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { PillTabs, PillTabOption } from '../../../components/core/pill-tabs/pill-tabs';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminUsersService } from '../admin-users.service';
import { ContactActions } from '../contact/contact-actions';
import { AdminUserListItem, AdminUserPresenceFilter } from '../../../types/admin-user.types';
import {
  RESEND_FALLBACK,
  UsersTab,
  companiesSummary,
  hasPendingInvite,
  lastAccessLabel,
  matchesTab,
  resendRefusal,
  userRole,
  userSituation,
} from './admin-users-view';

interface PendingAction {
  kind: 'DEACTIVATE' | 'ACTIVATE';
  user: AdminUserListItem;
}

const PAGE_SIZE = 20;

/** Fora do template: `options` e um `input`, e um literal inline recriaria o array a cada ciclo. */
const PRESENCE_OPTIONS: readonly FilterChipOption<AdminUserPresenceFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ONLINE', label: 'Online agora' },
];

const TAB_OPTIONS: readonly PillTabOption<UsersTab>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'OWNER', label: 'Donos' },
  { value: 'MANAGER', label: 'Gerentes' },
  { value: 'DRIVER', label: 'Motoristas' },
  { value: 'INACTIVE', label: 'Inativos' },
];

@Component({
  selector: 'app-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ContactActions,
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    ConfirmDialog,
    AlertBanner,
    FilterChipGroup,
    RouterLink,
    DataList,
    DataListCell,
    DataListActions,
    PillTabs,
  ],
  templateUrl: './admin-users.html',
})
export class AdminUsers implements OnInit, OnDestroy {
  private readonly usersService = inject(AdminUsersService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly caps = inject(AdminCapabilitiesService);
  private readonly destroy$ = new Subject<void>();

  protected readonly items = this.usersService.items;
  protected readonly total = this.usersService.total;
  protected readonly size = this.usersService.size;
  protected readonly loading = this.usersService.loading;
  /** Falha ao CARREGAR a lista: banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);
  /** Falha de uma OPERACAO (ativar/desativar/reenviar convite): banner inline, erro reivindicado. */
  protected readonly actionError = signal<string | null>(null);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly search = signal<string>('');
  protected readonly tabOptions = TAB_OPTIONS;
  protected readonly presenceOptions = PRESENCE_OPTIONS;
  protected readonly tab = signal<UsersTab>('ALL');
  /** Nasce de `?online=true`: o cartao "Online agora" do painel abre a lista ja filtrada. */
  protected readonly presenceFilter = signal<AdminUserPresenceFilter>(
    this.route.snapshot.queryParamMap.get('online') === 'true' ? 'ONLINE' : 'ALL',
  );
  protected readonly currentPage = signal(0);

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly rowPending = signal<Record<string, boolean>>({});

  /** Falha fechada: sem a capacidade (ou sem resposta do /admin/me) nenhuma acao de escrita aparece. */
  protected readonly canManage = computed(() => this.caps.can('usuario.gerir'));

  /** Papel (dono/gerente/motorista) o servidor nao filtra: vale para as linhas carregadas. */
  protected readonly rows = computed(() => {
    const tab = this.tab();
    return this.items().filter((u) => matchesTab(u, tab));
  });
  protected readonly roleTabNote = computed(() =>
    ['OWNER', 'MANAGER', 'DRIVER'].includes(this.tab())
      ? 'O filtro de papel vale para os usuários desta página.'
      : null,
  );

  protected readonly columns: readonly DataListColumn<AdminUserListItem>[] = [
    {
      key: 'user',
      header: 'Usuário',
      primary: true,
      value: (u) => (u.name ? `${u.name} <${u.email}>` : u.email),
    },
    { key: 'phone', header: 'Telefone', value: (u) => u.phoneMasked, noExport: true },
    {
      key: 'role',
      header: 'Papel',
      kind: 'status',
      value: (u) => userRole(u)?.label,
      tone: (u) => userRole(u)?.tone ?? 'neutral',
    },
    { key: 'companies', header: 'Empresas', value: (u) => companiesSummary(u) },
    { key: 'last', header: 'Último acesso', value: (u) => lastAccessLabel(u, Date.now()) },
    {
      key: 'status',
      header: 'Situação',
      kind: 'status',
      value: (u) => userSituation(u).label,
      tone: (u) => userSituation(u).tone,
    },
  ];
  private readonly router = inject(Router);

  /** A linha inteira abre o detalhe (alvo de mouse e toque); o teclado usa o link do nome. */
  protected openUser(user: AdminUserListItem): void {
    void this.router.navigate(['/admin/users', user.id]);
  }

  protected readonly rowId = (u: AdminUserListItem): string => u.id;

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size() || PAGE_SIZE;
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / s));
  });
  protected readonly canPrev = computed(() => this.currentPage() > 0);
  protected readonly canNext = computed(() => this.currentPage() + 1 < this.totalPages());

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
      const status = this.tab() === 'INACTIVE' ? 'INACTIVE' : 'ALL';
      const online = this.presenceFilter() === 'ONLINE';
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

  protected setTab(value: UsersTab): void {
    this.currentPage.set(0);
    this.tab.set(value);
  }

  protected setPresenceFilter(value: AdminUserPresenceFilter): void {
    this.currentPage.set(0);
    this.presenceFilter.set(value);
  }

  protected prevPage(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
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
