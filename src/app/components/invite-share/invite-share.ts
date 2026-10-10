import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { InviteShareService } from '../../services/invite-share.service';
import { NotificationService } from '../../services/notification.service';

type CopyState = 'idle' | 'copied' | 'failed';

let nextShareId = 0;

const ACTION =
  'min-h-12 w-full px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 ' +
  'border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2';

/**
 * "Copiar link" and "Enviar pelo WhatsApp" for an invite link the caller already holds.
 *
 * The link lives ONLY in the `link` input: this component stores it nowhere, logs nothing,
 * and forgets the "copied" state when the link changes. Whoever renders it owns the
 * lifetime — drop the link and the panel goes with it.
 *
 * - Copy uses the async Clipboard API and falls back to a hidden textarea (insecure
 *   contexts, old browsers). The result is a toast AND an inline state: the button label
 *   and a polite live region, because the toast alone is gone in five seconds.
 * - WhatsApp is a real anchor (`target=_blank`, `rel=noopener`): it works with no script,
 *   and a tap on an anchor is never taken for a popup.
 * - "Compartilhar" appears only where `navigator.share` exists, in addition to WhatsApp.
 * - The link is also shown in a read-only field, so a copy that no API allows can still be
 *   done by hand.
 */
@Component({
  selector: 'app-invite-share',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-3" data-invite-share>
      <div>
        <label [for]="fieldId" class="block text-xs font-semibold text-neutral-700 mb-1">
          Link do convite
        </label>
        <input
          [id]="fieldId"
          data-share-link
          type="text"
          readonly
          [value]="link()"
          (focus)="selectAll($event)"
          class="w-full min-h-[44px] bg-neutral-50 border border-neutral-200 rounded-xl px-3 text-base
                 text-neutral-800 truncate focus:outline-none focus:ring-2 focus:ring-primary-400
                 focus:border-primary-400"
        />
      </div>

      <div class="flex flex-col gap-2">
        <button type="button" data-copy-link (click)="copy()" [class]="action">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true">
            @if (state() === 'copied') {
              <polyline points="20 6 9 17 4 12" />
            } @else {
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            }
          </svg>
          {{ state() === 'copied' ? 'Link copiado' : 'Copiar link' }}
        </button>

        <a
          data-whatsapp-link
          [href]="whatsAppUrl()"
          target="_blank"
          rel="noopener noreferrer"
          class="w-full min-h-12 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold shadow-sm
                 no-underline transition-colors focus:outline-none focus-visible:ring-2
                 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
               fill="currentColor" aria-hidden="true">
            <path d="M20.52 3.48A11.9 11.9 0 0 0 12 0C5.37 0 0 5.37 0 12a11.9 11.9 0 0 0 1.72 6.19L0 24l5.99-1.68A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52zM12 22a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.55.99.99-3.47-.24-.36A9.9 9.9 0 0 1 2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10zm5.42-7.47c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.66.15-.2.3-.76.96-.93 1.15-.17.2-.35.22-.65.07-.3-.15-1.24-.46-2.36-1.46-.87-.78-1.46-1.73-1.63-2.03-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.9-2.19-.24-.57-.48-.5-.66-.51h-.56c-.2 0-.5.07-.76.37-.26.3-1 1-1 2.44 0 1.44 1.03 2.83 1.17 3.03.15.2 2.04 3.11 4.94 4.36 2.9 1.25 2.9.83 3.42.78.52-.05 1.75-.71 2-1.4.24-.7.24-1.28.17-1.4-.07-.13-.27-.2-.57-.35z"/>
          </svg>
          Enviar pelo WhatsApp
        </a>

        @if (canShare) {
          <button type="button" data-native-share (click)="shareNative()" [class]="action">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
            </svg>
            Compartilhar
          </button>
        }
      </div>

      <!-- Always in the DOM: a live region that appears together with its text is not
           announced. Visible too, so the confirmation outlives the toast. -->
      <p
        data-share-status
        role="status"
        aria-live="polite"
        class="text-xs leading-relaxed min-h-4"
        [class]="state() === 'failed' ? 'text-rose-700' : 'text-emerald-700'"
      >
        {{ statusText() }}
      </p>

      <p class="text-xs text-neutral-500 leading-relaxed">
        Quem tiver este link entra na empresa com o acesso do convite. Envie só para a pessoa
        convidada.
      </p>
    </div>
  `,
})
export class InviteShare {
  private readonly share = inject(InviteShareService);
  private readonly notifications = inject(NotificationService);

  /** The absolute accept link. Held by the caller; never stored here. */
  readonly link = input.required<string>();
  /** Named in the WhatsApp / share text when the session knows it. */
  readonly companyName = input<string | null>(null);

  protected readonly action = ACTION;
  protected readonly fieldId = `invite-share-link-${++nextShareId}`;
  protected readonly canShare = this.share.canNativeShare();

  protected readonly state = signal<CopyState>('idle');
  private readonly shareError = signal<string | null>(null);

  protected readonly whatsAppUrl = computed(() =>
    this.share.whatsAppUrl(this.link(), this.companyName()),
  );

  protected readonly statusText = computed(() => {
    if (this.shareError()) return this.shareError();
    switch (this.state()) {
      case 'copied':
        return 'Link copiado. Cole na conversa com a pessoa.';
      case 'failed':
        return 'Não foi possível copiar sozinho. Toque no campo acima para selecionar o link, ou use o WhatsApp.';
      default:
        return '';
    }
  });

  constructor() {
    // A new link is a new thing to copy: yesterday's "copiado" must not describe it.
    effect(() => {
      this.link();
      this.state.set('idle');
      this.shareError.set(null);
    });
  }

  protected async copy(): Promise<void> {
    this.shareError.set(null);
    const ok = await this.share.copy(this.link());
    this.state.set(ok ? 'copied' : 'failed');
    if (ok) this.notifications.success('Link copiado');
    else this.notifications.error('Não foi possível copiar o link.');
  }

  protected async shareNative(): Promise<void> {
    this.shareError.set(null);
    const result = await this.share.nativeShare(this.link(), this.companyName());
    if (result === 'failed') {
      this.shareError.set('Não foi possível abrir o compartilhamento. Use o WhatsApp ou copie o link.');
    }
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}
