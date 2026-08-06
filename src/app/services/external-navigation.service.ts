import { Injectable, inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { PendingTabPlaceholderCopy, renderPendingTabPlaceholder } from './pending-tab-placeholder';

/**
 * A tab reserved SYNCHRONOUSLY inside a user gesture, navigated later when the
 * URL is known. `blocked` is the honest answer when the browser refused to open
 * it — the caller must then offer a link the user can click themselves.
 */
export interface PendingTab {
  readonly blocked: boolean;
  /** Point the reserved tab at `url`. No-op when blocked, empty or closed. */
  navigate(url: string): void;
  /** Close the reserved tab (failed request → no orphan blank tab). */
  close(): void;
}

/** What a blocked `window.open` degrades to: nothing to navigate, nothing to close. */
const BLOCKED_TAB: PendingTab = {
  blocked: true,
  navigate: () => void 0,
  close: () => void 0,
};

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
        'Ative pop-ups para este site para abrir o link em nova aba.',
      );
    }
  }

  /**
   * Reserve a new tab NOW, navigate it later. Mobile browsers only allow
   * `window.open` while a user gesture is still on the stack; calling it after
   * `await POST /billing/checkout` is exactly what got the checkout tab treated
   * as a pop-up. Callers open the tab in the click handler, fire the request,
   * then `navigate()` (success) or `close()` (failure).
   *
   * Deliberately WITHOUT `noopener`: that flag makes `window.open` return
   * `null`, leaving nothing to navigate — and it also stops the browser from
   * cloning `sessionStorage` into the new tab, which is what lets the gateway
   * return page recognise which plan was being paid for. The reverse reference
   * is severed by hand instead, before any cross-origin navigation happens.
   *
   * `copy` é o que a aba reservada EXIBE enquanto espera. O padrão é o texto do
   * checkout; todo caller que NÃO está cobrando precisa passar o seu, senão o
   * usuário lê "Abrindo o pagamento seguro" ao abrir um documento.
   */
  openPendingTab(copy?: PendingTabPlaceholderCopy): PendingTab {
    if (typeof window === 'undefined') return BLOCKED_TAB;
    const win = window.open('', '_blank');
    if (!win) return BLOCKED_TAB;
    if (!this.severOpener(win)) {
      // Fail CLOSED. The threat is not the gateway itself: it is whatever the
      // user browses to next in that tab, which would keep a live handle able
      // to renavigate this one. Better a manual link than a silent downgrade.
      win.close();
      return BLOCKED_TAB;
    }
    this.renderPlaceholder(win, copy);
    return {
      blocked: false,
      navigate: (url: string) => {
        if (!url || win.closed) return;
        win.location.replace(url);
      },
      close: () => {
        if (!win.closed) win.close();
      },
    };
  }

  /**
   * Tabnabbing guard: nothing loaded in that tab may keep a handle on our page.
   * Returns false when the disowning did not take — the caller must then throw
   * the tab away rather than navigate it.
   */
  private severOpener(win: Window): boolean {
    try {
      win.opener = null;
      return win.opener === null;
    } catch {
      return false;
    }
  }

  /**
   * about:blank reads as a broken tab on mobile — say what is happening.
   * The markup/CSS lives in `pending-tab-placeholder.ts`; see the note there on
   * why this is hand-rolled DOM instead of the `OauthSuccess` component.
   */
  private renderPlaceholder(win: Window, copy?: PendingTabPlaceholderCopy): void {
    try {
      renderPendingTabPlaceholder(win.document, copy);
    } catch {
      // Even reaching `win.document` can throw; a placeholder never breaks the flow.
    }
  }
}
