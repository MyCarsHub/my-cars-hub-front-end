import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { ContactSubjectType, RevealedContact } from '../../../types/admin-contact.types';
import { AdminContactService, mailtoLink, withWhatsAppText } from './admin-contact.service';

/**
 * Barra de contato do DETALHE (pessoa / empresa): número completo + WhatsApp,
 * Ligar, E-mail e Copiar (admin v2, D1: "completo no detalhe").
 *
 * <p>O número completo vem da revelação auditada com canal VIEW, pedida UMA vez
 * ao abrir — e só quando o servidor disse que existe telefone
 * (`phoneMasked` não nulo). Depois disso os botões são links comuns: um toque,
 * sem nova requisição, sem bloqueio de pop-up.</p>
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
          @if (loading()) {
            <div class="mt-1 h-6 w-40 rounded bg-surface-sunken animate-pulse"></div>
          } @else if (contact()?.display; as display) {
            <p class="mt-1 text-lg font-semibold text-fg tabular-nums" data-testid="contact-display">
              {{ display }}
            </p>
            @if (!contact()?.mobile) {
              <p class="text-[11px] text-fg-faint">Fixo — pode não ter WhatsApp.</p>
            }
          } @else {
            <p class="mt-1 text-sm text-fg-subtle" data-testid="contact-none">
              {{ error() ?? 'Sem telefone cadastrado.' }}
            </p>
          }
          @if (email(); as mail) {
            <p class="text-xs text-fg-subtle break-all mt-0.5">{{ mail }}</p>
          }
        </div>

        <div class="grid grid-cols-4 gap-2 sm:flex sm:gap-2">
          @if (whatsAppHref(); as wa) {
            <a
              [href]="wa"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="bar-whatsapp"
              class="inline-flex flex-col sm:flex-row items-center justify-center gap-1 min-h-[48px] px-3 rounded-xl
                     bg-success-50 text-success-900 dark:bg-success-500/15 dark:text-success-100
                     hover:bg-success-100 dark:hover:bg-success-500/25 text-xs sm:text-sm font-medium
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >WhatsApp</a>
          } @else {
            <span class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge-soft
                         text-xs sm:text-sm text-fg-faint" aria-disabled="true">WhatsApp</span>
          }
          @if (contact()?.telLink; as tel) {
            <a
              [href]="tel"
              data-testid="bar-call"
              class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge
                     text-fg-soft hover:bg-canvas text-xs sm:text-sm font-medium
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >Ligar</a>
          } @else {
            <span class="inline-flex items-center justify-center min-h-[48px] px-3 rounded-xl border border-edge-soft
                         text-xs sm:text-sm text-fg-faint" aria-disabled="true">Ligar</span>
          }
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
            [disabled]="!contact()?.e164"
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
  private readonly destroyRef = inject(DestroyRef);

  readonly subjectType = input.required<ContactSubjectType>();
  readonly subjectId = input.required<string>();
  /** Máscara do servidor; nulo = não há telefone, e então nem se revela (nada a auditar). */
  readonly phoneMasked = input<string | null | undefined>(null);
  /** E-mail já conhecido pela tela (o da revelação, quando houver, tem prioridade). */
  readonly fallbackEmail = input<string | null | undefined>(null);
  readonly heading = input<string>('Contato');
  readonly whatsAppText = input<string | null>(null);

  protected readonly contact = signal<RevealedContact | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly email = computed(() => this.contact()?.email ?? this.fallbackEmail() ?? null);
  protected readonly mailHref = computed(() => mailtoLink(this.email()));
  protected readonly whatsAppHref = computed(() =>
    withWhatsAppText(this.contact()?.waLink ?? null, this.whatsAppText()),
  );

  constructor() {
    effect(() => {
      const type = this.subjectType();
      const id = this.subjectId();
      const masked = this.phoneMasked();
      untracked(() => this.load(type, id, masked));
    });
  }

  private load(type: ContactSubjectType, id: string, masked: string | null | undefined): void {
    this.contact.set(null);
    this.error.set(null);
    if (!id || !masked) return;
    this.loading.set(true);
    this.contacts
      .reveal(type, id, 'VIEW')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.loading.set(false);
          this.contact.set(c);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar o telefone.'));
        },
      });
  }

  protected async copy(): Promise<void> {
    const c = this.contact();
    if (!c?.e164) return;
    try {
      await navigator.clipboard.writeText(c.e164);
      this.notify.success('Telefone copiado.');
    } catch {
      this.notify.warning(`Não foi possível copiar. Número: ${c.display}`);
    }
  }
}
