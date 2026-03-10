import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { NgOptimizedImage } from '@angular/common';
import { Router } from '@angular/router';
import { LoginService } from '../../services/loginService';
import { DefaultLoginLayout } from '../../components/layout/default-login-layout/default-login-layout';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultLoginLayout,
    ReactiveFormsModule,
    PrimaryInput,
    NgOptimizedImage,
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
    private loginService: LoginService
  ) {
    this.loginForm = new FormGroup({
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.required, Validators.minLength(6)]),
    });
  }

  summitGoogle() {
    window.location.href = 'http://localhost:8085/v1/auth/login/google';
  }

  submit() {
    this.loginService.login(this.loginForm.value.email, this.loginForm.value.password).subscribe({
      next: () => {
        console.log('Login successful')
        this.clearForm();
        this.router.navigate(['/account-steps']);
      },
      error: (err) => console.error('Login failed', err)
    });
  }

  navigate() {
    this.router.navigate(['/signup']);
  }

  clearForm() {
    this.loginForm.reset();
  }
}