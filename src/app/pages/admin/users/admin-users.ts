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
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminUsersService } from '../admin-users.service';
import {
  AdminUserListItem,
  AdminUserPresenceFilter,
  AdminUserRoleFilter,
  AdminUserStatusFilter,
} from '../../../types/admin-user.types';

interface PendingAction {
  kind: 'DEACTIVATE' | 'ACTIVATE' | 'PROMOTE' | 'DEMOTE';
  user: AdminUserListItem;
}

const PAGE_SIZE = 20;

/**
 * Opcoes dos dois filtros. Ficam FORA do template porque `FilterChipGroup.options`
 * e um `input` — um literal inline no template viraria um array novo a cada
 * deteccao de mudanca e derrubaria o `OnPush` do grupo a toa.
 */
const STATUS_OPTIONS: readonly FilterChipOption<AdminUserStatusFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'INACTIVE', label: 'Inativos' },
];

const PRESENCE_OPTIONS: readonly FilterChipOption<AdminUserPresenceFilter>[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'ONLINE', label: 'Online agora' },
];

const ROLE_OPTIONS: readonly FilterChipOption<AdminUserRoleFilter>[] = [
  { value: 'ALL', label: 'Todos os papéis' },
  { value: 'USER', label: 'Usuário' },
  { value: 'PLATFORM_ADMIN', label: 'Admin' },
];

