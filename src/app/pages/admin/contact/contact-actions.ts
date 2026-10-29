import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { ContactChannel, ContactSubjectType, RevealedContact } from '../../../types/admin-contact.types';
import { AdminContactService, withWhatsAppText } from './admin-contact.service';

/**
 * Contato numa LISTA do admin (D1): mostra só o número mascarado que veio do
 * servidor; WhatsApp, Ligar e Copiar pedem o número inteiro ao endpoint
 * auditado no momento do toque.
 *
 * <p>Visual discreto (dono, 29/10/2026): ícones de 16px em círculos de 32px, alinhados ao
 * número. O ALVO de toque continua com 44px — um pseudo-elemento {@code before:-inset-1.5}
 * estende a área clicável sem aumentar o desenho; o espaçamento de 12px evita sobreposição.</p>
 *
 * <p>Pop-up: o navegador só deixa abrir aba nova DENTRO do gesto. O WhatsApp
 * abre uma aba em branco no toque (síncrono) e só depois troca o endereço,
 * quando a revelação volta. Se o navegador recusou a aba, cai para navegar na
 * própria aba — no celular o wa.me entrega para o app de qualquer jeito.</p>
 */
@Component({
  selector: 'app-contact-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-3 min-w-0' },
  template: `
    @if (phoneMasked(); as masked) {
      <span class="text-sm text-fg-muted tabular-nums truncate" data-testid="phone-masked">{{ masked }}</span>
      <button
        type="button"
        data-testid="contact-whatsapp"
        class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors
               before:absolute before:-inset-1.5 before:content-[''] press
               text-success-700 dark:text-success-300 hover:bg-success-50 dark:hover:bg-success-500/15 disabled:opacity-50
               focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        [disabled]="busy()"
        [attr.aria-label]="'WhatsApp de ' + label()"
        title="WhatsApp"
        (click)="whatsApp($event)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/>
        </svg>
      </button>
      <button
        type="button"
        data-testid="contact-call"
        class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors
               before:absolute before:-inset-1.5 before:content-[''] press
               text-fg-subtle hover:text-fg hover:bg-canvas disabled:opacity-50
               focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        [disabled]="busy()"
        [attr.aria-label]="'Ligar para ' + label()"
        title="Ligar"
        (click)="call($event)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>
        </svg>
      </button>
      <button
        type="button"
        data-testid="contact-copy"
        class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors
               before:absolute before:-inset-1.5 before:content-[''] press
               text-fg-subtle hover:text-fg hover:bg-canvas disabled:opacity-50
               focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        [disabled]="busy()"
        [attr.aria-label]="'Copiar telefone de ' + label()"
        title="Copiar"
        (click)="copy($event)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
    } @else {
      <span class="text-xs text-fg-faint" data-testid="no-phone">sem telefone</span>
    }
  `,
})
export class ContactActions {
  private readonly contacts = inject(AdminContactService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly subjectType = input.required<ContactSubjectType>();
  readonly subjectId = input.required<string>();
  /** Máscara do servidor; nulo = sem telefone. */
  readonly phoneMasked = input<string | null | undefined>(null);
  /** Nome para o aria-label ("WhatsApp de Fulana"). */
  readonly label = input<string>('contato');
  /** Mensagem pré-preenchida do WhatsApp (pt-BR, curta). */
  readonly whatsAppText = input<string | null>(null);
  /** Empresa sendo vista (membros): o servidor prefere o cadastro de motorista dela. */
  readonly contextCompanyId = input<string | null>(null);

  protected readonly busy = signal(false);

  protected async whatsApp(event: Event): Promise<void> {
    event.stopPropagation();
    // Aberta DENTRO do gesto; o endereço chega depois.
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    const contact = await this.fetch('WHATSAPP');
    const link = withWhatsAppText(contact?.waLink ?? null, this.whatsAppText());
    if (!link) {
      tab?.close();
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = link;
    } else {
      window.location.href = link;
    }
  }

  protected async call(event: Event): Promise<void> {
    event.stopPropagation();
    const contact = await this.fetch('CALL');
    if (contact?.telLink) window.location.href = contact.telLink;
  }

  protected async copy(event: Event): Promise<void> {
    event.stopPropagation();
    // Safari só aceita escrever na área de transferência dentro do gesto: o
    // ClipboardItem recebe a PROMESSA do texto, criada aqui, síncrona.
    const pending = this.fetch('COPY');
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = pending.then((c) => {
          if (!c?.e164) throw new Error('sem telefone');
          return new Blob([c.e164], { type: 'text/plain' });
        });
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      } else {
        const c = await pending;
        if (!c?.e164) return;
        await navigator.clipboard.writeText(c.e164);
      }
      this.notify.success('Telefone copiado.');
    } catch {
      const c = await pending;
      if (c?.e164) this.notify.warning(`Não foi possível copiar. Número: ${c.display}`);
    }
  }

  /** Revela (auditado). Nulo = erro já avisado ou sem telefone já avisado. */
  private async fetch(channel: ContactChannel): Promise<RevealedContact | null> {
    this.busy.set(true);
    try {
      const contact = await firstValueFrom(
        this.contacts.reveal(this.subjectType(), this.subjectId(), channel, this.contextCompanyId()),
      );
      if (!contact.available) {
        this.notify.warning('Sem telefone válido cadastrado.');
        return null;
      }
      return contact;
    } catch (err) {
      this.notify.error(
        this.apiErrors.messageFor(err as HttpErrorResponse, 'Não foi possível obter o telefone.'),
      );
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
