import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT, NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { PageLoader } from '../../components/page-loader/page-loader';
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
import {
  InviteAcceptAsMemberResponse,
  InviteValidateResponse,
} from '../../types/invite-flow.types';
import { applyMaskedDocumentInput, cpfShapeValidator, maskCpf, normalizeCpf } from '../../utils/document-mask';
import { cpfValidator } from '../../utils/validators/cpf.validator';
import { INVITE_RESUME_STATE_KEY, PENDING_INVITE_TOKEN_KEY } from '../invites/invite-session';

/**
 * How long the backend locks an invite after too many wrong CPFs. Mirrors the backend; no
 * endpoint exposes it, so the copy reads it from here instead of retyping the number.
 */
export const INVITE_LOCK_MINUTES = 30;

/**
 * Hard ceiling of the "joining" screen: from the click (or the return from Google) to being
 * inside the company. Past it the screen stops spinning and offers a way out; an endless
 * spinner is the one outcome this page must never produce.
 */
export const INVITE_JOIN_TIMEOUT_MS = 20_000;

/** Ceiling of the "checking the invite" call. */
export const INVITE_VALIDATE_TIMEOUT_MS = 15_000;

const SLOW_COPY =
  'A resposta demorou mais do que o esperado. Confira sua conexão e tente de novo.';

const ONBOARDING_PATH = '/convite/cadastro';
const APP_PATH = '/dashboard';

type LandingView =
  | 'loading'
  | 'form'
  | 'existing'
  | 'joining'
  | 'linked'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'not-found'
  | 'no-token'
  | 'unreachable'
  | 'problem';

const sameEmail = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Public page of the invitation e-mail link: `/convite` (the old `/invite/accept` redirects
 * here). Lives OUTSIDE the authenticated shell - it is reachable logged out by design.
 *
 * Flow:
 *  1. The token is read from `?token=` (or a `#token=` fragment), stashed in sessionStorage
 *     and REMOVED from the address bar at once, so it never sits in history or a screenshot.
 *  2. `POST /invites/validate` decides the screen (PENDING new / PENDING existing / terminal).
 *  3. New account: the invitee types the CPF and `POST /invites/accept` returns an
 *     ONBOARDING token, parked in its own slot (never the normal auth slot); the manager or
 *     driver onboarding at `/convite/cadastro` confirms the data and lets them in.
 *  4. Existing account: "Aceitar convite" is the first action. A tab already signed in as the
 *     invitee goes straight to `accept-as-member`; otherwise Google login comes AFTER the
 *     click, `OauthSuccess` returns here with the resume flag and the page finishes on its own.
 */
