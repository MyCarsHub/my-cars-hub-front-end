import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import {
  ContactChannel,
  ContactSubjectType,
  RevealedContact,
} from '../../../types/admin-contact.types';
import { AdminContactService, mailtoLink, withWhatsAppText } from './admin-contact.service';

/**
 * Barra de contato do DETALHE (pessoa / empresa): número + WhatsApp, Ligar,
 * E-mail e Copiar (admin v2, D1).
 *
 * <p>Abrir a página NÃO revela nada: a barra mostra o `phoneMasked` que veio do
 * servidor. O número inteiro só chega pela revelação auditada quando o admin
 * toca em "Ver número" (canal VIEW), WhatsApp, Ligar ou Copiar — cada toque é
 * um ato explícito e vai para a trilha com o próprio canal. Depois de revelado,
 * o número fica visível na barra.</p>
 *
 * <p>WhatsApp e Copiar têm o mesmo cuidado com o gesto que `ContactActions`:
 * a aba é aberta no toque, e o texto da área de transferência é uma promessa
 * criada no toque.</p>
 */
@Component({
  selector: 'app-contact-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-edge bg-surface p-4 sm:p-5"
      aria-label="Contato"
      data-testid="contact-bar"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <p class="text-xs text-fg-subtle uppercase tracking-wide">{{ heading() }}</p>
          @if (contact()?.display; as display) {
            <p class="mt-1 text-lg font-semibold text-fg tabular-nums" data-testid="contact-display">
              {{ display }}
            </p>
            @if (!contact()?.mobile) {
              <p class="text-[11px] text-fg-faint">Fixo — pode não ter WhatsApp.</p>
            }
          } @else if (phoneMasked(); as masked) {
            <div class="mt-1 flex items-center gap-3">
              <p class="text-lg font-semibold text-fg-muted tabular-nums" data-testid="contact-masked">
                {{ masked }}
              </p>
              <button
                type="button"
                data-testid="bar-reveal"
                class="inline-flex items-center min-h-[44px] px-2 -my-2 rounded-lg text-sm font-medium
                       text-primary-700 dark:text-primary-300 hover:underline disabled:opacity-50
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                [disabled]="busy()"
                (click)="reveal()"
              >Ver número</button>
            </div>
          } @else {
            <p class="mt-1 text-sm text-fg-subtle" data-testid="contact-none">
              Sem telefone cadastrado.
            </p>
          }
          @if (email(); as mail) {
            <p class="text-xs text-fg-subtle break-all mt-0.5">{{ mail }}</p>
          }
        </div>

        <div class="grid grid-cols-4 gap-2 sm:flex sm:gap-2">
          <button
            type="button"
            data-testid="bar-whatsapp"
            class="inline-flex flex-col sm:flex-row items-center justify-center gap-1 min-h-[48px] px-3 rounded-xl
                   bg-success-50 text-success-900 dark:bg-success-500/15 dark:text-success-100
                   hover:bg-success-100 dark:hover:bg-success-500/25 text-xs sm:text-sm font-medium
                   disabled:opacity-40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [disabled]="!hasPhone() || busy()"
            (click)="whatsApp()"
          >WhatsApp</button>
          <button
            type="button"
            data-testid="bar-call"
            class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge
                   text-fg-soft hover:bg-canvas text-xs sm:text-sm font-medium disabled:opacity-40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [disabled]="!hasPhone() || busy()"
            (click)="call()"
          >Ligar</button>
          @if (mailHref(); as mail) {
            <a
              [href]="mail"
              data-testid="bar-email"
              class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge
                     text-fg-soft hover:bg-canvas text-xs sm:text-sm font-medium
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >E-mail</a>
          } @else {
            <span class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge-soft
                         text-xs sm:text-sm text-fg-faint" aria-disabled="true">E-mail</span>
          }
          <button
            type="button"
            data-testid="bar-copy"
            class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge
                   text-fg-soft hover:bg-canvas text-xs sm:text-sm font-medium disabled:opacity-40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [disabled]="!hasPhone() || busy()"
            (click)="copy()"
          >Copiar</button>
        </div>
      </div>
    </section>
  `,
})
export class ContactBar {
  private readonly contacts = inject(AdminContactService);
  private readonly notify = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly subjectType = input.required<ContactSubjectType>();
  readonly subjectId = input.required<string>();
  /** Máscara do servidor; nulo = não há telefone, e então não há o que revelar. */
  readonly phoneMasked = input<string | null | undefined>(null);
  /** E-mail já conhecido pela tela (o da revelação, quando houver, tem prioridade). */
  readonly fallbackEmail = input<string | null | undefined>(null);
  readonly heading = input<string>('Contato');
  readonly whatsAppText = input<string | null>(null);

  /** Preenchido só depois de um toque do admin; nunca no carregamento. */
  protected readonly contact = signal<RevealedContact | null>(null);
  protected readonly busy = signal(false);

  protected readonly hasPhone = computed(() => !!this.phoneMasked());
  protected readonly email = computed(() => this.contact()?.email ?? this.fallbackEmail() ?? null);
  protected readonly mailHref = computed(() => mailtoLink(this.email()));

  constructor() {
    // Outro sujeito na mesma instância: esquece o número revelado do anterior.
    // Só limpa estado — nenhuma requisição sai daqui.
    effect(() => {
      this.subjectType();
      this.subjectId();
      this.phoneMasked();
      untracked(() => this.contact.set(null));
    });
  }

  protected async reveal(): Promise<void> {
    await this.fetch('VIEW');
  }

  protected async whatsApp(): Promise<void> {
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

  protected async call(): Promise<void> {
    const contact = await this.fetch('CALL');
    if (contact?.telLink) window.location.href = contact.telLink;
  }

  protected async copy(): Promise<void> {
    // Safari só aceita escrever na área de transferência dentro do gesto.
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

  /** Revela (auditado, com o canal do toque). Nulo = erro ou sem telefone, já avisados. */
  private async fetch(channel: ContactChannel): Promise<RevealedContact | null> {
    const id = this.subjectId();
    if (!id || !this.phoneMasked()) return null;
    this.busy.set(true);
    try {
      const contact = await firstValueFrom(this.contacts.reveal(this.subjectType(), id, channel));
      if (!contact.available) {
        this.notify.warning('Sem telefone válido cadastrado.');
        return null;
      }
      this.contact.set(contact);
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
