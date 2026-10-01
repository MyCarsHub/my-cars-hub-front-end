import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyMembersService } from '../../../services/company-members.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import { CompanyMemberResponse } from '../../../types/company-member.types';
import { companyRoleLabel } from '../../../utils/role-labels';

/** One roster line, with the removability decision already made. */
interface MemberRow {
  userId: string;
  name: string;
  email: string;
  roleLabel: string;
  memberSince: string;
  /** `true` when this screen offers a Remove button for this row. */
  removable: boolean;
  /** Why the button is absent — rendered in its place, so the absence is explained. */
  lockedReason: string;
  removeLabel: string;
}

/**
 * Membros — who currently reaches this company, and the one destructive action on them.
 *
 * ## The roster has no "situation" column, on purpose
 *
 * `GET /v1/companies/{companyId}/members` returns ACTIVE memberships ONLY, and
 * `CompanyMemberDto` carries no `status` field. A situation column would print the same
 * word on every line. Whoever is still INVITED lives in the Convites screen.
 *
 * ## Removal writes REMOVED; it does not delete
 *
 * The backend sets `status = 'REMOVED'` and KEEPS the row, because dropping it would let an
 * already-signed token go on being valid. So removal is undone by re-inviting, and the copy
 * says the person loses access — never that anything was erased.
 *
 * ## Which rows this screen refuses to offer, and why it mirrors the backend
 *
 * The backend rules (`CompanyMemberService.removeMember`) are three:
 *
 * - a MANAGER does not remove an OWNER;
 * - an OWNER is not removable by ANOTHER member — not even by another OWNER;
 * - the last ACTIVE OWNER cannot leave, not even voluntarily (409).
 *
 * Read together, an OWNER row is never removable by someone else, and the only case the API
 * would accept is an OWNER removing THEMSELVES while a second active OWNER exists. This
 * screen does not offer that one either: there is no ownership transfer in this product —
 * the only writer of OWNER is onboarding, and an invite never grants ownership — so a
 * company that loses its owner cannot get one back. That is a product decision; the
 * backend's 409 remains the real guarantee underneath, and `removeMessage` still handles it
 * in case the API is reached another way.
 *
 * The rule the template follows: never offer Remove on an OWNER row, and never on your own
 * row. Each carries a written reason instead of a silently missing button.
 */
@Component({
  selector: 'app-company-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DefaultPageLayout, PageCard, AlertBanner, ConfirmDialog],
  templateUrl: './members.html',
})
export class CompanyMembers implements OnInit {
  private readonly members = inject(CompanyMembersService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly loading = this.members.loading;
  protected readonly loaded = this.members.loaded;
  protected readonly memberCount = this.members.memberCount;

  protected readonly listError = signal<string | null>(null);
  /** Id of the row whose removal is in flight — disables just that row. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly pendingRemoval = signal<MemberRow | null>(null);

  /**
   * Who may manage members, read from the TOKEN — the same source as `roleGuard`.
   *
   * This is NOT the defence: the backend answers 403 to a DRIVER regardless
   * (`FORBIDDEN_MEMBER_MANAGEMENT`). It exists because the route that will carry this
   * screen is not registered yet, so without an in-component gate a DRIVER who reached the
   * component would watch the list call fail with a raw error instead of being told plainly
   * that the screen is not theirs. When the route lands with
   * `roleGuard(['OWNER', 'MANAGER'])`, this stays as the second barrier.
   */
  protected readonly canManageMembers = computed(() => {
    const role = this.session.getCompanyRoleFromToken();
    return role === 'OWNER' || role === 'MANAGER';
  });

  protected readonly isEmpty = computed(() => this.loaded() && this.members.members().length === 0);

  protected readonly rows = computed<MemberRow[]>(() => {
    const myId = this.session.getItem('id');
    return this.members.members().map((member) => this.toRow(member, myId));
  });

  ngOnInit(): void {
    if (!this.canManageMembers()) {
      return;
    }
    this.load();
  }

  protected load(): void {
    this.listError.set(null);
    this.members.list().subscribe({
      error: (error: HttpErrorResponse) => this.listError.set(this.listMessage(error)),
    });
  }

  protected askRemove(row: MemberRow): void {
    if (!row.removable) {
      return;
    }
    this.pendingRemoval.set(row);
  }

  protected dismissRemove(): void {
    this.pendingRemoval.set(null);
  }

  protected confirmRemove(): void {
    const row = this.pendingRemoval();
    if (!row) {
      return;
    }
    this.pendingRemoval.set(null);
    this.busyId.set(row.userId);
    this.listError.set(null);
    this.members.remove(row.userId).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success(row.name + ' perdeu o acesso a esta empresa.');
      },
      error: (error: HttpErrorResponse) => {
        this.busyId.set(null);
        this.listError.set(this.removeMessage(error, row));
      },
    });
  }

  private toRow(member: CompanyMemberResponse, myId: string | null): MemberRow {
    const isSelf = myId !== null && myId === member.userId;
    const isOwner = member.role === 'OWNER';
    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      roleLabel: companyRoleLabel(member.role),
      memberSince: member.memberSince,
      removable: !isSelf && !isOwner,
      lockedReason: this.lockedReason(isSelf, isOwner),
      removeLabel: 'Remover acesso de ' + member.name,
    };
  }

  /** Empty string when the row IS removable — the template renders nothing in that case. */
  private lockedReason(isSelf: boolean, isOwner: boolean): string {
    if (isSelf && isOwner) {
      return 'Você é o dono desta empresa e não pode remover o seu próprio acesso.';
    }
    if (isSelf) {
      return 'Você não pode remover o seu próprio acesso.';
    }
    if (isOwner) {
      return 'O acesso do dono da empresa não pode ser removido aqui.';
    }
    return '';
  }

  private listMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return 'Só o dono e os gerenciadores podem ver quem tem acesso a esta empresa.';
    }
    if (error.status === 404) {
      return 'Empresa não encontrada para esta sessão. Entre novamente e tente de novo.';
    }
    return this.apiErrors.messageFor(error, 'Não foi possível carregar quem tem acesso.');
  }

  /**
   * The three outcomes a removal really has, each with its own sentence.
   *
   * The 404 is deliberately ambiguous on the backend — it covers a nonexistent user, a
   * member of another company, and a link that is ALREADY removed, indistinguishably. So
   * this copy must not claim which one happened: it says the access is no longer there and
   * asks for a refresh, which is true in all three.
   */
  private removeMessage(error: HttpErrorResponse, row: MemberRow): string {
    if (error.status === 403) {
      return 'Você não tem permissão para remover o acesso de ' + row.name + '.';
    }
    if (error.status === 409) {
      return 'Esta empresa ficaria sem dono. Não é possível remover o último dono.';
    }
    if (error.status === 404) {
      return row.name + ' já não tem acesso a esta empresa. Atualize a lista.';
    }
    return this.apiErrors.messageFor(error, 'Não foi possível remover o acesso.');
  }
}
