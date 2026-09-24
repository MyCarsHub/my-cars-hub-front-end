import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DefaultLoginLayout } from '../../components/layout/default-login-layout/default-login-layout';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { LoginService } from '../../services/loginService';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';
import { clearServerErrors } from '../../services/api-error';

@Component({
  selector: 'app-signup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultLoginLayout,
    ReactiveFormsModule,
    RouterModule,
    NgOptimizedImage,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './signup.html',
  styleUrls: ['./signup.css'],
})
export class Signup {
  private readonly router = inject(Router);
  private readonly loginService = inject(LoginService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

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
  protected readonly passwordConfirmMessages: Readonly<Record<string, string>> = {
    required: 'Confirme sua senha.',
    minlength: 'A senha deve ter pelo menos 8 caracteres.',
  };
  protected readonly termsMessages: Readonly<Record<string, string>> = {
    required: 'É preciso aceitar os termos para continuar.',
  };

  readonly signupForm = new FormGroup(
    {
      name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.required, Validators.minLength(8)]),
      passwordConfirm: new FormControl('', [Validators.required, Validators.minLength(8)]),
      acceptedTerms: new FormControl<boolean>(false, [Validators.requiredTrue]),
    },
    { validators: passwordsMatchValidator },
  );

  protected summitGoogle(): void {
    this.loginService.loginWithGoogle();
  }

  protected submit(): void {
    if (this.submitting()) return;
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    clearServerErrors(this.signupForm);

    const { name, email, password } = this.signupForm.getRawValue();

    this.loginService.signup(name ?? '', email ?? '', password ?? '').subscribe({
      next: () => {
        this.submitting.set(false);
        this.notifications.success('Conta criada. Faça login para continuar.');
        this.clearForm();
        this.router.navigate(['/login']);
      },
      error: (err: HttpErrorResponse) => this.handleError(err),
    });
  }

  /**
   * Backend sends `fieldErrors: { email: 'E-mail já cadastrado.' }` on 409, so a duplicate
   * e-mail lands INLINE under the e-mail field instead of vanishing (the previous handler
   * was empty). Anything without a matching control falls back to the form banner.
   */
  private handleError(err: HttpErrorResponse): void {
    this.submitting.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.signupForm,
      'Não foi possível criar sua conta. Tente novamente.',
    );
    this.error.set(formMessage);
  }

  protected navigate(): void {
    this.router.navigate(['/login']);
  }

  protected clearForm(): void {
    this.signupForm.reset();
  }
}

function passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const passwordConfirm = group.get('passwordConfirm')?.value;
  if (!password || !passwordConfirm) return null;
  return password === passwordConfirm ? null : { passwordMismatch: true };
}
