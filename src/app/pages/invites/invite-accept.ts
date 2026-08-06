import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../services/api-error.service';
import { AuthService } from '../../services/auth.service';
import { InvitesService } from '../../services/invites.service';
import { LoginService } from '../../services/loginService';
import { SessionService } from '../../services/session.service';
import { inviteErrorCopy } from '../../services/invite-errors';
import { ValidateInviteResponse } from '../../types/invite.types';
import { PENDING_INVITE_TOKEN_KEY } from './invite-session';

type AcceptStep = 'validating' | 'ready' | 'accepting' | 'error';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  MANAGER: 'Gerente',
  DRIVER: 'Motorista',
  OWNER: 'Proprietário',
};

/**
 * Public landing page for the invitation e-mail.
 *
 * The link the backend mails is `{frontendUrl}/invite/accept?token={rawToken}` — this
 * component's route MUST keep that exact shape, path and query-param name included, or
 * every invitation already sent lands on a 404.
 *
 * Flow, in the order the backend was designed for:
 *
 *   1. `GET /invites/validate/{token}` — anonymous, so the invitee sees WHICH company
 *      invited them before being asked to log in.
 *   2. Google login. The raw token is stashed in sessionStorage first; `OauthSuccess`
 *      reads it back and returns here instead of going to the dashboard.
 *   3. `POST /invites/accept/{token}` with the fresh (TEMPORALLY) token.
 *   4. The response carries a company-scoped ACCESS token, which is persisted verbatim.
 *
 * Step 4 deliberately does NOT call `/auth/select-company` nor `/auth/me`: the accept
 * response is already scoped to the right company, while `/auth/me` would (a) pick an
 * OWNER company first and silently drop the invitee into the wrong tenant, and (b) be
 * subject to the read-your-writes lag documented in `AuthService.writeSession`.
 *
 * Lives OUTSIDE the authenticated shell — its whole point is being reachable logged out.
 */
@Component({
  selector: 'app-invite-accept',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, RouterLink, AlertBanner],
  templateUrl: './invite-accept.html',
})
export class InviteAccept implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invites = inject(InvitesService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);
  private readonly loginService = inject(LoginService);
  private readonly apiErrors = inject(ApiErrorService);

  private token = '';

  protected readonly step = signal<AcceptStep>('validating');
  protected readonly details = signal<ValidateInviteResponse | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly redirecting = signal(false);

  protected readonly companyName = computed(() => this.details()?.companyName ?? '');
  protected readonly invitedEmail = computed(() => this.details()?.email ?? '');
  protected readonly roleLabel = computed(() => {
    const role = this.details()?.role;
    return role ? (ROLE_LABELS[role] ?? role) : '';
  });

  /** Returning users "entram"; brand-new ones are really creating an account. */
  protected readonly ctaLabel = computed(() =>
    this.details()?.userExists ? 'Entrar com o Google' : 'Criar conta com o Google',
  );

  /**
   * A validated invite that failed on accept is recoverable by logging in as the invited
   * e-mail — the usual cause is being signed in as somebody else in this tab.
   */
  protected readonly canSwitchAccount = computed(
    () => this.step() === 'error' && this.details() !== null,
  );

  ngOnInit(): void {
    const token = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();

    if (!token) {
      this.errorMessage.set(
        'Link de convite inválido. Abra o link exatamente como ele chegou no seu e-mail.',
      );
      this.step.set('error');
      return;
    }

    this.token = token;
    // Re-stash on every entry: `SessionService.clear()` (logout, oauth-success) wipes it,
    // and the query param is the only place it survives for sure.
    this.session.setItem(PENDING_INVITE_TOKEN_KEY, token);

    this.invites.validate(token).subscribe({
      next: (details) => {
        this.details.set(details);
        // Coming back from Google there is already a token — finish without a second click.
        if (this.session.getToken()) {
          this.acceptInvite();
          return;
        }
        this.step.set('ready');
      },
      error: (err: unknown) =>
        this.fail(err, 'Não foi possível verificar este convite. Tente novamente.'),
    });
  }

  /** Stashes the token and hands the tab to Google. */
  protected continueWithGoogle(): void {
    if (this.redirecting()) return;
    this.redirecting.set(true);
    this.session.setItem(PENDING_INVITE_TOKEN_KEY, this.token);
    this.loginService.loginWithGoogle();
  }

  /** Drops the current (wrong) session and restarts the Google flow for this invite. */
  protected switchAccount(): void {
    if (this.redirecting()) return;
    this.auth.logout();
    this.continueWithGoogle();
  }

  private acceptInvite(): void {
    this.step.set('accepting');
    this.errorMessage.set(null);

    this.invites.accept(this.token).subscribe({
      next: (response) => {
        this.session.removeItem(PENDING_INVITE_TOKEN_KEY);
        // Same session writes as the onboarding finish: ACCESS token + the selected
        // tenant + the onboarding flag, so `authGuard` lets /dashboard through without
        // an /auth/me round trip.
        this.auth.applyFinishResponse(response);
        // The invited address is the account's address; nothing else here knows it and
        // the shell would otherwise render an empty identity until the next login.
        const email = this.details()?.email;
        if (email) this.session.setItem('email', email);
        // The cache belongs to whatever tenant was open before this accept.
        this.invites.reset();
        this.router.navigate(['/dashboard'], { replaceUrl: true });
      },
      error: (err: unknown) =>
        this.fail(err, 'Não foi possível aceitar este convite. Tente novamente.'),
    });
  }

  /**
   * Invite-specific copy wins (410 expired, 409 already used, 403 wrong account, 429 rate
   * limited); anything else falls back to the shared extractor. Claiming first keeps the
   * `errorInterceptor` safety-net toast from duplicating what the banner already says.
   */
  private fail(err: unknown, fallback: string): void {
    this.apiErrors.claim(err);
    this.errorMessage.set(inviteErrorCopy(err, 'accept') ?? this.apiErrors.messageFor(err, fallback));
    this.step.set('error');
  }
}
