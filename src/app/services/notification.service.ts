import { Injectable, signal } from '@angular/core';

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: number;
  kind: NotificationKind;
  message: string;
  /** Duration in ms before auto-dismiss. 0 disables the auto-dismiss. */
  duration: number;
}

const DEFAULT_DURATION_MS = 5000;

/**
 * Lightweight signal-based notification bus.
 * UI layer (e.g. a mobile-first toast host) can subscribe to `notifications`
 * and render entries. Falls back to a no-op if no host is mounted, but the
 * signal always reflects the latest state so a host mounted later can catch up.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 1;
  private readonly _notifications = signal<Notification[]>([]);

  readonly notifications = this._notifications.asReadonly();

  push(kind: NotificationKind, message: string, duration = DEFAULT_DURATION_MS): number {
    const id = this.nextId++;
    this._notifications.update((list) => [...list, { id, kind, message, duration }]);
    if (duration > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => this.dismiss(id), duration);
    }
    return id;
  }

  dismiss(id: number): void {
    this._notifications.update((list) => list.filter((n) => n.id !== id));
  }

  info(message: string, duration?: number): void {
    this.push('info', message, duration);
  }

  success(message: string, duration?: number): void {
    this.push('success', message, duration);
  }

  warning(message: string, duration?: number): void {
    this.push('warning', message, duration);
  }

  error(message: string, duration?: number): void {
    this.push('error', message, duration);
  }
}
