import { Injectable, inject } from '@angular/core';
import { NotificationService } from './notification.service';

/**
 * Opens URLs that leave the mycarshub SPA in a new tab so the current
 * route + form state stay preserved. Popup-blocked calls surface a warning
 * toast instead of failing silently.
 */
@Injectable({ providedIn: 'root' })
export class ExternalNavigationService {
  private readonly notifications = inject(NotificationService);

  openExternal(url: string): void {
    if (typeof window === 'undefined' || !url) return;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      this.notifications.warning(
        'Ative pop-ups para este site para abrir o link em nova aba.'
      );
    }
  }
}
