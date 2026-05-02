import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { switchMap, tap } from 'rxjs';
import { LoginResponse } from '../types/login-response.type';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

import { SessionService } from './session.service';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  constructor(
    private httpClient: HttpClient,
    private authService: AuthService,
    private sessionService: SessionService
  ) { }

  loginWithGoogle() {
    window.location.href = `${environment.apiUrl}/auth/login/google`;
  }

  login(email: string, password: string) {
    return this.httpClient
      .post<LoginResponse>(
        `${environment.apiUrl}/auth/login`,
        { email, password }
      )
      .pipe(
        tap((response) => {
          this.sessionService.setToken(response.token);
        }),
        switchMap(() => this.authService.getMe())
      );
  }

  signup(name: string, email: string, password: string) {
    return this.httpClient.post<void>(
      `${environment.apiUrl}/auth/register`,
      { name, email, password }
    );
  }
}