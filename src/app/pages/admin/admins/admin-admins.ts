import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap, catchError } from 'rxjs';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ReasonOption, ReasonPicker } from '../../../components/core/reason-picker/reason-picker';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import { AdminUserListItem } from '../../../types/admin-user.types';
import { AdminMember, AdminRole, AdminRoleReason } from '../../../types/admin-roles.types';
import { ADMIN_ROLE_LABEL, AdminRoleBadge } from './admin-role-badge';
import { AdminRolesService } from './admin-roles.service';

export type AdminSheet = 'grant' | 'change' | 'revoke';

export const ROLE_OPTIONS: ReasonOption<AdminRole>[] = [
  {
    value: 'OWNER',
    label: 'Dono da plataforma',
    hint: 'Tudo, inclusive gerir admins, suspender empresas e remover usuários.',
  },
  {
    value: 'SUPPORT',
    label: 'Suporte',
    hint: 'Ver como empresa, modo edição, contato, ações de cobrança, chamados e blog.',
  },
  {
    value: 'READONLY',
    label: 'Leitura',
    hint: 'Vê empresas, pessoas, métricas e auditoria. Não age nem vê contato.',
  },
];

const GRANT_REASONS: ReasonOption<AdminRoleReason>[] = [
  { value: 'NEW_TEAM_MEMBER', label: 'Novo na equipe' },
  { value: 'ROLE_CHANGE', label: 'Mudança de função' },
  { value: 'OTHER', label: 'Outro' },
];
const CHANGE_REASONS: ReasonOption<AdminRoleReason>[] = [
  { value: 'ROLE_CHANGE', label: 'Mudança de função' },
  { value: 'SECURITY', label: 'Segurança' },
  { value: 'OTHER', label: 'Outro' },
];
const REVOKE_REASONS: ReasonOption<AdminRoleReason>[] = [
  { value: 'LEFT_TEAM', label: 'Saiu da equipe' },
  { value: 'SECURITY', label: 'Segurança' },
  { value: 'OTHER', label: 'Outro' },
];

/**
 * O que cada papel pode, em linguagem do dono — só para EXPLICAR a troca na
 * folha. Quem decide é o servidor (`AdminRole`).
 */
const ROLE_ABILITIES: Record<AdminRole, string[]> = {
  OWNER: [
    'Ver empresas, pessoas, métricas e auditoria',
    'Ver contato e ver como empresa',
    'Modo edição e ações de cobrança',
    'Chamados, blog e teste de empresas',
    'Suspender empresas e remover usuários',
    'Gerir admins e papéis',
  ],
  SUPPORT: [
    'Ver empresas, pessoas, métricas e auditoria',
    'Ver contato e ver como empresa',
    'Modo edição e ações de cobrança',
    'Chamados, blog e teste de empresas',
  ],
  READONLY: ['Ver empresas, pessoas, métricas e auditoria'],
};

export const REVOKE_WORD = 'REMOVER';

