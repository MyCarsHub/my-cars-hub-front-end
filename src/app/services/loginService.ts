import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { tap } from 'rxjs';
import { LoginResponse } from '../types/login-response.type';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  constructor(private httpClient: HttpClient) {}

  loginWithGoogle() {
    window.location.href = 'http://localhost:8085/v1/auth/login/google';
  }

  login(email: string, password: string) {
    return this.httpClient.post<LoginResponse>('http://localhost:8085/v1/auth/login', { email, password }).pipe(
      tap((value) => {
        sessionStorage.setItem('token', value.token);
        sessionStorage.setItem('name', value.name);
        sessionStorage.setItem('email', value.email);
      })
    );
  }

  signup(name: string, email: string, password: string) {
    return this.httpClient.post<void>('http://localhost:8085/v1/auth/register', { name, email, password });
  }
}
