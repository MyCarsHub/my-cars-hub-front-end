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
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../../services/notification.service';
import { AdminUsersService } from '../admin-users.service';
import {
  AdminUserListItem,
  AdminUserRoleFilter,
  AdminUserStatusFilter,
} from '../../../types/admin-user.types';

interface PendingAction {
  kind: 'DEACTIVATE' | 'ACTIVATE' | 'PROMOTE' | 'DEMOTE';
  user: AdminUserListItem;
}

const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './admin-users.html',
})
export class AdminUsers implements OnInit, OnDestroy {
  private readonly usersService = inject(AdminUsersService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  protected readonly items = this.usersService.items;
  protected readonly total = this.usersService.total;
  protected readonly page = this.usersService.page;
  protected readonly size = this.usersService.size;
  protected readonly loading = this.usersService.loading;
  protected readonly error = this.usersService.error;

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly search = signal<string>('');
  protected readonly statusFilter = signal<AdminUserStatusFilter>('ALL');
  protected readonly roleFilter = signal<AdminUserRoleFilter>('ALL');
  protected readonly currentPage = signal(0);

  protected readonly openActionMenuId = signal<string | null>(null);
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
      const page = this.currentPage();
      this.usersService
        .load({ search, status, systemRole: role, page, size: PAGE_SIZE })
        .subscribe({
          error: () => {
            this.notify.error('Falha ao carregar usuários.');
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

  protected prevPage(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
  }

  protected toggleMenu(user: AdminUserListItem, event?: Event): void {
    event?.stopPropagation();
    this.openActionMenuId.update((cur) => (cur === user.id ? null : user.id));
  }

  protected closeMenu(): void {
    this.openActionMenuId.set(null);
  }

  protected openDetail(user: AdminUserListItem): void {
    this.closeMenu();
    this.router.navigate(['/admin/users', user.id]);
  }

  protected requestToggleStatus(user: AdminUserListItem): void {
    this.closeMenu();
    if (user.active) {
      // desativar → confirma
      this.pendingAction.set({ kind: 'DEACTIVATE', user });
    } else {
      // ativar → aplica direto
      this.applyStatus(user, true);
    }
  }

  protected requestToggleRole(user: AdminUserListItem): void {
    this.closeMenu();
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
      ? 'bg-purple-100 text-purple-700'
      : 'bg-gray-100 text-gray-700';
  }

  protected statusChip(active: boolean): string {
    return active
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-red-100 text-red-700';
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
    this.setRowPending(user.id, true);
    this.usersService.updateStatus(user.id, active).subscribe({
      next: () => {
        this.setRowPending(user.id, false);
        this.notify.success(active ? 'Usuário ativado.' : 'Usuário desativado.');
      },
      error: (err: HttpErrorResponse) => {
        this.setRowPending(user.id, false);
        this.notify.error(this.extractError(err, 'Falha ao atualizar status.'));
      },
    });
  }

  private applyRole(user: AdminUserListItem, role: 'USER' | 'PLATFORM_ADMIN'): void {
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
        this.notify.error(this.extractError(err, 'Falha ao atualizar papel.'));
      },
    });
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }
    return fallback;
  }
}
