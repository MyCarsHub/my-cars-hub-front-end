import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  catchError,
  filter,
  forkJoin,
  fromEvent,
  map,
  merge,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { LayoutStore } from '../../../components/core/layouts/layout.store';
import { PageCard } from '../../../components/core/page-card/page-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { CompanyMembersService } from '../../../services/company-members.service';
import { InviteShareService } from '../../../services/invite-share.service';
import { InvitesService } from '../../../services/invites.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import { INVITE_TTL_LABEL, InviteResponse } from '../../../types/invite.types';
import { InviteLinkSheet } from './invite-link-sheet';
import { InviteSheet } from './invite-sheet';
import {
  ACCESS_OPTIONS,
  AccessFilter,
  InviteRow,
  MemberRow,
  PersonRow,
  ROLE_CHANGE_NOTE,
  STATUS_OPTIONS,
  StatusFilter,
  canManageInvites,
  filterPeople,
  hasAnyFilter,
  inviteActionMessage,
  inviteRows,
  listMessage,
  memberRows,
  peopleRows,
  removeMessage,
  resultsLabel,
} from './members.model';
import { MembersIcon } from './members-icon';
import { MembersKpis } from './members-kpis';
import { PeopleTable } from './people-table';
import { PersonCard } from './person-card';
import { RowActionsSheet, RowActionsTarget } from './row-actions-sheet';

/** What the person asked to do with the NEW link once the invite is resent. */
type ShareMode = 'copy' | 'whatsapp';

/** The link of a resent invite while its sheet is open. Dropped the moment it closes. */
interface SharedLink {
  link: string;
  recipient: string;
  companyName: string | null;
}

/**
 * How often the list re-reads itself while the tab is visible and an invite is still
 * waiting to be accepted. Acceptance happens on another device, so nothing on this screen
 * tells it that a person arrived: the poll is what moves a pending invite into the roster.
 */
export const MEMBERS_AUTO_REFRESH_MS = 15_000;

/**
 * Pessoas da empresa (`/configuracoes/membros`): who has access and who was invited, in ONE
 * list with search and filters, from the two existing sources — the roster (`GET /members`,
 * ACTIVE only) and `GET /invites`. No new endpoint.
 *
 * This component only orchestrates: it loads, holds the screen state (including the list
 * filters, client-side over the rows already loaded) and runs the actions. Every rule about
 * who may do what, and the filter logic, is in `members.model.ts`; every piece of markup is
 * in a child (card on phones, table on desktop, sheets for actions, filters and the invite).
 */
