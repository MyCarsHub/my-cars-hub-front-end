import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { BottomSheet } from '../core/bottom-sheet/bottom-sheet';
import { CompanyContactQuickForm } from './company-contact-quick-form';
import { Notice, NoticeOutcome, NoticesService } from './notices.service';

/**
 * Popup de avisos (lembretes e novidades), montado UMA vez no shell. Mostra o aviso da frente da
 * fila do `NoticesService`: folha inferior no celular, diálogo centralizado a partir de 1024px —
 * o movimento, o foco preso e o `prefers-reduced-motion` vêm do `BottomSheet`.
 *
 * Aviso bloqueante: sem X, sem Esc, sem clique no fundo; sai só pelos botões do aviso.
 * Sem linhas divisórias; o tipo aparece como texto no chip tingido (REMINDER laranja da marca,
 * NEWS neutro).
 */
@Component({
  selector: 'app-notices-popup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, CompanyContactQuickForm],
  template: `
    @if (notices.current(); as notice) {
      @for (n of [notice]; track n.id) {
        <app-bottom-sheet
          [title]="n.title"
          [closable]="!n.blocking"
          [busy]="!!n.blocking"
          (closed)="onClosed(n)"
        >
          <div class="grid gap-4" data-testid="notice-body">
            <span
              class="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
              [class]="n.type === 'REMINDER' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300' : 'bg-surface-muted text-fg-subtle'"
              data-testid="notice-type"
            >
              {{ n.type === 'REMINDER' ? 'Lembrete' : 'Novidade' }}
            </span>
            <p class="text-base text-fg-body">{{ n.message }}</p>
            @if (n.items?.length) {
              <div>
                <p class="text-sm font-semibold text-fg">
                  {{ n.type === 'REMINDER' ? 'O que falta' : 'O que mudou' }}
                </p>
                <ul class="mt-1 flex flex-wrap gap-2" data-testid="notice-items">
                  @for (item of n.items; track item) {
                    <li class="rounded-full bg-surface-muted px-3 py-1 text-sm text-fg-body">{{ item }}</li>
                  }
                </ul>
              </div>
            }
            @if (n.form === 'company-contact') {
              <app-company-contact-quick-form (saved)="onResolved(n)" />
            }
          </div>
          <div sheetFooter class="grid gap-2">
            @if (n.link) {
              <button
                type="button"
                class="press min-h-[48px] w-full rounded-xl px-5 text-base font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                data-testid="notice-link"
                (click)="openLink(n)"
              >
                {{ n.link.label }}
              </button>
            }
            <button
              type="button"
              class="press min-h-[48px] w-full rounded-xl bg-surface-muted px-5 text-base font-semibold text-fg-body hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              data-testid="notice-dismiss"
              (click)="onDismiss()"
            >
              {{ n.dismissLabel ?? 'Agora não' }}
            </button>
          </div>
        </app-bottom-sheet>
      }
    }
  `,
})
export class NoticesPopup {
  protected readonly notices = inject(NoticesService);
  private readonly router = inject(Router);
  private readonly sheet = viewChild(BottomSheet);
  private pending: NoticeOutcome = 'dismissed';
  private target: string | null = null;

  /** Aviso resolvido (ex.: dados salvos): fecha com a animação e conta como resolvido. */
  protected onResolved(notice: Notice): void {
    void notice;
    this.finishWith('resolved');
  }

  protected onDismiss(): void {
    this.finishWith('dismissed');
  }

  protected openLink(notice: Notice): void {
    this.target = notice.link?.route ?? null;
    this.finishWith('dismissed');
  }

  protected onClosed(notice: Notice): void {
    const outcome = this.pending;
    const target = this.target;
    this.pending = 'dismissed';
    this.target = null;
    if (outcome === 'resolved') this.notices.resolve(notice.id);
    else this.notices.dismiss(notice.id);
    if (target) void this.router.navigateByUrl(target);
  }

  private finishWith(outcome: NoticeOutcome): void {
    this.pending = outcome;
    const sheet = this.sheet();
    if (sheet) sheet.requestClose(true);
  }
}
