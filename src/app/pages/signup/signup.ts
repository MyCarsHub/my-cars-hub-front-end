import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DefaultLoginLayout } from '../../components/layout/default-login-layout/default-login-layout';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { Router, RouterModule } from '@angular/router';
import { LoginService } from '../../services/loginService';

@Component({
  selector: 'app-signup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DefaultLoginLayout,
    ReactiveFormsModule,
    PrimaryInput,
    RouterModule,
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
    this.signupForm = new FormGroup(
      {
        name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, Validators.email]),
        password: new FormControl('', [Validators.required, Validators.minLength(8)]),
        passwordConfirm: new FormControl('', [Validators.required, Validators.minLength(8)]),
        acceptedTerms: new FormControl<boolean>(false, [Validators.requiredTrue]),
      },
      { validators: passwordsMatchValidator },
    );
  }


  summitGoogle() {
    this.loginService.loginWithGoogle();
  }

  submit() {
    if (this.signupForm.invalid || !this.signupForm.controls['acceptedTerms'].value) {
      return;
    }
    this.loginService.signup(this.signupForm.value.name, this.signupForm.value.email, this.signupForm.value.password).subscribe({
      next: () => {
        this.clearForm();
        this.router.navigate(['/login']);
      },
      error: () => {
        // errors are surfaced by the global errorInterceptor
      },
    });
  }

  navigate() {
    this.router.navigate(['/login']);
  }

  clearForm() {
    this.signupForm.reset();
  }
}

function passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const passwordConfirm = group.get('passwordConfirm')?.value;
  if (!password || !passwordConfirm) return null;
  return password === passwordConfirm ? null : { passwordMismatch: true };
}