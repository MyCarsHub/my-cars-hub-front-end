import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { Router } from '@angular/router';
import { LoginService } from '../../services/loginService';
import { DefaultLoginLayout } from '../../components/layout/default-login-layout/default-login-layout';

import { SessionService } from '../../services/session.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultLoginLayout,
    ReactiveFormsModule,
    PrimaryInput,
  ],
  providers: [
    LoginService
  ],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class Login {
  loginForm: FormGroup;

  constructor(
    private router: Router,
    private loginService: LoginService,
    private sessionService: SessionService
  ) {
    this.loginForm = new FormGroup({
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.required, Validators.minLength(6)]),
    });
  }

  summitGoogle() {
    this.loginService.loginWithGoogle();
  }

  submit() {
    this.loginService.login(this.loginForm.value.email, this.loginForm.value.password).subscribe({
      next: () => {
        this.clearForm();
        const onboardingCompleted = this.sessionService.isOnboardingCompleted();
        if (onboardingCompleted) {
          this.router.navigate(['/dashboard']);
        } else {
          this.router.navigate(['/onboarding']);
        }
      },
      error: () => {
        // errors are surfaced by the global errorInterceptor
      },
    });
  }

  navigate() {
    this.router.navigate(['/signup']);
  }

  clearForm() {
    this.loginForm.reset();
  }
}