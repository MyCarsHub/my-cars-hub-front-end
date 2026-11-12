import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { BottomSheet } from '../core/bottom-sheet/bottom-sheet';
import { NewsNoticeCard } from './news-notice-card';
import { CompanyContactQuickForm } from './company-contact-quick-form';
import { Notice, NoticeOutcome, NoticesService } from './notices.service';

/**
 * Popup de avisos (lembretes e novidades), montado UMA vez no shell. Mostra o aviso da frente da
 * fila do `NoticesService`: folha inferior no celular, diálogo centralizado a partir de 1024px —
 * o movimento, o foco preso e o `prefers-reduced-motion` vêm do `BottomSheet`.
 *
 * Aviso bloqueante: sem X, sem Esc, sem clique no fundo; sai só pelos botões do aviso.
 * Novidade (NEWS) usa o visual v2 (`NewsNoticeCard` numa folha `bare`): topo de mídia ou laranja da
 * marca, checklist, botão principal laranja; várias seguidas mostram "1 de 3" e "Próxima".
 * Sem linhas divisórias; o tipo aparece como texto no chip tingido (REMINDER laranja da marca,
 * NEWS neutro).
 */
@Component({
  selector: 'app-notices-popup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, CompanyContactQuickForm, NewsNoticeCard],
  template: `
    @if (notices.current(); as notice) {
      @for (n of [notice]; track n.id) {
        @if (n.type === 'NEWS') {
          <!-- Lazy: o cartão v2 (e a mídia) só baixa quando há novidade — fora do bundle inicial. -->
          @defer (on immediate) {
          <app-bottom-sheet
            variant="bare"
            [title]="n.title"
            [labelledBy]="newsTitleId"
            [closable]="!n.blocking"
            [busy]="!!n.blocking"
            (closed)="onClosed(n)"
          >
            <app-news-notice-card
              sheetBare
              [titleId]="newsTitleId"
              [title]="n.title"
              [message]="n.message"
              [items]="n.items"
              [linkLabel]="n.link?.label ?? null"
              [media]="n.media ?? null"
              [audience]="n.audience ?? 'LOCADORA'"
              [index]="newsIndex()"
              [total]="newsTotal()"
              [closable]="!n.blocking"
              (linkRequested)="openLink(n)"
              (dismissRequested)="onDismiss()"
              (closeRequested)="onDismiss()"
            />
          </app-bottom-sheet>
          }
        } @else {
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
            <p class="whitespace-pre-line break-words text-base text-fg-body" data-testid="notice-message">{{ n.message }}</p>
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
              <app-company-contact-quick-form [signerReadOnly]="n.signerReadOnly === true" (saved)="onResolved(n)" />
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
    }
  `,
})
export class NoticesPopup {
  protected readonly notices = inject(NoticesService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly sheet = viewChild(BottomSheet);
  private pending: NoticeOutcome = 'dismissed';
  protected readonly newsTitleId = 'news-notice-title';
  /**
   * Novidades já fechadas em sequência nesta leva (a fila do `NoticesService`). Cada uma é
   * marcada como lida pela própria saída; isto só numera "1 de 3".
   */
  private readonly newsRun = signal(0);
  protected readonly newsIndex = computed(() => this.newsRun() + 1);
  protected readonly newsTotal = computed(
    () => this.newsRun() + this.notices.queue().filter((n) => n.type === 'NEWS').length,
  );
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
    const route = notice.link?.route ?? null;
    if (route && /^https:\/\//i.test(route)) {
      // Endereço externo: abre já, dentro do gesto do clique (bloqueador de popup), em outra aba.
      this.doc.defaultView?.open(route, '_blank', 'noopener,noreferrer');
      this.target = null;
    } else {
      // Só rota do app (`/algo`, nunca `//host`); qualquer outra coisa é ignorada.
      this.target = route && route.startsWith('/') && !route.startsWith('//') ? route : null;
    }
    this.finishWith('dismissed');
  }

  protected onClosed(notice: Notice): void {
    const outcome = this.pending;
    const target = this.target;
    this.pending = 'dismissed';
    this.target = null;
    if (outcome === 'resolved') this.notices.resolve(notice.id);
    else this.notices.dismiss(notice.id);
    const next = this.notices.current();
    this.newsRun.set(notice.type === 'NEWS' && next?.type === 'NEWS' ? this.newsRun() + 1 : 0);
    if (target) void this.router.navigateByUrl(target);
  }

  private finishWith(outcome: NoticeOutcome): void {
    this.pending = outcome;
    const sheet = this.sheet();
    if (sheet) sheet.requestClose(true);
  }
}