@Component({
  selector: 'app-company-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    ConfirmDialog,
    MembersIcon,
    MembersKpis,
    PersonCard,
    PeopleTable,
    RowActionsSheet,
    InviteSheet,
    InviteLinkSheet,
  ],
  templateUrl: './members.html',
})
export class CompanyMembers implements OnInit {
  private readonly members = inject(CompanyMembersService);
  private readonly invites = inject(InvitesService);
  private readonly session = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly share = inject(InviteShareService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /** The app's single breakpoint source (< 1024px): cards + sheets vs table + menus. */
  protected readonly isMobile = inject(LayoutStore).isMobile;

  /** Caller's role, from the TOKEN — the same source as `roleGuard`. */
  private readonly callerRole = this.session.getCompanyRoleFromToken();
  /**
   * Third barrier, not the first: the route has `roleGuard(['OWNER', 'MANAGER'])` and the
   * backend answers 403 to a driver. It earns its place by what it RENDERS — a sentence
   * instead of two failing calls.
   */
  protected readonly canManagePeople =
    this.callerRole === 'OWNER' || this.callerRole === 'MANAGER';
  /** A manager invites a manager exactly like the owner: invites are the same power. */
  protected readonly canInviteManager = canManageInvites(this.callerRole);

  /** List filters: client-side, kept in signals (the URL is not touched). */
  protected readonly query = signal('');
  protected readonly access = signal<AccessFilter>('');
  protected readonly status = signal<StatusFilter>('');
  protected readonly accessOptions = ACCESS_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  /** Id of the row with an action in flight — locks every row action meanwhile. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionsTarget = signal<RowActionsTarget | null>(null);
  protected readonly pendingRemoval = signal<MemberRow | null>(null);
  protected readonly pendingCancel = signal<InviteRow | null>(null);
  /** "Copiar link" / "Enviar pelo WhatsApp" waiting for the OK: the old link dies. */
  protected readonly pendingShare = signal<{ row: InviteRow; mode: ShareMode } | null>(null);
  /** Set only when the copy / WhatsApp could not be done by the page itself. */
  protected readonly sharedLink = signal<SharedLink | null>(null);
  protected readonly inviteOpen = signal(false);

  protected readonly roleChangeNote = ROLE_CHANGE_NOTE;
  protected readonly ttlLabel = INVITE_TTL_LABEL;
  protected readonly shareConfirmMessage =
    'Vamos gerar um novo link. O link anterior deixa de valer e o convidado recebe o e-mail de novo.';

  protected readonly membersLoaded = this.members.loaded;
  protected readonly invitesLoaded = this.invites.loaded;
  protected readonly loading = computed(() => this.members.loading() || this.invites.loading());
  protected readonly initialLoading = computed(
    () => this.loading() && !this.membersLoaded() && !this.invitesLoaded(),
  );

  protected readonly memberRows = computed(() =>
    memberRows(this.members.members(), this.session.getUserId()),
  );
  protected readonly inviteRows = computed(() =>
    inviteRows(this.invites.invites(), this.members.members(), this.callerRole, Date.now()),
  );

  /** Everyone with access: the whole company, whatever the filters say. */
  protected readonly totalCount = computed(() => this.members.members().length);
  protected readonly managementCount = computed(
    () => this.members.members().filter((m) => m.role === 'OWNER' || m.role === 'MANAGER').length,
  );
  protected readonly driversCount = computed(
    () => this.members.members().filter((m) => m.role === 'DRIVER').length,
  );
  /** PENDING only: an expired invite was sent too, but it is not waiting any more. */
  protected readonly pendingInvitesCount = computed(
    () => this.invites.invites().filter((i) => i.status === 'PENDING').length,
  );

  /** Expired invites still waiting to be resent (the list's own rows, so the numbers agree). */
  protected readonly expiredInvitesCount = computed(
    () => this.inviteRows().filter((r) => r.expired).length,
  );

  /** Everyone, in order: you, members by name, expired invites, pending invites. */
  protected readonly people = computed(() => peopleRows(this.memberRows(), this.inviteRows()));
  private readonly filters = computed(() => ({
    query: this.query(),
    access: this.access(),
    status: this.status(),
  }));
  /** The alone-in-the-company page has no filters on screen, so nothing may hide its one row. */
  protected readonly visiblePeople = computed(() =>
    this.isEmpty() ? this.people() : filterPeople(this.people(), this.filters()),
  );
  protected readonly anyFilter = computed(() => hasAnyFilter(this.filters()));
  protected readonly resultsText = computed(() => resultsLabel(this.visiblePeople().length));

  /** Nobody else and nothing pending: the page is an invitation to invite. */
  protected readonly isEmpty = computed(
    () =>
      this.membersLoaded() &&
      this.invitesLoaded() &&
      this.memberRows().length <= 1 &&
      this.inviteRows().length === 0,
  );

  ngOnInit(): void {
    if (!this.canManagePeople) return;
    this.load();
    this.watchForChanges();
  }

  /** Reloads BOTH sources: the screen is a join, half a refresh would mix old and new. */
  protected load(): void {
    this.loadError.set(null);
    this.actionError.set(null);
    this.members.list().subscribe({ error: (e: HttpErrorResponse) => this.failLoad(e) });
    this.invites.list().subscribe({ error: (e: HttpErrorResponse) => this.failLoad(e) });
  }

  // ------------------------------------------------------------------ auto refresh

  /**
   * The list keeps itself current, so the screen has no refresh button:
   *  - every `MEMBERS_AUTO_REFRESH_MS` while the tab is visible AND at least one invite is
   *    PENDING (nothing can be accepted otherwise, so a quiet screen makes no requests);
   *  - once whenever the tab comes back to the foreground (visibility or window focus).
   * Both stop with the component (`takeUntilDestroyed`). The timer lives inside a
   * `switchMap` on visibility, so a hidden tab holds no timer at all.
   */
  private watchForChanges(): void {
    if (!this.isBrowser) return;
    const doc = this.document;
    const win = doc.defaultView;

    const visibility$ = fromEvent(doc, 'visibilitychange').pipe(
      map(() => !doc.hidden),
      startWith(!doc.hidden),
    );

    visibility$
      .pipe(
        switchMap((visible) =>
          visible ? timer(MEMBERS_AUTO_REFRESH_MS, MEMBERS_AUTO_REFRESH_MS) : EMPTY,
        ),
        filter(() => this.pendingInvitesCount() > 0),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.refreshQuietly());

    merge(
      fromEvent(doc, 'visibilitychange').pipe(filter(() => !doc.hidden)),
      win ? fromEvent(win, 'focus') : EMPTY,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshQuietly());
  }

  /**
   * Background re-read of BOTH sources: no skeleton (the lists are already loaded, so
   * `initialLoading` stays false), no toast, and a failure is dropped — the rows on screen
   * are still the last good ones and the next tick tries again. It yields to a row action in
   * flight and to a read already under way, so it never races the person's own request.
   * The load error banner is cleared only when BOTH reads came back.
   */
  private refreshQuietly(): void {
    if (this.busyId() !== null || this.loading()) return;
    try {
      forkJoin([
        this.members.list().pipe(catchError(() => of(null))),
        this.invites.list().pipe(catchError(() => of(null))),
      ])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(([roster, invites]) => {
          if (roster !== null && invites !== null) this.loadError.set(null);
        });
    } catch {
      // No active company in the token: `list()` throws before it can return an Observable.
    }
  }

  // ------------------------------------------------------------------ filters

  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onAccessChange(event: Event): void {
    this.access.set((event.target as HTMLSelectElement).value as AccessFilter);
  }

  protected onStatusChange(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as StatusFilter);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.access.set('');
    this.status.set('');
  }

