import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { switchMap, tap } from 'rxjs';
import { LoginResponse } from '../types/login-response.type';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  constructor(
    private httpClient: HttpClient,
    private authService: AuthService
  ) { }

  loginWithGoogle() {
    window.location.href =
      'http://localhost:8085/v1/auth/login/google';
  }

  login(email: string, password: string) {
    return this.httpClient
      .post<LoginResponse>(
        'http://localhost:8085/v1/auth/login',
        { email, password }
      )
      .pipe(
        tap((response) => {
          sessionStorage.setItem('token', response.token);
        }),
        switchMap(() => this.authService.getMe())
      );
  }

  signup(name: string, email: string, password: string) {
    return this.httpClient.post<void>(
      'http://localhost:8085/v1/auth/register',
      { name, email, password }
    );
  }
}