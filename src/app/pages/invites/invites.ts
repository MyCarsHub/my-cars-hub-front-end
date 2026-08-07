import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { InvitesService } from '../../services/invites.service';
import { NotificationService } from '../../services/notification.service';
import { inviteErrorCopy } from '../../services/invite-errors';
import { InviteResponse, InviteRole, InviteStatus } from '../../types/invite.types';

const CREATE_FALLBACK = 'Não foi possível enviar o convite.';
const LIST_FALLBACK = 'Não foi possível carregar os convites.';

/** Statuses on which `resend` / `cancel` are accepted — anything else is a 400. */
const ACTIONABLE: ReadonlySet<InviteStatus> = new Set<InviteStatus>(['PENDING', 'EXPIRED']);

const STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'Aguardando',
  ACCEPTED: 'Aceito',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
  REVOKED: 'Cancelado',
};

const STATUS_CLASSES: Readonly<Record<string, string>> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  EXPIRED: 'bg-rose-50 text-rose-800 border-rose-200',
  CANCELLED: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  REVOKED: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  MANAGER: 'Gerente',
  DRIVER: 'Motorista',
  OWNER: 'Proprietário',
};

/** Row shape the template renders — labels and classes resolved off the hot path. */
interface InviteRow extends InviteResponse {
  statusLabel: string;
  statusClass: string;
  roleLabel: string;
  actionable: boolean;
  /** Accessible names — the visible labels are just "Reenviar" / "Cancelar", which
   *  would give every row in the list an identical, useless accessible name. */
  resendLabel: string;
  cancelLabel: string;
}

/**
 * Convites — the only route to this page is `/configuracoes/convites`, and the whole
 * `/configuracoes` subtree is `roleGuard(['OWNER'])` (parent and every child). So the
 * only role that reads this list, or sends, resends and cancels from it, is OWNER.
 * MANAGERs no longer invite anyone — an accepted product consequence, not a bug.
 *
 * Two backend facts drive this screen:
 *
 * - `role` may only be MANAGER or DRIVER. OWNER is rejected with a 400, so it is not
 *   offered at all.
 * - `resend` and `cancel` are keyed by the invite UUID. `GET /invites` never returns the
 *   raw token (by design), so the link itself can never be rebuilt here — resending is
 *   the only way to get a working link back to the invitee.
 *
 * Invites are valid for 24 hours. Do not write copy promising anything else.
 */