@Component({
  selector: 'app-admin-admins',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DefaultPageLayout, AlertBanner, BottomSheet, ReasonPicker, AdminRoleBadge, ActionsMenu],
  templateUrl: './admin-admins.html',
})
export class AdminAdmins implements OnInit {
  private readonly service = inject(AdminRolesService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly grantReasons = GRANT_REASONS;
  protected readonly changeReasons = CHANGE_REASONS;
  protected readonly revokeReasons = REVOKE_REASONS;
  protected readonly revokeWord = REVOKE_WORD;

  protected readonly members = signal<AdminMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  protected readonly myId = this.session.getUserId();

  protected readonly counts = computed(() => {
    const list = this.members().filter((m) => m.active);
    return {
      owner: list.filter((m) => m.adminRole === 'OWNER').length,
      support: list.filter((m) => m.adminRole === 'SUPPORT').length,
      readonly: list.filter((m) => m.adminRole === 'READONLY').length,
    };
  });

  /** O usuário logado é o único Dono ativo: a linha dele explica por que está travada. */
  protected readonly iAmOnlyOwner = computed(
    () =>
      this.counts().owner === 1 &&
      this.members().some((m) => m.id === this.myId && m.adminRole === 'OWNER' && m.active),
  );

  // ---------- folha ----------
  protected readonly sheet = signal<AdminSheet | null>(null);
  private readonly sheetRef = viewChild(BottomSheet);
  protected readonly target = signal<AdminMember | null>(null);
  protected readonly busy = signal(false);
  protected readonly sheetError = signal<string | null>(null);

  protected readonly role = signal<string | null>(null);
  protected readonly reason = signal<string | null>(null);
  protected readonly confirmText = signal('');

  // conceder
  protected readonly query = signal('');
  protected readonly candidates = signal<AdminUserListItem[]>([]);
  protected readonly searching = signal(false);
  protected readonly picked = signal<AdminUserListItem | null>(null);
  private readonly query$ = new Subject<string>();

  protected readonly sheetTitle = computed(() => {
    const t = this.target();
    switch (this.sheet()) {
      case 'grant':
        return 'Adicionar admin';
      case 'change':
        return `Mudar papel de ${t?.name ?? 'admin'}`;
      case 'revoke':
        return 'Remover acesso de admin';
      default:
        return t?.name ?? 'Admin';
    }
  });

  protected readonly sheetSubtitle = computed(() => {
    const t = this.target();
    switch (this.sheet()) {
      case 'grant':
        return 'A pessoa já precisa ter conta no MyCarsHub.';
      case 'change':
        return t?.adminRole ? `Hoje: ${ADMIN_ROLE_LABEL[t.adminRole]}` : 'Hoje: sem papel';
      case 'revoke':
        return `${t?.name ?? 'Esta pessoa'} volta a ser um usuário comum.`;
      default:
        return t?.email ?? null;
    }
  });

  /** Diferença entre o papel atual e o escolhido, em linguagem do dono. */
  protected readonly diff = computed(() => {
    const from = this.target()?.adminRole ?? null;
    const to = this.role() as AdminRole | null;
    if (!to || to === from) return { gains: [] as string[], loses: [] as string[], keeps: [] as string[] };
    const before = new Set(from ? ROLE_ABILITIES[from] : []);
    const after = new Set(ROLE_ABILITIES[to]);
    return {
      gains: [...after].filter((a) => !before.has(a)),
      loses: [...before].filter((a) => !after.has(a)),
      keeps: [...after].filter((a) => before.has(a)),
    };
  });

  protected readonly canSubmit = computed(() => {
    if (this.busy() || !this.reason()) return false;
    switch (this.sheet()) {
      case 'grant':
        return !!this.picked() && !!this.role();
      case 'change':
        return !!this.role() && this.role() !== this.target()?.adminRole;
      case 'revoke':
        return this.confirmText().trim().toUpperCase() === REVOKE_WORD;
      default:
        return false;
    }
  });

  ngOnInit(): void {
    this.reload();
    this.query$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((term) => {
          if (term.trim().length < 2) {
            this.searching.set(false);
            return of([] as AdminUserListItem[]);
          }
          this.searching.set(true);
          return this.service.searchCandidates(term).pipe(catchError(() => of([] as AdminUserListItem[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => {
        this.searching.set(false);
        this.candidates.set(list);
      });
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.members.set(list);
          this.loading.set(false);
        },
        error: (err) => {
          this.loadError.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os admins.'));
          this.loading.set(false);
        },
      });
  }

  protected isMe(m: AdminMember): boolean {
    return m.id === this.myId;
  }

  protected initials(name: string | null): string {
    const parts = (name ?? '?').trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '?';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  protected avatarTone(role: AdminRole | null): string {
    switch (role) {
      case 'OWNER':
        return 'bg-gradient-to-br from-primary-400 to-primary-700';
      case 'SUPPORT':
        return 'bg-gradient-to-br from-sky-400 to-sky-700';
      default:
        return 'bg-gradient-to-br from-neutral-400 to-neutral-600';
    }
  }

  protected lastAccess(m: AdminMember): string {
    const iso = m.lastSeenAt ?? m.lastLoginAt;
    if (!iso) return 'Nunca entrou';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Nunca entrou';
    return `Último acesso: ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  }

  // ---------- abrir / fechar ----------

  protected openGrant(): void {
    this.resetSheet();
    this.target.set(null);
    this.role.set('SUPPORT');
    this.reason.set('NEW_TEAM_MEMBER');
    this.sheet.set('grant');
  }

  protected openChange(m: AdminMember): void {
    if (this.isMe(m)) return;
    this.resetSheet();
    this.target.set(m);
    this.role.set(m.adminRole);
    this.reason.set('ROLE_CHANGE');
    this.sheet.set('change');
  }

  protected openRevoke(m: AdminMember): void {
    if (this.isMe(m)) return;
    this.resetSheet();
    this.target.set(m);
    this.reason.set('LEFT_TEAM');
    this.sheet.set('revoke');
  }

  /** Fecha com a animação de saída; o `closed` da folha zera o estado. */
  protected dismiss(force = false): void {
    const ref = this.sheetRef();
    if (ref) ref.requestClose(force);
    else this.sheet.set(null);
  }

  protected closeSheet(): void {
    this.sheet.set(null);
  }

  private resetSheet(): void {
    this.busy.set(false);
    this.sheetError.set(null);
    this.role.set(null);
    this.reason.set(null);
    this.confirmText.set('');
    this.query.set('');
    this.candidates.set([]);
    this.picked.set(null);
  }

  // ---------- conceder ----------

  protected onQuery(value: string): void {
    this.query.set(value);
    this.picked.set(null);
    this.query$.next(value);
  }

  protected pick(user: AdminUserListItem): void {
    this.picked.set(user);
  }

  // ---------- enviar ----------

  protected submit(): void {
    if (!this.canSubmit()) return;
    const reason = this.reason() as AdminRoleReason;
    const mode = this.sheet();
    this.busy.set(true);
    this.sheetError.set(null);

    const done = (message: string) => {
      this.busy.set(false);
      this.dismiss(true);
      this.notifications.success(message);
      this.reload();
    };
    const fail = (err: unknown) => {
      this.busy.set(false);
      this.sheetError.set(this.apiErrors.messageFor(err, 'Não foi possível salvar. Tente novamente.'));
    };

    if (mode === 'grant') {
      const user = this.picked()!;
      this.service
        .grant(user.id, this.role() as AdminRole, reason)
        .subscribe({ next: () => done(`${user.name ?? 'A pessoa'} agora é admin.`), error: fail });
    } else if (mode === 'change') {
      const t = this.target()!;
      this.service
        .changeRole(t.id, this.role() as AdminRole, reason)
        .subscribe({ next: () => done('Papel atualizado.'), error: fail });
    } else if (mode === 'revoke') {
      const t = this.target()!;
      this.service
        .revoke(t.id, reason)
        .subscribe({ next: () => done(`Acesso de admin de ${t.name ?? 'a pessoa'} removido.`), error: fail });
    }
  }
}