@Component({
  selector: 'app-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    ActionsMenu,
    FilterChipGroup,
    RouterLink,
  ],
  templateUrl: './admin-users.html',
})
export class AdminUsers implements OnInit, OnDestroy {
  private readonly usersService = inject(AdminUsersService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy$ = new Subject<void>();

  protected readonly items = this.usersService.items;
  protected readonly total = this.usersService.total;
  protected readonly page = this.usersService.page;
  protected readonly size = this.usersService.size;
  protected readonly loading = this.usersService.loading;
  /** Falha ao CARREGAR a lista — banner inline, nunca toast. */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha de uma OPERACAO da tela (ativar/desativar, promover/rebaixar). Banner
   * inline: o interceptor nao toasta 4xx e `messageFor()` reivindica o erro,
   * desarmando o safety net.
   */
  protected readonly actionError = signal<string | null>(null);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly search = signal<string>('');
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly presenceOptions = PRESENCE_OPTIONS;

  protected readonly statusFilter = signal<AdminUserStatusFilter>('ALL');
  protected readonly roleFilter = signal<AdminUserRoleFilter>('ALL');
  /**
   * Presenca. Nasce de `?online=true` — o cartao "Online agora" do painel
   * admin abre a lista ja filtrada.
   */
  protected readonly presenceFilter = signal<AdminUserPresenceFilter>(
    this.route.snapshot.queryParamMap.get('online') === 'true' ? 'ONLINE' : 'ALL',
  );
  protected readonly currentPage = signal(0);

  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly rowPending = signal<Record<string, boolean>>({});

  protected readonly totalPages = computed(() => {
    const t = this.total();
    const s = this.size() || PAGE_SIZE;
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / s));
  });

  protected readonly canPrev = computed(() => this.currentPage() > 0);
  protected readonly canNext = computed(() => this.currentPage() + 1 < this.totalPages());

  protected readonly confirmVariant = computed<'info' | 'warning' | 'danger'>(() => {
    const action = this.pendingAction();
    if (!action) return 'info';
    return action.kind === 'PROMOTE' || action.kind === 'DEACTIVATE' ? 'danger' : 'warning';
  });

  protected readonly confirmTitle = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    switch (action.kind) {
      case 'DEACTIVATE': return 'Desativar usuário';
      case 'ACTIVATE': return 'Ativar usuário';
      case 'PROMOTE': return 'Promover a administrador da plataforma';
      case 'DEMOTE': return 'Rebaixar para usuário comum';
    }
  });

  protected readonly confirmMessage = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    const label = action.user.name ?? action.user.email;
    switch (action.kind) {
      case 'DEACTIVATE':
        return `«${label}» perderá acesso imediatamente à plataforma. Continuar?`;
      case 'ACTIVATE':
        return `«${label}» poderá voltar a acessar a plataforma.`;
      case 'PROMOTE':
        return `Isso dará acesso admin total a «${label}» — inclusive gestão de usuários, feedback e métricas. Prossiga apenas se essa pessoa é membro da equipe.`;
      case 'DEMOTE':
        return `«${label}» perderá acesso à área /admin, mantendo apenas o app normal.`;
    }
  });

  protected readonly confirmLabel = computed(() => {
    const action = this.pendingAction();
    if (!action) return 'Confirmar';
    switch (action.kind) {
      case 'DEACTIVATE': return 'Desativar';
      case 'ACTIVATE': return 'Ativar';
      case 'PROMOTE': return 'Promover';
      case 'DEMOTE': return 'Rebaixar';
    }
  });

  constructor() {
    effect(() => {
      // Any filter/search/page change → refetch
      const search = this.search();
      const status = this.statusFilter();
      const role = this.roleFilter();
      const online = this.presenceFilter() === 'ONLINE';
      const page = this.currentPage();
      this.error.set(null);
      this.usersService
        .load({ search, status, systemRole: role, online, page, size: PAGE_SIZE })
        .subscribe({
          error: (err: HttpErrorResponse) => {
            this.error.set(
              this.apiErrors.messageFor(
                err,
                'Não foi possível carregar os usuários. Tente novamente.',
              ),
            );
          },
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

  protected setStatusFilter(value: AdminUserStatusFilter): void {
    this.currentPage.set(0);
    this.statusFilter.set(value);
  }

  protected setRoleFilter(value: AdminUserRoleFilter): void {
    this.currentPage.set(0);
    this.roleFilter.set(value);
  }

  protected setPresenceFilter(value: AdminUserPresenceFilter): void {
    this.currentPage.set(0);
    this.presenceFilter.set(value);
  }

  /**
   * Texto secundario de presenca para quem NAO esta online: "Visto ha 12 min".
   * Null quando online (o selo ja diz) ou nunca visto. O "agora" e o momento
   * da renderizacao — a lista recarrega a cada filtro/pagina.
   */
  protected lastSeenLabel(user: AdminUserListItem): string | null {
    if (user.online || !user.lastSeenAt) return null;
    const seen = Date.parse(user.lastSeenAt);
    if (Number.isNaN(seen)) return null;
    const minutes = Math.max(1, Math.floor((Date.now() - seen) / 60_000));
    if (minutes < 60) return `Visto há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Visto há ${hours} h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'Visto há 1 dia' : `Visto há ${days} dias`;
  }

  protected prevPage(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
  }

  protected requestToggleStatus(user: AdminUserListItem): void {
    if (user.active) {
      // desativar → confirma
      this.pendingAction.set({ kind: 'DEACTIVATE', user });
    } else {
      // ativar → aplica direto
      this.applyStatus(user, true);
    }
  }

  protected requestToggleRole(user: AdminUserListItem): void {
    if (user.systemRole === 'PLATFORM_ADMIN') {
      // rebaixar
      this.pendingAction.set({ kind: 'DEMOTE', user });
    } else {
      // promover — sempre confirma com variante danger
      this.pendingAction.set({ kind: 'PROMOTE', user });
    }
  }

  protected cancelPending(): void {
    this.pendingAction.set(null);
  }

  protected confirmPending(): void {
    const action = this.pendingAction();
    if (!action) return;
    switch (action.kind) {
      case 'DEACTIVATE': this.applyStatus(action.user, false); break;
      case 'ACTIVATE':   this.applyStatus(action.user, true); break;
      case 'PROMOTE':    this.applyRole(action.user, 'PLATFORM_ADMIN'); break;
      case 'DEMOTE':     this.applyRole(action.user, 'USER'); break;
    }
    this.pendingAction.set(null);
  }

  protected isPending(id: string): boolean {
    return !!this.rowPending()[id];
  }

  protected roleLabel(role: string): string {
    return role === 'PLATFORM_ADMIN' ? 'Admin' : 'Usuário';
  }

  protected roleChip(role: string): string {
    return role === 'PLATFORM_ADMIN'
      ? 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300'
      : 'bg-surface-sunken text-fg-soft';
  }

  protected statusChip(active: boolean): string {
    return active
      ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300';
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

  private applyRole(user: AdminUserListItem, role: 'USER' | 'PLATFORM_ADMIN'): void {
    this.actionError.set(null);
    this.setRowPending(user.id, true);
    this.usersService.updateSystemRole(user.id, role).subscribe({
      next: () => {
        this.setRowPending(user.id, false);
        this.notify.success(
          role === 'PLATFORM_ADMIN'
            ? 'Usuário promovido a administrador.'
            : 'Usuário rebaixado para usuário comum.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(user.id, false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o papel do usuário.'),
        );
      },
    });
  }
}
