import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { NgOptimizedImage } from '@angular/common';
import { Router } from '@angular/router';
import { DefaultLoginLayout } from '../../components/layout/default-login-layout/default-login-layout';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { LoginService } from '../../services/loginService';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultLoginLayout,
    ReactiveFormsModule,
    NgOptimizedImage,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class Login {
  private readonly router = inject(Router);
  private readonly loginService = inject(LoginService);
  private readonly sessionService = inject(SessionService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu e-mail.',
    email: 'Informe um e-mail válido.',
  };
  protected readonly passwordMessages: Readonly<Record<string, string>> = {
    required: 'Informe sua senha.',
    minlength: 'A senha deve ter pelo menos 6 caracteres.',
  };

  readonly loginForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, Validators.minLength(6)]),
  });

  protected summitGoogle(): void {
    this.loginService.loginWithGoogle();
  }

  protected submit(): void {
    if (this.submitting()) return;
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    clearServerErrors(this.loginForm);

    const { email, password } = this.loginForm.getRawValue();

    this.loginService.login(email ?? '', password ?? '').subscribe({
      next: () => {
        this.submitting.set(false);
        this.clearForm();
        const onboardingCompleted = this.sessionService.isOnboardingCompleted();
        this.router.navigate([onboardingCompleted ? '/dashboard' : '/onboarding']);
      },
      error: (err: HttpErrorResponse) => this.handleError(err),
    });
  }

  /**
   * `errorInterceptor` deliberately skips 401 on `/auth/login` (a wrong password must not
   * clear the session or redirect), so this screen OWNS the feedback: without this handler
   * a wrong password produced no reaction at all.
   */
  private handleError(err: HttpErrorResponse): void {
    this.submitting.set(false);
    const fallback =
      err.status === 401 || err.status === 403
        ? 'E-mail ou senha incorretos.'
        : 'Não foi possível entrar. Tente novamente.';
    const { formMessage } = this.apiErrors.handleForm(err, this.loginForm, fallback);
    this.error.set(formMessage);
  }

  protected navigate(): void {
    this.router.navigate(['/signup']);
  }

  protected clearForm(): void {
    this.loginForm.reset();
  }
}
