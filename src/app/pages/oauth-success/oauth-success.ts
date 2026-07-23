import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';

interface OauthExchangeResponse {
  token: string;
}

/**
 * Callback do login OAuth. Recebe {@code ?code=} da URL, troca por JWT via
 * {@code POST /v1/auth/oauth-exchange} (o JWT NUNCA aparece na URL).
 *
 * Fallback pra {@code ?token=} legado enquanto backend não estiver 100% no
 * novo fluxo — remover em N deploys.
 */
@Component({
  selector: 'app-oauth-success',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './oauth-success.html',
  styleUrls: ['./oauth-success.css'],
})
export class OauthSuccess implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly sessionService = inject(SessionService);
  private readonly http = inject(HttpClient);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const legacyToken = params.get('token');

    if (code) {
      this.exchangeCodeForToken(code);
      return;
    }

    // Fallback pro fluxo antigo (deprecado). Remover após alguns deploys.
    if (legacyToken) {
      this.completeLogin(legacyToken);
      return;
    }

    this.router.navigate(['/login']);
  }

  private exchangeCodeForToken(code: string): void {
    this.http.post<OauthExchangeResponse>(`${environment.apiUrl}/auth/oauth-exchange`, { code }).subscribe({
      next: (res) => {
        if (!res?.token) {
          this.router.navigate(['/login']);
          return;
        }
        this.completeLogin(res.token);
      },
      error: () => {
        this.sessionService.clear();
        this.router.navigate(['/login']);
      },
    });
  }

  private completeLogin(token: string): void {
    // Wipe any leftover state from a previous login (companies=[], selectedCompanyId,
    // onboardingCompleted=false, etc). Sem isso, um relogin depois de trocar de
    // usuário/onboarding herda cache velho e o user cai num dashboard 403 mudo.
    this.sessionService.clear();
    this.sessionService.setToken(token);
    this.authService.getMe().subscribe({
      next: (user) => {
        // Derive onboarding state DIRECTLY from the emitted /auth/me response,
        // not from sessionStorage. Guarantees no race between writeSession()
        // side-effects and this read, and mirrors the BE-driven policy: a
        // fresh signup has no companies → always route to /onboarding.
        const hasCompany = (user.companies?.length ?? 0) > 0;
        this.router.navigate([hasCompany ? '/dashboard' : '/onboarding']);
      },
      error: () => {
        this.sessionService.clear();
        this.router.navigate(['/login']);
      },
    });
  }
}
