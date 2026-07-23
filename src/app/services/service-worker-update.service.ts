import { DOCUMENT, Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

import { NotificationService } from './notification.service';

/**
 * Detects when a new service-worker version is deployed and forces the client
 * to activate it and reload. Prevents users from being stuck on a stale bundle
 * after a Vercel deploy (open tabs otherwise keep the previous SW version alive
 * indefinitely).
 *
 * Also handles unrecoverable SW states (cache corruption / missing chunks) by
 * doing a hard reload.
 */
@Injectable({ providedIn: 'root' })
export class ServiceWorkerUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private started = false;

  /** Called from AppComponent.ngOnInit — safe to call multiple times. */
  init(): void {
    if (this.started || !this.swUpdate.isEnabled) {
      return;
    }
    this.started = true;

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => {
        void this.applyUpdateAndReload();
      });

    this.swUpdate.unrecoverable.subscribe(() => {
      this.notifications.warning(
        'Ocorreu um problema com a versão em cache. Recarregando o aplicativo…',
        3000,
      );
      this.reloadSoon();
    });
  }

  private async applyUpdateAndReload(): Promise<void> {
    try {
      const activated = await this.swUpdate.activateUpdate();
      if (activated) {
        this.notifications.info('Nova versão disponível. Recarregando…', 2000);
        this.reloadSoon();
      }
    } catch {
      // If activation fails, force a reload anyway so the browser fetches
      // the latest index.html directly from Vercel.
      this.reloadSoon();
    }
  }

  private reloadSoon(): void {
    const win = this.document.defaultView;
    if (!win) {
      return;
    }
    win.setTimeout(() => win.location.reload(), 1500);
  }
}