@Component({
  selector: 'app-invite-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgOptimizedImage,
    NgTemplateOutlet,
    RouterLink,
    AlertBanner,
    ReactiveFormsModule,
    FormField,
    FieldControl,
    PageLoader,
  ],
  templateUrl: './invite-landing.html',
})
export class InviteLanding implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly flow = inject(InviteFlowService);
  private readonly session = inject(SessionService);
  private readonly auth = inject(AuthService);
  private readonly loginService = inject(LoginService);
  private readonly onboardingToken = inject(InviteOnboardingTokenStore);

  private token = '';
  private joinWatchdog: ReturnType<typeof setTimeout> | null = null;
  private pending: Subscription | null = null;
  /** The membership exists and its credential is parked: a stall from here on is "linked". */
  private memberReady = false;

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
  /** The failure may go away on its own (slow or broken network, 5xx): offer "Tentar de novo". */
  protected readonly retryable = signal(false);
  /** Where "Continuar" of the `linked` screen goes (a full page load). */
  protected readonly linkedTarget = signal(APP_PATH);

  protected readonly lockMinutes = INVITE_LOCK_MINUTES;
  protected readonly companyName = computed(() => this.details()?.companyName ?? '');
  protected readonly roleLabel = computed(() => this.details()?.roleLabel ?? '');
  protected readonly inviterName = computed(() => this.details()?.inviterName?.trim() ?? '');
  protected readonly inviteeEmail = computed(() => this.details()?.email?.trim() ?? '');

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

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearJoinWatchdog();
      this.pending?.unsubscribe();
    });
  }

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
    this.validate();
  }

  /**
   * Starts over from the validate call. The resume flag is kept on purpose: a retry after a
   * failed join must finish the join, not send the person through Google a second time.
   */
  protected retry(): void {
    this.validate();
  }

  protected onCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.cpf, maskCpf);
  }

  /** Native `submit`: this form has no `NgForm`, so there is no `ngSubmit` to listen to. */
  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  /** New account: CPF gate, then the onboarding (manager or driver) confirms the data. */
  protected submit(): void {
    if (this.submitting() || this.locked()) return;
    if (this.cpf.invalid) {
      this.cpf.markAsTouched();
      return;
    }

    this.submitting.set(true);
    this.pending = this.flow.accept(this.token, normalizeCpf(this.cpf.value)).subscribe({
      next: (response) => {
        this.submitting.set(false);
        // Its own slot, never the normal auth token: this credential only opens onboarding.
        this.onboardingToken.set(response.onboardingToken);
        this.session.removeItem(PENDING_INVITE_TOKEN_KEY);
        this.memberReady = true;
        this.goTo(ONBOARDING_PATH);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.handleAcceptError(err);
      },
    });
  }

  /**
   * Existing account, the "Aceitar convite" button. A tab that already holds a session of the
   * invitee's own account accepts right away; any other tab goes to Google first (the token is
   * stashed, and `OauthSuccess` brings the person back to finish).
   */
  protected acceptExisting(): void {
    if (this.redirecting() || this.view() === 'joining') return;
    if (this.sessionIsTheInvitee()) {
      this.joinAsMember();
      return;
    }
    this.continueWithGoogle();
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

  /** `linked` screen: the invite WAS accepted, so the only way on is loading the app afresh. */
  protected continueIntoApp(): void {
    this.document.defaultView?.location.assign(this.linkedTarget());
  }

  private validate(): void {
    this.pending?.unsubscribe();
    this.view.set('loading');
    this.pending = this.flow
      .validate(this.token)
      .pipe(timeout(INVITE_VALIDATE_TIMEOUT_MS))
      .subscribe({
        next: (details) => {
          this.details.set(details);
          this.decide(details);
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

  private decide(details: InviteValidateResponse): void {
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
    if (this.resumed && this.session.getToken()) {
      this.joinAsMember();
      return;
    }
    this.view.set('existing');
  }

  /** `true` only when the tab's session is the account the invite was sent to. */
  private sessionIsTheInvitee(): boolean {
    if (!this.session.getToken()) return false;
    return sameEmail(this.session.getEmailFromToken(), this.details()?.email);
  }

  private joinAsMember(): void {
    this.pending?.unsubscribe();
    this.view.set('joining');
    this.armJoinWatchdog();
    this.pending = this.flow.acceptAsMember(this.token).subscribe({
      next: (response) => this.joined(response),
      error: (err: unknown) => {
        this.clearJoinWatchdog();
        const code = inviteFlowErrorCode(err);
        this.canSwitchAccount.set(
          code === 'INVITE_EMAIL_MISMATCH' || code === 'INVITE_GOOGLE_ACCOUNT_REQUIRED',
        );
        if (this.changeScreenFor(err)) return;
        this.showProblem(inviteAcceptProblemCopy(err, this.companyName()), code === null);
      },
    });
  }

  /** The membership exists. Whatever happens from here must not look like "not joined". */
  private joined(response: InviteAcceptAsMemberResponse): void {
    try {
      // A DRIVER whose registration is still pending gets an ONBOARDING token and NO access
      // token: CNH and address come first, then the onboarding hands out the session.
      if (response.next === 'DRIVER_ONBOARDING' && response.onboardingToken) {
        this.onboardingToken.set(response.onboardingToken);
        this.session.removeItem(PENDING_INVITE_TOKEN_KEY);
        this.memberReady = true;
        this.goTo(ONBOARDING_PATH);
        return;
      }

      if (!response.accessToken) {
        // Neither shape of the contract: there is nothing to sign in with, and pretending
        // otherwise would store the string "undefined" as the session.
        this.clearJoinWatchdog();
        this.showProblem(inviteAcceptProblemCopy(null, this.companyName()), true);
        return;
      }

      this.flow.signIn(response.accessToken, { name: response.companyName, role: response.role });
      this.memberReady = true;
      this.goTo(APP_PATH);
    } catch {
      // An exception inside an rx `next` is reported out of band and would leave the spinner.
      this.clearJoinWatchdog();
      this.showProblem(inviteAcceptProblemCopy(null, this.companyName()), true);
    }
  }

  /**
   * Navigates inside the SPA and guarantees an exit: a refused navigation (`false`), a
   * rejected one (redirect storm, a guard that throws) and one that never settles all end on
   * the `linked` screen, never on the spinner. The account is already in; saying "failed"
   * here would be false.
   */
  private goTo(path: string): void {
    this.linkedTarget.set(path);
    // The loader stays up for the whole hand-over: no form left to press twice.
    this.view.set('joining');
    this.armJoinWatchdog();
    this.router.navigate([path], { replaceUrl: true }).then(
      (ok) => {
        if (!ok) this.showLinked();
      },
      () => this.showLinked(),
    );
  }

  private showLinked(): void {
    this.clearJoinWatchdog();
    this.view.set('linked');
  }

  /** One ceiling per phase of "click to inside": the call, then the sign-in and navigation. */
  private armJoinWatchdog(): void {
    this.clearJoinWatchdog();
    this.joinWatchdog = setTimeout(() => {
      this.joinWatchdog = null;
      if (this.view() !== 'joining') return;
      this.pending?.unsubscribe();
      if (this.memberReady) {
        this.showLinked();
        return;
      }
      this.showProblem(SLOW_COPY, true);
    }, INVITE_JOIN_TIMEOUT_MS);
  }

  private clearJoinWatchdog(): void {
    if (this.joinWatchdog !== null) clearTimeout(this.joinWatchdog);
    this.joinWatchdog = null;
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
        this.showProblem(
          inviteAcceptProblemCopy(err, this.companyName()),
          inviteFlowErrorCode(err) === null,
        );
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

  private showProblem(message: string, retryable: boolean): void {
    // A dead connection is retryable from its own screen; a refusal that names a cause is
    // terminal, and an unnamed failure (5xx, timeout) offers the retry on the problem screen.
    this.problemMessage.set(message);
    this.retryable.set(retryable);
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
