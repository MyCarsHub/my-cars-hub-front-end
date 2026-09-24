import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { LoginService } from '../../services/loginService';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';

/** Which half of the screen is active. The Google button serves both. */
export type AuthMode = 'signup' | 'login';

/**
 * FIX-0298 / FIX-0288 — the single door into the product.
 *
 * Replaces the three screens that had drifted apart: `pages/google-login` (live on
 * `/login`, own brand visual, no e-mail form, zero mention of the trial) and
 * `pages/login` + `pages/signup` (both on `DefaultLoginLayout`, and both already
 * ORPHANED at b4a35d6 — no route referenced them, `/signup` redirected to `/login`).
 *
 * Two invariants this component must not break:
 *
 * 1. **Google cannot regress.** `Continuar com o Google` is the production login. It
 *    keeps its own action and its own loading state, and it is reachable in BOTH modes —
 *    switching to `criar conta` never hides it.
 * 2. **The trial promise sits above the form.** `14 dias grátis · Sem cartão · Cancele
 *    quando quiser` renders before the commitment, in both modes, matching the landing
 *    copy (`landing-cta`, `landing-hero`) so the funnel says one thing end to end.
 *
 * `?mode=signup` preselects account creation so a landing CTA can be precise. With no
 * query param the default is `login`: `authGuard` and `errorInterceptor` both redirect
 * here on an expired session, and those people are signing in, not signing up.
 */
@Component({
  selector: 'app-auth',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgOptimizedImage,
    RouterModule,
    ReactiveFormsModule,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './auth.html',
  styleUrl: './auth.css',
})
export class Auth {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly loginService = inject(LoginService);
  private readonly sessionService = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly mode = signal<AuthMode>(
    this.route.snapshot.queryParamMap.get('mode') === 'signup' ? 'signup' : 'login',
  );
  protected readonly isSignup = computed(() => this.mode() === 'signup');

  protected readonly submitting = signal(false);
  protected readonly isRedirecting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly title = computed(() =>
    this.isSignup() ? 'Comece sua locadora' : 'Acesse sua locadora',
  );
  protected readonly subtitle = computed(() =>
    this.isSignup()
      ? 'Crie sua conta e coloque seus carros para rodar hoje.'
      : 'Entre para continuar de onde parou.',
  );
  protected readonly primaryLabel = computed(() =>
    this.isSignup() ? 'Criar conta grátis' : 'Entrar',
  );
  protected readonly googleLabel = computed(() =>
    this.isSignup() ? 'Criar conta com o Google' : 'Continuar com o Google',
  );

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu nome completo.',
  };
  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu e-mail.',
    email: 'Informe um e-mail válido.',
  };
  protected readonly passwordMessages: Readonly<Record<string, string>> = {
    required: 'Informe uma senha.',
    minlength: 'A senha deve ter pelo menos 8 caracteres.',
  };
  protected readonly termsMessages: Readonly<Record<string, string>> = {
    required: 'É preciso aceitar os termos para continuar.',
  };

  /**
   * ONE form for both modes. The signup-only controls are DISABLED in `login` mode, so
   * `form.invalid` answers for the active mode without a second FormGroup and without a
   * cross-field validator that has to know which half is showing.
   */
  readonly form = new FormGroup({
    name: new FormControl('', [Validators.required]),
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, Validators.minLength(8)]),
    acceptedTerms: new FormControl<boolean>(false, [Validators.requiredTrue]),
  });

  constructor() {
    this.applyMode(this.mode());
  }

  protected setMode(mode: AuthMode): void {
    if (this.mode() === mode || this.submitting()) return;
    this.mode.set(mode);
    this.error.set(null);
    this.notice.set(null);
    clearServerErrors(this.form);
    this.applyMode(mode);
  }

  protected continueWithGoogle(): void {
    if (this.isRedirecting()) return;
    this.isRedirecting.set(true);
    this.loginService.loginWithGoogle();
  }

  protected submit(): void {
    if (this.submitting() || this.isRedirecting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    this.notice.set(null);
    clearServerErrors(this.form);

    const { name, email, password } = this.form.getRawValue();
    if (this.isSignup()) {
      this.register(name ?? '', email ?? '', password ?? '');
    } else {
      this.signIn(email ?? '', password ?? '');
    }
  }

  private register(name: string, email: string, password: string): void {
    this.loginService.signup(name, email, password).subscribe({
      next: () => {
        this.submitting.set(false);
        // Coherent success copy: the account exists and the trial is the next step, so the
        // screen flips to `entrar` keeping the e-mail, instead of navigating to a different
        // URL just to say "faça login para continuar".
        this.mode.set('login');
        this.applyMode('login');
        this.form.controls.password.reset();
        this.form.controls.email.setValue(email);
        this.form.markAsUntouched();
        this.notice.set('Conta criada. Entre para começar seus 14 dias grátis.');
      },
      error: (err: HttpErrorResponse) =>
        this.handleError(err, 'Não foi possível criar sua conta. Tente novamente.'),
    });
  }

  private signIn(email: string, password: string): void {
    this.loginService.login(email, password).subscribe({
      next: () => {
        this.submitting.set(false);
        this.form.reset();
        const onboardingCompleted = this.sessionService.isOnboardingCompleted();
        this.router.navigate([onboardingCompleted ? '/dashboard' : '/onboarding']);
      },
      error: (err: HttpErrorResponse) =>
        this.handleError(
          err,
          err.status === 401 || err.status === 403
            ? 'E-mail ou senha incorretos.'
            : 'Não foi possível entrar. Tente novamente.',
        ),
    });
  }

  /**
   * `errorInterceptor` deliberately skips 401 on `/auth/login` (a wrong password must not
   * clear the session or redirect), so this screen OWNS the feedback. The backend also
   * sends `fieldErrors: { email: 'E-mail já cadastrado.' }` on a 409 register, which
   * `handleForm` lands inline under the e-mail field.
   */
  private handleError(err: HttpErrorResponse, fallback: string): void {
    this.submitting.set(false);
    const { formMessage } = this.apiErrors.handleForm(err, this.form, fallback);
    this.error.set(formMessage);
  }

  /** Signup-only controls must not veto the login form. */
  private applyMode(mode: AuthMode): void {
    for (const control of [this.form.controls.name, this.form.controls.acceptedTerms]) {
      if (mode === 'signup') control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
    }
  }
}
