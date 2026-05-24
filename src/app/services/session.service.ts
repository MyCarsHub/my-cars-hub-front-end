import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SessionService {

  private get isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
  }

  setItem(key: string, value: string): void {
    if (this.isBrowser) {
      sessionStorage.setItem(key, value);
    }
  }

  getItem(key: string): string | null {
    if (this.isBrowser) {
      return sessionStorage.getItem(key);
    }
    return null;
  }

  removeItem(key: string): void {
    if (this.isBrowser) {
      sessionStorage.removeItem(key);
    }
  }

  clear(): void {
    if (this.isBrowser) {
      sessionStorage.clear();
    }
  }

  setToken(token: string): void {
    this.setItem('token', token);
  }

  getToken(): string | null {
    return this.getItem('token');
  }

  setOnboardingCompleted(completed: boolean): void {
    this.setItem('onboardingCompleted', completed ? 'true' : 'false');
  }

  isOnboardingCompleted(): boolean {
    return this.getItem('onboardingCompleted') === 'true';
  }

}
