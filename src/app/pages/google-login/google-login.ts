import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LoginService } from '../../services/loginService';

@Component({
  selector: 'app-google-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, RouterModule],
  templateUrl: './google-login.html',
  styleUrl: './google-login.css',
})
export class GoogleLogin {
  private readonly loginService = inject(LoginService);

  protected readonly isRedirecting = signal(false);

  protected continueWithGoogle(): void {
    if (this.isRedirecting()) {
      return;
    }

    this.isRedirecting.set(true);
    this.loginService.loginWithGoogle();
  }
}