  // ------------------------------------------------------------------ row actions

  /** Phone kebab: the sheet is keyed by what the row IS (member or invite). */
  protected openPerson(person: PersonRow): void {
    if (person.member) this.openActions({ kind: 'member', row: person.member });
    else if (person.invite) this.openActions({ kind: 'invite', row: person.invite });
  }

  protected openActions(target: RowActionsTarget): void {
    if (this.busyId() !== null) return;
    this.actionsTarget.set(target);
  }

  protected closeActions(): void {
    this.actionsTarget.set(null);
  }

  protected askRemove(row: MemberRow): void {
    this.actionsTarget.set(null);
    if (!row.canRemove || this.busyId() !== null) return;
    this.pendingRemoval.set(row);
  }

  protected askShare(row: InviteRow, mode: ShareMode): void {
    this.actionsTarget.set(null);
    if (!row.canAct || this.busyId() !== null) return;
    this.pendingShare.set({ row, mode });
  }

  protected askCancel(row: InviteRow): void {
    this.actionsTarget.set(null);
    if (!row.canAct || this.busyId() !== null) return;
    this.pendingCancel.set(row);
  }

  protected confirmRemove(): void {
    const row = this.pendingRemoval();
    if (!row) return;
    this.pendingRemoval.set(null);
    this.busyId.set(row.id);
    this.actionError.set(null);
    this.members.remove(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success(row.name + ' perdeu o acesso a esta empresa.');
      },
      error: (error: HttpErrorResponse) => {
        this.busyId.set(null);
        this.actionError.set(
          removeMessage(error, row, () => this.apiErrors.messageFor(error, 'Não foi possível remover o acesso.')),
        );
      },
    });
  }

  protected confirmCancel(): void {
    const row = this.pendingCancel();
    if (!row) return;
    this.pendingCancel.set(null);
    this.busyId.set(row.id);
    this.actionError.set(null);
    this.invites.cancel(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success('O convite de ' + row.title + ' foi cancelado.');
      },
      error: (error: HttpErrorResponse) => this.failInviteAction(error, row),
    });
  }

  /**
   * No confirmation, but the toast says what changed: resending ROTATES the token, so the
   * link the person may already have stopped working. Then RE-READ the invites — the server
   * moved `expiresAt`, and a stale "Expirado" invites a second resend that burns one of the
   * three allowed and kills the link again.
   */
  protected resend(row: InviteRow): void {
    this.actionsTarget.set(null);
    if (!row.canAct || this.busyId() !== null) return;
    this.busyId.set(row.id);
    this.actionError.set(null);
    this.invites.resend(row.id).subscribe({
      next: () => this.afterResend(row),
      error: (error: HttpErrorResponse) => this.failInviteAction(error, row),
    });
  }

  /**
   * "Copiar link" / "Enviar pelo WhatsApp" on an existing row, after the OK.
   *
   * The list never has a link (the token is not stored), so the ONLY way to get one is to
   * resend — which rotates the token and mails the person again. That is why this goes
   * through a confirmation and then through the SAME resend path: same busy lock, same
   * ceiling / 410 / 404 / 409 copy, same re-read of the list.
   *
   * With the new link in hand the page tries the action itself. Browsers only honour a
   * clipboard write or a new tab inside a user gesture, and a request in between may have
   * used it up — so when the attempt is refused the link goes to a sheet whose buttons are
   * a fresh tap. If the answer has no link at all (an older backend) it degrades to the
   * plain resend toast.
   */
  protected confirmShare(): void {
    const pending = this.pendingShare();
    if (!pending) return;
    this.pendingShare.set(null);
    const { row, mode } = pending;
    this.busyId.set(row.id);
    this.actionError.set(null);
    this.invites.resend(row.id).subscribe({
      next: (response) => {
        const link = response?.acceptUrl?.trim();
        if (!link) {
          this.afterResend(row);
          return;
        }
        this.busyId.set(null);
        this.invites.list().subscribe({ error: (e: HttpErrorResponse) => this.failLoad(e) });
        void this.deliver(row, link, mode);
      },
      error: (error: HttpErrorResponse) => this.failInviteAction(error, row),
    });
  }

  protected closeSharedLink(): void {
    this.sharedLink.set(null);
  }

  private afterResend(row: InviteRow): void {
    this.busyId.set(null);
    this.notifications.success(
      'Novo convite enviado para ' + row.title + '. O link anterior deixou de valer.',
    );
    this.invites.list().subscribe({ error: (e: HttpErrorResponse) => this.failLoad(e) });
  }

  private async deliver(row: InviteRow, link: string, mode: ShareMode): Promise<void> {
    const company = this.session.getItem('selectedCompanyName')?.trim() || null;
    const done =
      mode === 'copy' ? await this.share.copy(link) : this.share.openWhatsApp(link, company);
    if (!done) {
      this.sharedLink.set({ link, recipient: row.title, companyName: company });
      return;
    }
    this.notifications.success(
      mode === 'copy' ? 'Link copiado' : 'WhatsApp aberto com o novo link de ' + row.title + '.',
    );
  }

  // ------------------------------------------------------------------ invite

  protected openInvite(): void {
    this.inviteOpen.set(true);
  }

  protected closeInvite(): void {
    this.inviteOpen.set(false);
  }

  /**
   * Confirm, drop the filters (the new invite must not hide behind a Status or
   * search the person set earlier) and re-read the invites only (roster unchanged).
   * The sheet is NOT closed here: it closes itself when there is no link to show, and stays
   * on its "sent" step when there is one.
   */
  protected onInviteSent(invite: InviteResponse): void {
    this.notifications.success(`Convite enviado para «${invite.email}».`);
    this.clearFilters();
    this.invites.list().subscribe({ error: (e: HttpErrorResponse) => this.failLoad(e) });
  }

  // ------------------------------------------------------------------ errors

  private failLoad(error: HttpErrorResponse): void {
    this.loadError.set(
      listMessage(
        error,
        () => this.apiErrors.messageFor(error, 'Não foi possível carregar os membros agora.'),
      ),
    );
  }

  private failInviteAction(error: HttpErrorResponse, row: InviteRow): void {
    this.busyId.set(null);
    // 400 from the resend ceiling carries the server sentence, which names the limit.
    this.actionError.set(
      inviteActionMessage(
        error,
        row,
        () => this.apiErrors.messageFor(error, 'Não foi possível concluir a ação neste convite.'),
      ),
    );
  }
}
