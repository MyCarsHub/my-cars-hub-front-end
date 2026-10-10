import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** How a native share ended. `cancelled` is the person closing the system sheet: not an error. */
export type NativeShareResult = 'shared' | 'cancelled' | 'failed';

/**
 * Hands an invite link to something outside the app: the clipboard, WhatsApp, or the
 * system share sheet.
 *
 * The link is a credential-like value (whoever holds it can accept the invite), so this
 * service is deliberately stateless: it receives the link per call and keeps, logs and
 * persists nothing. The callers hold it in component state and drop it when their sheet
 * closes.
 */
@Injectable({ providedIn: 'root' })
export class InviteShareService {
  private readonly document = inject(DOCUMENT);

  /** pt-BR text sent with the link. Names the company when the session knows it. */
  message(link: string, companyName?: string | null): string {
    const company = (companyName ?? '').trim();
    const where = company ? `a empresa ${company} no MyCarsHub` : 'uma empresa no MyCarsHub';
    return `Você recebeu um convite para entrar em ${where}. Para aceitar, acesse: ${link}`;
  }

  /** `https://wa.me/?text=` + the encoded message: opens WhatsApp's contact picker. */
  whatsAppUrl(link: string, companyName?: string | null): string {
    return `https://wa.me/?text=${encodeURIComponent(this.message(link, companyName))}`;
  }

  /** Opens WhatsApp in a new tab. `false` when the browser refused (popup blocked). */
  openWhatsApp(link: string, companyName?: string | null): boolean {
    const win = this.document.defaultView;
    if (!win) return false;
    // `noopener` as a feature makes `open` return null in every browser, which would make
    // "blocked" and "opened" indistinguishable. Open first, then cut the opener ourselves.
    const opened = win.open(this.whatsAppUrl(link, companyName), '_blank');
    if (!opened) return false;
    try {
      opened.opener = null;
    } catch {
      // Cross-origin window already: nothing left to cut.
    }
    return true;
  }

  /** `true` where the system share sheet exists (mostly phones). */
  canNativeShare(): boolean {
    const nav = this.document.defaultView?.navigator;
    return !!nav && typeof nav.share === 'function';
  }

  async nativeShare(link: string, companyName?: string | null): Promise<NativeShareResult> {
    const nav = this.document.defaultView?.navigator;
    if (!nav || typeof nav.share !== 'function') return 'failed';
    try {
      await nav.share({ title: 'Convite MyCarsHub', text: this.message(link, companyName) });
      return 'shared';
    } catch (error) {
      return (error as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }

  /**
   * Copies `text` to the clipboard. Tries the async Clipboard API first; when it is absent
   * (insecure context, old browser) or refuses, falls back to a hidden textarea and
   * `execCommand('copy')`. Resolves `false` — never throws — when neither worked.
   */
  async copy(text: string): Promise<boolean> {
    const nav = this.document.defaultView?.navigator;
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        await nav.clipboard.writeText(text);
        return true;
      } catch {
        // Permission denied or no user activation: try the legacy path.
      }
    }
    return this.copyWithTextarea(text);
  }

  private copyWithTextarea(text: string): boolean {
    const doc = this.document;
    if (!doc.body || typeof doc.execCommand !== 'function') return false;
    const previouslyFocused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.tabIndex = -1;
    // Off-screen but rendered, and 16px so iOS does not zoom when it takes focus.
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    area.style.fontSize = '16px';
    doc.body.appendChild(area);
    try {
      area.focus({ preventScroll: true });
      area.select();
      area.setSelectionRange(0, text.length);
      return doc.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
      previouslyFocused?.focus({ preventScroll: true });
    }
  }
}
