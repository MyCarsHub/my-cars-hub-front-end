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

import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { StatusChip, StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { AdminUsersService } from '../admin-users.service';
import { AdminUserCompanyLink } from '../../../types/admin-user.types';
import {
  RESEND_FALLBACK,
  detailHasPendingInvite,
  enterAsTargets,
  resendRefusal,
} from './admin-users-view';
import { companyRoleLabel } from '../../../utils/role-labels';
import { ContactBar } from '../contact/contact-bar';
import { PersonNamePipe } from '../../../pipes/person-name.pipe';

interface PendingAction {
  kind: 'DEACTIVATE' | 'ACTIVATE';
}

const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INVITED: 'Convidado',
  ONBOARDING: 'Em cadastro',
  INACTIVE: 'Inativo',
  REMOVED: 'Removido',
};

@Component({
  selector: 'app-admin-user-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PersonNamePipe,
    BackLink,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    RouterLink,
    ContactBar,
    BottomSheet,
    StatusChip,
  ],
  templateUrl: './admin-user-detail.html',
})
export class AdminUserDetail implements OnInit, OnDestroy {
  private readonly usersService = inject(AdminUsersService);
  protected readonly caps = inject(AdminCapabilitiesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly impersonation = inject(ImpersonationService);

  private userId: string | null = null;

  protected readonly detail = this.usersService.detail;
  protected readonly loading = this.usersService.detailLoading;
  /** Falha ao CARREGAR o usuário — banner com CTA de "tentar novamente". */
  protected readonly error = signal<string | null>(null);
  /**
   * Falha de uma OPERACAO da tela (ativar/desativar; papel de admin so em Admins e papeis). Banner
   * inline, nunca toast: `messageFor()` reivindica o erro e desarma o safety net.
   */
  protected readonly actionError = signal<string | null>(null);

  protected readonly resending = signal(false);
  protected readonly entering = signal(false);
  protected readonly pickerOpen = signal(false);

  /** Empresas onde "Entrar como" faz sentido (nao motorista, vinculo ativo). */
  protected readonly enterTargets = computed(() => enterAsTargets(this.detail()?.companies ?? []));
  protected readonly canEnterAs = computed(
    () => this.caps.can('ver_como') && this.enterTargets().length > 0,
  );
  protected readonly firstName = computed(() => {
    const name = this.detail()?.name?.trim();
    return name ? name.split(/\s+/)[0] : 'usuário';
  });

  /**
   * O detalhe nao traz `accountStatus`: vale o vinculo INVITED ou a linha da lista que o
   * admin acabou de abrir. Quando o sinal falha, o 409 do servidor aparece inline.
   */
  protected readonly canResend = computed(() => {
    const u = this.detail();
    if (!u || !u.active || !this.caps.can('usuario.gerir')) return false;
    return (
      detailHasPendingInvite(u.companies) ||
      this.usersService.listedItem(u.id)?.accountStatus === 'PRE_REGISTERED'
    );
  });
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly updating = signal(false);

  protected readonly confirmVariant = computed<'info' | 'warning' | 'danger'>(() => {
    const a = this.pendingAction();
    if (!a) return 'info';
    return a.kind === 'DEACTIVATE' ? 'danger' : 'warning';
  });

  protected readonly confirmTitle = computed(() => {
    const a = this.pendingAction();
    if (!a) return '';
    switch (a.kind) {
      case 'DEACTIVATE':
        return 'Desativar usuário';
      case 'ACTIVATE':
        return 'Ativar usuário';
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
    }
  });

  protected readonly confirmLabel = computed(() => {
    const a = this.pendingAction();
    if (!a) return 'Confirmar';
    switch (a.kind) {
      case 'DEACTIVATE':
        return 'Desativar';
      case 'ACTIVATE':
        return 'Ativar';
    }
  });

  /**
   * Último acesso formatado, ou `null` quando o backend não tem registro.
   *
   * O `last_login_date` só passou a ser gravado no login Google recentemente e
   * NÃO houve backfill — usuários antigos ficam nulos até logarem de novo,
   * mesmo já tendo acessado. Por isso o estado vazio é "Sem registro de
   * acesso" (ausência do dado) e não uma afirmação de que a pessoa nunca entrou.
   */
  protected readonly lastLogin = computed<string | null>(() =>
    this.formatDateTime(this.detail()?.lastLoginAt ?? null),
  );

  /**
   * Presença (V122): última requisição autenticada. A lista já mostrava, o
   * detalhe não (auditoria 03). Nulo = nunca visto desde a V122 — que é recente,
   * então o vazio não afirma que a pessoa nunca entrou.
   */
  protected readonly lastSeen = computed<string | null>(() =>
    this.formatDateTime(this.detail()?.lastSeenAt ?? null),
  );

  ngOnInit(): void {
    this.caps.ensureLoaded().subscribe();
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.router.navigate(['/admin/users']);
        return;
      }
      this.userId = id;
      this.loadDetail(id);
    });
  }

  ngOnDestroy(): void {
    this.usersService.clearDetail();
  }

  protected reload(): void {
    if (this.userId) this.loadDetail(this.userId);
  }

  private loadDetail(id: string): void {
    this.error.set(null);
    this.actionError.set(null);
    this.usersService.getDetail(id).subscribe({
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar o usuário.'));
      },
    });
  }

  /** "Entrar como": uma empresa elegivel abre direto; 2 ou mais pedem a escolha. */
  protected enterAs(): void {
    const targets = this.enterTargets();
    if (targets.length === 1) this.startEnter(targets[0]);
    else if (targets.length > 1) this.pickerOpen.set(true);
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
  }

  protected startEnter(link: AdminUserCompanyLink): void {
    if (this.entering()) return;
    this.pickerOpen.set(false);
    this.actionError.set(null);
    this.entering.set(true);
    this.impersonation.start(link.companyId).subscribe({
      next: (session) => {
        this.entering.set(false);
        this.notify.info(`Você está vendo ${session.companyName} em modo somente leitura.`);
        void this.router.navigate(['/dashboard']);
      },
      error: (err: HttpErrorResponse) => {
        this.entering.set(false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível abrir a sessão de leitura.'),
        );
      },
    });
  }

  protected resendInvite(): void {
    if (!this.userId || this.resending()) return;
    this.actionError.set(null);
    this.resending.set(true);
    this.usersService.resendInvite(this.userId).subscribe({
      next: () => {
        this.resending.set(false);
        this.notify.success('Convite reenviado.');
      },
      error: (err: HttpErrorResponse) => {
        this.resending.set(false);
        const generic = this.apiErrors.messageFor(err, RESEND_FALLBACK);
        this.actionError.set(resendRefusal(err) ?? generic);
      },
    });
  }

  protected requestToggleStatus(): void {
    const u = this.detail();
    if (!u) return;
    if (u.active) {
      this.pendingAction.set({ kind: 'DEACTIVATE' });
    } else {
      this.applyStatus(true);
    }
  }


  protected cancelPending(): void {
    this.pendingAction.set(null);
  }

  protected confirmPending(): void {
    const a = this.pendingAction();
    if (!a) return;
    switch (a.kind) {
      case 'DEACTIVATE':
        this.applyStatus(false);
        break;
      case 'ACTIVATE':
        this.applyStatus(true);
        break;
    }
    this.pendingAction.set(null);
  }

  /**
   * Esta tela renderiza os DOIS eixos de papel no mesmo lugar: o SystemRole do
   * usuário (USER | PLATFORM_ADMIN) e o CompanyRole dos vínculos dele. Só o
   * segundo vem da fonte única — o primeiro é outro conceito e fica aqui.
   */
  protected roleLabel(role: string): string {
    if (role === 'PLATFORM_ADMIN') return 'Admin da plataforma';
    if (role === 'USER') return 'Usuário';
    return companyRoleLabel(role);
  }

  protected roleTone(role: string): StatusChipTone {
    return role === 'OWNER' ? 'orange' : role === 'MANAGER' ? 'blue' : role === 'DRIVER' ? 'green' : 'neutral';
  }

  protected statusTone(active: boolean): StatusChipTone {
    return active ? 'green' : 'red';
  }

  /**
   * Situacao do vinculo em portugues. O backend manda o enum cru (ACTIVE, INVITED,
   * ONBOARDING...) e a tela o exibia assim (AUDIT 2026-10-25 D2).
   */
  protected linkStatusLabel(status: string): string {
    return MEMBERSHIP_STATUS_LABELS[status] ?? status;
  }

  protected linkStatusTone(status: string): StatusChipTone {
    return status === 'ACTIVE' ? 'green' : status === 'INVITED' ? 'blue' : 'neutral';
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private formatDateTime(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected trackLink(_i: number, link: AdminUserCompanyLink): string {
    return link.companyId;
  }

  private applyStatus(active: boolean): void {
    if (!this.userId) return;
    this.actionError.set(null);
    this.updating.set(true);
    this.usersService.updateStatus(this.userId, active).subscribe({
      next: () => {
        this.updating.set(false);
        this.notify.success(active ? 'Usuário ativado.' : 'Usuário desativado.');
      },
      error: (err: HttpErrorResponse) => {
        this.updating.set(false);
        this.actionError.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status do usuário.'),
        );
      },
    });
  }

}
