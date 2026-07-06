import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

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
    // Keep Sentry user context aligned when identity keys change.
    if (key === 'id' || key === 'email') {
      this.syncSentryUser();
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
    if (key === 'id' || key === 'email') {
      this.syncSentryUser();
    }
  }

  clear(): void {
    if (this.isBrowser) {
      sessionStorage.clear();
    }
    // Logout / session drop — untag Sentry so subsequent errors are anonymous.
    try {
      Sentry.setUser(null);
    } catch {
      // Sentry may not be initialized (e.g. dev without DSN); safe to ignore.
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

  getUserId(): string | null {
    return this.getItem('id');
  }

  getSystemRole(): 'USER' | 'PLATFORM_ADMIN' {
    return this.getItem('systemRole') === 'PLATFORM_ADMIN'
      ? 'PLATFORM_ADMIN'
      : 'USER';
  }

  isPlatformAdmin(): boolean {
    return this.getSystemRole() === 'PLATFORM_ADMIN';
  }

  private syncSentryUser(): void {
    try {
      const id = this.getItem('id');
      const email = this.getItem('email');
      if (id) {
        Sentry.setUser({ id, email: email ?? undefined });
      } else {
        Sentry.setUser(null);
      }
    } catch {
      // Sentry not initialized — no-op.
    }
  }

}
