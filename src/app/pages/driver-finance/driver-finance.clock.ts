import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { DRIVER_FINANCE_TODAY } from './driver-finance.source';

/** How often an open screen re-checks the date (a night shift crosses midnight with it open). */
const TICK_MS = 60_000;

/**
 * "Hoje" of a finance screen, as a SIGNAL: it turns over at midnight and when the app comes
 * back to the foreground, so a Dashboard left open overnight does not keep yesterday as
 * "Hoje" while the popup already writes today's date.
 *
 * Provided per page (`providers: [DriverFinanceClock]`), so it reads the page's
 * `DRIVER_FINANCE_TODAY` (the demo pins one) and its timer dies with the page.
 */
@Injectable()
export class DriverFinanceClock {
  private readonly read = inject(DRIVER_FINANCE_TODAY);
  private readonly value = signal(this.read());

  readonly today = this.value.asReadonly();

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const doc = inject(DOCUMENT);
    const timer = setInterval(() => this.refresh(), TICK_MS);
    const onVisible = () => {
      if (doc.visibilityState === 'visible') this.refresh();
    };
    doc.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      doc.removeEventListener('visibilitychange', onVisible);
    });
  }

  refresh(): void {
    const now = this.read();
    if (now !== this.value()) this.value.set(now);
  }
}
