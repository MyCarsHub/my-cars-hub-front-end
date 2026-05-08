import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DefaultLoginLayout } from '../../components/layout/default-login-layout/default-login-layout';
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

@Component({
  selector: 'app-signup',
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
  templateUrl: './signup.html',
  styleUrls: ['./signup.css'],
})
export class Signup {
  signupForm: FormGroup;

  constructor(
    private router: Router,
    private loginService: LoginService
  ) {
    this.signupForm = new FormGroup({
      name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.required, Validators.minLength(8)]),
      passwordConfirm: new FormControl('', [Validators.required, Validators.minLength(8)]),
    });
  }


  summitGoogle() {
    this.loginService.loginWithGoogle();
  }

  submit() {
    this.loginService.signup(this.signupForm.value.name, this.signupForm.value.email, this.signupForm.value.password).subscribe({
      next: () => {
        console.log('Signup successful');
        this.clearForm();
        this.router.navigate(['/login']);
      },
      error: (err) => console.error('Signup failed', err)
    });
  }

  navigate() {
    this.router.navigate(['/login']);
  }

  clearForm() {
    this.signupForm.reset();
  }
}