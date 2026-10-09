import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOCUMENT, NgOptimizedImage } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { AuthService } from '../../services/auth.service';
import { InviteFlowService } from '../../services/invite-flow.service';
import {
  INVITE_UNREACHABLE_COPY,
  attemptsLeftCopy,
  inviteAcceptProblemCopy,
  inviteAttemptsLeft,
  inviteFlowErrorCode,
} from '../../services/invite-flow-errors';
import { InviteOnboardingTokenStore } from '../../services/invite-onboarding-token.store';
import { LoginService } from '../../services/loginService';
import { SessionService } from '../../services/session.service';
import { InviteValidateResponse } from '../../types/invite-flow.types';
import { applyMaskedDocumentInput, cpfShapeValidator, maskCpf, normalizeCpf } from '../../utils/document-mask';
import { cpfValidator } from '../../utils/validators/cpf.validator';
import { INVITE_RESUME_STATE_KEY, PENDING_INVITE_TOKEN_KEY } from '../invites/invite-session';

/**
 * How long the backend locks an invite after too many wrong CPFs. Mirrors the backend; no
 * endpoint exposes it, so the copy reads it from here instead of retyping the number.
 */
export const INVITE_LOCK_MINUTES = 30;

type LandingView =
  | 'loading'
  | 'form'
  | 'existing'
  | 'joining'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'not-found'
  | 'no-token'
  | 'unreachable'
  | 'problem'
  | 'driver-soon';

/**
 * Public page of the invitation e-mail link: `/convite` (the old `/invite/accept` redirects
 * here). Lives OUTSIDE the authenticated shell - it is reachable logged out by design.
 *
 * Flow:
 *  1. The token is read from `?token=` (or a `#token=` fragment), stashed in sessionStorage
 *     and REMOVED from the address bar at once, so it never sits in history or a screenshot.
 *  2. `POST /invites/validate` decides the screen (PENDING new / PENDING existing / terminal).
 *  3. New account: the invitee types the CPF and `POST /invites/accept` returns an
 *     ONBOARDING token, parked in its own slot (never the normal auth slot).
 *  4. Existing account: Google login, then `OauthSuccess` returns here with the resume flag
 *     and this page calls `accept-as-member` with the stored token.
 */
