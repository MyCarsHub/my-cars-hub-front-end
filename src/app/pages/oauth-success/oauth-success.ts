import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

import { SessionService } from '../../services/session.service';

@Component({
  selector: 'app-oauth-success',
  imports: [],
  templateUrl: './oauth-success.html',
  styleUrls: ['./oauth-success.css'],
})
export class OauthSuccess {
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private sessionService: SessionService
  ) { }

  ngOnInit(): void {
    const token =
      this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    this.sessionService.setToken(token);

    this.authService.getMe().subscribe({
      next: () => {
        const onboardingCompleted =
          this.sessionService.isOnboardingCompleted();

        if (onboardingCompleted) {
          this.router.navigate(['/dashboard']);
        } else {
          this.router.navigate(['/onboarding']);
        }
      },
      error: () => {
        this.sessionService.clear();
        this.router.navigate(['/login']);
      },
    });
  }
}