@Component({
  selector: 'app-invites',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FormField,
    FieldControl,
    ConfirmDialog,
  ],
  templateUrl: './invites.html',
})
export class Invites implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly invites = inject(InvitesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly loading = this.invites.loading;
  protected readonly loaded = this.invites.loaded;
  protected readonly pendingCount = this.invites.pendingCount;

  protected readonly listError = signal<string | null>(null);
  protected readonly createError = signal<string | null>(null);
  protected readonly sending = signal(false);
  /** Id of the invite whose row action is in flight — disables just that row. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly pendingCancel = signal<InviteRow | null>(null);

  protected readonly roles: ReadonlyArray<{ value: InviteRole; label: string }> = [
    { value: 'MANAGER', label: 'Gerente' },
    { value: 'DRIVER', label: 'Motorista' },
  ];

  protected readonly inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    role: ['DRIVER' as InviteRole, [Validators.required]],
  });

  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: 'Informe o e-mail de quem você quer convidar.',
    email: 'Informe um e-mail válido.',
    maxlength: 'O e-mail deve ter no máximo 255 caracteres.',
  };

  protected readonly rows = computed<InviteRow[]>(() =>
    this.invites.invites().map((invite) => ({
      ...invite,
      statusLabel: STATUS_LABELS[invite.status] ?? invite.status,
      statusClass: STATUS_CLASSES[invite.status] ?? STATUS_CLASSES['CANCELLED'],
      roleLabel: ROLE_LABELS[invite.role] ?? invite.role,
      actionable: ACTIONABLE.has(invite.status),
      resendLabel: `Reenviar convite para ${invite.email}`,
      cancelLabel: `Cancelar convite de ${invite.email}`,
    })),
  );

  protected readonly isEmpty = computed(() => this.loaded() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.listError.set(null);
    this.invites.list().subscribe({
      error: (err: HttpErrorResponse) => this.listError.set(this.messageFor(err, LIST_FALLBACK)),
    });
  }

  protected send(): void {
    if (this.sending()) return;

    clearServerErrors(this.inviteForm);
    this.createError.set(null);

    // Normalise BEFORE validating. `Validators.email` matches the raw value, so the
    // trailing space that mobile keyboards append after an address would fail the field
    // with "e-mail inválido" on a perfectly good address. Writing the trimmed value back
    // into the control also keeps what the user sees identical to what is sent.
    const emailControl = this.inviteForm.controls.email;
    const trimmed = (emailControl.value ?? '').trim();
    if (trimmed !== emailControl.value) {
      emailControl.setValue(trimmed);
    }

    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    const raw = this.inviteForm.getRawValue();
    this.sending.set(true);

    this.invites
      .create({ email: raw.email ?? '', role: raw.role ?? 'DRIVER' })
      .subscribe({
        next: (invite) => {
          this.sending.set(false);
          this.inviteForm.reset({ email: '', role: 'DRIVER' });
          this.notifications.success(`Convite enviado para ${invite.email}.`);
        },
        error: (err: HttpErrorResponse) => {
          this.sending.set(false);
          this.handleCreateError(err);
        },
      });
  }

  protected resend(row: InviteRow): void {
    if (this.busyId()) return;
    this.busyId.set(row.id);
    this.listError.set(null);

    this.invites.resend(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success(`Convite reenviado para ${row.email}.`);
        // `expiresAt` moved on the server — re-read instead of guessing the new deadline.
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.busyId.set(null);
        this.listError.set(this.messageFor(err, 'Não foi possível reenviar o convite.'));
      },
    });
  }

  protected askCancel(row: InviteRow): void {
    this.pendingCancel.set(row);
  }

  protected dismissCancel(): void {
    this.pendingCancel.set(null);
  }

  protected confirmCancel(): void {
    const row = this.pendingCancel();
    if (!row) return;

    this.pendingCancel.set(null);
    this.busyId.set(row.id);
    this.listError.set(null);

    this.invites.cancel(row.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.notifications.success(`Convite de ${row.email} cancelado.`);
      },
      error: (err: HttpErrorResponse) => {
        this.busyId.set(null);
        this.listError.set(this.messageFor(err, 'Não foi possível cancelar o convite.'));
      },
    });
  }

  /**
   * 400 carries `fieldErrors` (invalid or blank e-mail, unsupported role) and belongs
   * inline on the control. 403 / 409 / 410 / 429 have no field to attach to, so the
   * invite-specific copy goes to the banner.
   *
   * 403 is also toasted by `errorInterceptor` as a bare "Acesso negado" — the banner is
   * kept anyway because that toast never says WHICH permission is missing or who can
   * grant it. The OWNER-only `roleGuard` on the route does not make a 403 unreachable:
   * the backend remains the authority and can reject on its own terms — a role revoked
   * or a tenant switched mid-session, a plan rule, an invite already resolved elsewhere.
   */
  private handleCreateError(err: HttpErrorResponse): void {
    const specific = inviteErrorCopy(err, 'manage');
    if (specific) {
      this.apiErrors.claim(err);
      this.createError.set(specific);
      return;
    }
    const result = this.apiErrors.handleForm(err, this.inviteForm, CREATE_FALLBACK);
    this.createError.set(result.formMessage);
  }

  private messageFor(err: HttpErrorResponse, fallback: string): string {
    this.apiErrors.claim(err);
    return inviteErrorCopy(err, 'manage') ?? this.apiErrors.messageFor(err, fallback);
  }
}