@Component({
  selector: 'app-invite-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, RouterLink, AlertBanner, ReactiveFormsModule, FormField, FieldControl],
  templateUrl: './invite-landing.html',
})
export class InviteLanding implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly flow = inject(InviteFlowService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);
  private readonly loginService = inject(LoginService);
  private readonly onboardingToken = inject(InviteOnboardingTokenStore);

  private token = '';

  /**
   * Captured at construction: the component is created while the navigation that carries the
   * flag is still in flight, and `ngOnInit` runs after it has completed.
   */
  private readonly resumed = this.resumedFromGoogle();

  protected readonly view = signal<LandingView>('loading');
  protected readonly details = signal<InviteValidateResponse | null>(null);
  protected readonly submitting = signal(false);
  protected readonly redirecting = signal(false);
  protected readonly locked = signal(false);
  protected readonly attemptsLeft = signal<number | null>(null);
  protected readonly problemMessage = signal('');
  /** Set when the member join failed in a way a different Google account fixes. */
  protected readonly canSwitchAccount = signal(false);

  protected readonly lockMinutes = INVITE_LOCK_MINUTES;
  protected readonly companyName = computed(() => this.details()?.companyName ?? '');
  protected readonly roleLabel = computed(() => this.details()?.roleLabel ?? '');
  protected readonly inviterName = computed(() => this.details()?.inviterName?.trim() ?? '');

  protected readonly cpf = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, cpfShapeValidator(), cpfValidator()],
  });

  protected readonly cpfMessages = computed<Readonly<Record<string, string>>>(() => {
    const left = this.attemptsLeft();
    return {
      required: 'Informe seu CPF.',
      cpfShape: 'Faltou algum número do CPF. Confira os 11 dígitos do seu documento.',
      cpfInvalid: 'Esse CPF não confere. Confira os números no seu documento.',
      cpfMismatch:
        'Este CPF não confere com o convite.' + (left !== null ? ` ${attemptsLeftCopy(left)}` : ''),
    };
  });

  ngOnInit(): void {
    const fromUrl = this.tokenFromUrl();

    if (fromUrl) {
      // Re-stash on every entry: `SessionService.clear()` wipes it and the URL is the only
      // place the token survives for sure.
      this.session.setItem(PENDING_INVITE_TOKEN_KEY, fromUrl);
      this.stripTokenFromUrl();
    }

    const token = fromUrl ?? (this.session.getItem(PENDING_INVITE_TOKEN_KEY) ?? '').trim();
    if (!token) {
      this.view.set('no-token');
      return;
    }
    this.token = token;
    this.validate(this.resumed);
  }

  protected retry(): void {
    this.validate(false);
  }

  protected onCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.cpf, maskCpf);
  }

  /** Native `submit`: this form has no `NgForm`, so there is no `ngSubmit` to listen to. */
  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    if (this.submitting() || this.locked()) return;
    if (this.cpf.invalid) {
      this.cpf.markAsTouched();
      return;
    }

    this.submitting.set(true);
    this.flow.accept(this.token, normalizeCpf(this.cpf.value)).subscribe({
      next: (response) => {
        this.submitting.set(false);
        // Its own slot, never the normal auth token: this credential only opens onboarding.
        this.onboardingToken.set(response.onboardingToken);
        this.session.removeItem(PENDING_INVITE_TOKEN_KEY);

        if (response.next === 'DRIVER_ONBOARDING') {
          this.view.set('driver-soon');
          return;
        }
        void this.router.navigate(['/convite/cadastro'], { replaceUrl: true });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.handleAcceptError(err);
      },
    });
  }

  /** Stashes the token and hands the tab to Google. */
  protected continueWithGoogle(): void {
    if (this.redirecting()) return;
    this.redirecting.set(true);
    this.session.setItem(PENDING_INVITE_TOKEN_KEY, this.token);
    this.loginService.loginWithGoogle();
  }

  /** Drops the wrong Google session and starts the Google flow again for this invite. */
  protected switchAccount(): void {
    if (this.redirecting()) return;
    this.auth.logout();
    this.continueWithGoogle();
  }

  private validate(resumed: boolean): void {
    this.view.set('loading');
    this.flow.validate(this.token).subscribe({
      next: (details) => {
        this.details.set(details);
        this.decide(details, resumed);
      },
      error: (err: unknown) => {
        if (inviteFlowErrorCode(err) === 'INVITE_NOT_FOUND') {
          this.view.set('not-found');
          return;
        }
        this.view.set('unreachable');
      },
    });
  }

  private decide(details: InviteValidateResponse, resumed: boolean): void {
    switch (details.state) {
      case 'EXPIRED':
        this.view.set('expired');
        return;
      case 'REVOKED':
        this.view.set('revoked');
        return;
      case 'USED':
        this.view.set('used');
        return;
      case 'PENDING':
        break;
    }

    if (details.accountKind !== 'EXISTING') {
      this.view.set('form');
      return;
    }
    // Back from Google with a session in this tab: finish without a second click.
    if (resumed && this.session.getToken()) {
      this.joinAsMember();
      return;
    }
    this.view.set('existing');
  }

  private joinAsMember(): void {
    this.view.set('joining');
    this.flow.acceptAsMember(this.token).subscribe({
      next: (response) => {
        this.flow.signIn(response.accessToken, { name: response.companyName, role: response.role });
        void this.router.navigate(['/dashboard'], { replaceUrl: true }).then((ok) => {
          // A guard refused: a full reload re-decides with the new token.
          if (!ok) this.document.defaultView?.location.assign('/');
        });
      },
      error: (err: unknown) => {
        const code = inviteFlowErrorCode(err);
        this.canSwitchAccount.set(
          code === 'INVITE_EMAIL_MISMATCH' || code === 'INVITE_GOOGLE_ACCOUNT_REQUIRED',
        );
        if (this.changeScreenFor(err)) return;
        this.showProblem(inviteAcceptProblemCopy(err, this.companyName()));
      },
    });
  }

  private handleAcceptError(err: unknown): void {
    switch (inviteFlowErrorCode(err)) {
      case 'INVITE_CPF_MISMATCH': {
        const left = inviteAttemptsLeft(err);
        if (left === 0) {
          this.locked.set(true);
          return;
        }
        this.attemptsLeft.set(left);
        this.cpf.setErrors({ cpfMismatch: true });
        this.cpf.markAsTouched();
        return;
      }
      case 'INVITE_CPF_INVALID':
        this.cpf.setErrors({ cpfInvalid: true });
        this.cpf.markAsTouched();
        return;
      case 'INVITE_REQUIRES_SIGN_IN':
        this.view.set('existing');
        return;
      default:
        if (this.changeScreenFor(err)) return;
        this.showProblem(inviteAcceptProblemCopy(err, this.companyName()));
    }
  }

  /** Errors that mean "this invite is in another state": the matching screen replaces the form. */
  private changeScreenFor(err: unknown): boolean {
    switch (inviteFlowErrorCode(err)) {
      case 'INVITE_LOCKED':
        this.locked.set(true);
        if (this.view() !== 'form') this.view.set('form');
        return true;
      case 'INVITE_EXPIRED':
        this.view.set('expired');
        return true;
      case 'INVITE_REVOKED':
        this.view.set('revoked');
        return true;
      case 'INVITE_ALREADY_USED':
        this.view.set('used');
        return true;
      case 'INVITE_NOT_FOUND':
        this.view.set('not-found');
        return true;
      default:
        return false;
    }
  }

  private showProblem(message: string): void {
    // A dead connection is retryable from the same screen; every other problem is terminal.
    this.problemMessage.set(message);
    this.view.set(message === INVITE_UNREACHABLE_COPY ? 'unreachable' : 'problem');
  }

  /** `?token=` first, then a `#token=` fragment (the backend may switch link mode later). */
  private tokenFromUrl(): string | null {
    const fromQuery = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();
    if (fromQuery) return fromQuery;
    const fragment = this.route.snapshot.fragment ?? '';
    const fromFragment = (new URLSearchParams(fragment).get('token') ?? '').trim();
    return fromFragment || null;
  }

  /** Replaces the history entry with the bare path: query and fragment both go. */
  private stripTokenFromUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      fragment: undefined,
      replaceUrl: true,
    });
  }

  /**
   * `OauthSuccess` navigates here with a state flag. While that navigation is in flight the
   * router still holds it; `history.state` covers a reload of the same entry.
   */
  private resumedFromGoogle(): boolean {
    const fromRouter = this.router.currentNavigation()?.extras.state?.[INVITE_RESUME_STATE_KEY];
    if (fromRouter === true) return true;
    const fromHistory = (this.document.defaultView?.history.state as Record<string, unknown> | null)?.[
      INVITE_RESUME_STATE_KEY
    ];
    return fromHistory === true;
  }
}
