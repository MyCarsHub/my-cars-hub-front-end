import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../../services/notification.service';
import { AdminUsersService } from '../admin-users.service';
import { AdminUserCompanyLink } from '../../../types/admin-user.types';

interface PendingAction {
  kind: 'DEACTIVATE' | 'ACTIVATE' | 'PROMOTE' | 'DEMOTE';
}

@Component({
  selector: 'app-admin-user-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './admin-user-detail.html',
})
export class AdminUserDetail implements OnInit, OnDestroy {
  private readonly usersService = inject(AdminUsersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  private userId: string | null = null;

  protected readonly detail = this.usersService.detail;
  protected readonly loading = this.usersService.detailLoading;
  protected readonly error = this.usersService.detailError;

  protected readonly openActionMenu = signal(false);
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly updating = signal(false);

  protected readonly confirmVariant = computed<'info' | 'warning' | 'danger'>(() => {
    const a = this.pendingAction();
    if (!a) return 'info';
    return a.kind === 'PROMOTE' || a.kind === 'DEACTIVATE' ? 'danger' : 'warning';
  });

  protected readonly confirmTitle = computed(() => {
    const a = this.pendingAction();
    if (!a) return '';
    switch (a.kind) {
      case 'DEACTIVATE': return 'Desativar usuário';
      case 'ACTIVATE': return 'Ativar usuário';
      case 'PROMOTE': return 'Promover a administrador da plataforma';
      case 'DEMOTE': return 'Rebaixar para usuário comum';
    }
  });

  protected readonly confirmMessage = computed(() => {
    const a = this.pendingAction();
    const u = this.detail();
    if (!a || !u) return '';
    const label = u.name ?? u.email;
    switch (a.kind) {
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
    const a = this.pendingAction();
    if (!a) return 'Confirmar';
    switch (a.kind) {
      case 'DEACTIVATE': return 'Desativar';
      case 'ACTIVATE': return 'Ativar';
      case 'PROMOTE': return 'Promover';
      case 'DEMOTE': return 'Rebaixar';
    }
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get('id');
        if (!id) {
          this.router.navigate(['/admin/users']);
          return;
        }
        this.userId = id;
        this.usersService.getDetail(id).subscribe({ error: () => {} });
      });
  }

  ngOnDestroy(): void {
    this.usersService.clearDetail();
  }

  protected reload(): void {
    if (this.userId) {
      this.usersService.getDetail(this.userId).subscribe({ error: () => {} });
    }
  }

  protected toggleActionMenu(event?: Event): void {
    event?.stopPropagation();
    this.openActionMenu.update((v) => !v);
  }

  protected closeActionMenu(): void {
    this.openActionMenu.set(false);
  }

  protected requestToggleStatus(): void {
    this.closeActionMenu();
    const u = this.detail();
    if (!u) return;
    if (u.active) {
      this.pendingAction.set({ kind: 'DEACTIVATE' });
    } else {
      this.applyStatus(true);
    }
  }

  protected requestToggleRole(): void {
    this.closeActionMenu();
    const u = this.detail();
    if (!u) return;
    this.pendingAction.set({
      kind: u.systemRole === 'PLATFORM_ADMIN' ? 'DEMOTE' : 'PROMOTE',
    });
  }

  protected cancelPending(): void {
    this.pendingAction.set(null);
  }

  protected confirmPending(): void {
    const a = this.pendingAction();
    if (!a) return;
    switch (a.kind) {
      case 'DEACTIVATE': this.applyStatus(false); break;
      case 'ACTIVATE':   this.applyStatus(true); break;
      case 'PROMOTE':    this.applyRole('PLATFORM_ADMIN'); break;
      case 'DEMOTE':     this.applyRole('USER'); break;
    }
    this.pendingAction.set(null);
  }

  protected roleLabel(role: string): string {
    if (role === 'PLATFORM_ADMIN') return 'Admin da plataforma';
    if (role === 'USER') return 'Usuário';
    const map: Record<string, string> = {
      OWNER: 'Proprietário',
      MANAGER: 'Gerente',
      DRIVER: 'Motorista',
    };
    return map[role] ?? role;
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

  protected linkStatusChip(status: string): string {
    if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
    if (status === 'INVITED') return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-700';
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  protected formatDateTime(iso: string | null): string {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  protected trackLink(_i: number, link: AdminUserCompanyLink): string {
    return link.companyId;
  }

  private applyStatus(active: boolean): void {
    if (!this.userId) return;
    this.updating.set(true);
    this.usersService.updateStatus(this.userId, active).subscribe({
      next: () => {
        this.updating.set(false);
        this.notify.success(active ? 'Usuário ativado.' : 'Usuário desativado.');
      },
      error: (err: HttpErrorResponse) => {
        this.updating.set(false);
        this.notify.error(this.extractError(err, 'Falha ao atualizar status.'));
      },
    });
  }

  private applyRole(role: 'USER' | 'PLATFORM_ADMIN'): void {
    if (!this.userId) return;
    this.updating.set(true);
    this.usersService.updateSystemRole(this.userId, role).subscribe({
      next: () => {
        this.updating.set(false);
        this.notify.success(role === 'PLATFORM_ADMIN'
          ? 'Usuário promovido a administrador.'
          : 'Usuário rebaixado para usuário comum.');
      },
      error: (err: HttpErrorResponse) => {
        this.updating.set(false);
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
