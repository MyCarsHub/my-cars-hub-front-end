import { inject, Injectable } from '@angular/core';

import { TelemetryService } from './telemetry.service';

@Injectable({
  providedIn: 'root'
})
export class SessionService {

  private readonly telemetry = inject(TelemetryService);

  private get isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
  }

  setItem(key: string, value: string): void {
    if (this.isBrowser) {
      sessionStorage.setItem(key, value);
    }
    // Keep telemetry user context aligned when identity keys change.
    if (key === 'id' || key === 'email') {
      this.syncTelemetryUser();
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
      this.syncTelemetryUser();
    }
  }

  clear(): void {
    if (this.isBrowser) {
      sessionStorage.clear();
    }
    // Logout / session drop — untag telemetry so subsequent errors are anonymous.
    try {
      this.telemetry.setUser(null);
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
    return this.getSystemRoleFromToken();
  }

  isPlatformAdmin(): boolean {
    return this.getSystemRoleFromToken() === 'PLATFORM_ADMIN';
  }

  /**
   * Reads `system_role` from the JWT payload — the JWT is HMAC-signed by the
   * backend, so the payload is trustworthy for gating admin UI surface.
   *
   * We intentionally do NOT trust `sessionStorage.systemRole` here: that key is
   * user-editable via DevTools (e.g. attacker sets it to 'PLATFORM_ADMIN' to
   * reveal the admin menu). The `sessionStorage.systemRole` cache remains for
   * display/analytics contexts, but authorization decisions come from the JWT.
   *
   * Fail-closed: any decode error, missing claim, or expired token returns
   * 'USER'. Signature is not verified client-side (impossible without the HMAC
   * secret); if the token is forged the backend rejects the request with 401.
   */
  getSystemRoleFromToken(): 'USER' | 'PLATFORM_ADMIN' {
    if (!this.isBrowser) {
      return 'USER';
    }
    try {
      const token = sessionStorage.getItem('token');
      if (!token) {
        return 'USER';
      }
      const parts = token.split('.');
      if (parts.length !== 3) {
        return 'USER';
      }
      const payloadJson = this.base64UrlDecode(parts[1]);
      const payload = JSON.parse(payloadJson) as {
        system_role?: unknown;
        exp?: unknown;
      };
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
        return 'USER';
      }
      return payload.system_role === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : 'USER';
    } catch {
      return 'USER';
    }
  }

  private base64UrlDecode(input: string): string {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLength);
    const binary = atob(base64);
    // Decode UTF-8 bytes → string (handles non-ASCII claims safely).
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  private syncTelemetryUser(): void {
    try {
      const id = this.getItem('id');
      const email = this.getItem('email');
      if (id) {
        this.telemetry.setUser({ id, email: email ?? undefined });
      } else {
        this.telemetry.setUser(null);
      }
    } catch {
      // Sentry not initialized — no-op.
    }
  }

}
