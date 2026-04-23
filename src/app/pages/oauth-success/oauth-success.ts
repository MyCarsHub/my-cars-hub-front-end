import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    const token =
      this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    sessionStorage.setItem('token', token);

    this.authService.getMe().subscribe({
      next: () => {
        const onboardingCompleted =
          sessionStorage.getItem('onboardingCompleted') === 'true';

        if (onboardingCompleted) {
          this.router.navigate(['/dashboard']);
        } else {
          this.router.navigate(['/onboarding']);
        }
      },
      error: () => {
        sessionStorage.clear();
        this.router.navigate(['/login']);
      },
    });
  }
}