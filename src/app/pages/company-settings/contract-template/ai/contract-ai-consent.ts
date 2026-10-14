import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ConfirmDialog } from '../../../../components/core/confirm-dialog/confirm-dialog';
import { ContractAiService } from './contract-ai.service';
import { AI_SEND_NOTICE, TextSegment, revealInvisible } from './contract-ai.messages';

/**
 * Tela de consentimento (FEAT-0337/0343): o texto MASCARADO exato que o servidor enviará à
 * IA. Consentimento informado: TODOS os parágrafos são renderizados e a caixa só habilita
 * depois de chegar ao fim do texto. Caracteres invisíveis aparecem como marcadores. O
 * consentimento devolve versão e hash exatamente como recebidos. Texto interpolado, nunca HTML.
 */
@Component({
  selector: 'app-contract-ai-consent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ConfirmDialog],
  template: `
    <div class="space-y-4">
      @if (svc.maskedLoading()) {
        <div class="h-32 rounded-xl bg-neutral-100 animate-pulse" aria-hidden="true"></div>
        <p class="sr-only" role="status">Carregando o texto que será enviado…</p>
      } @else if (svc.masked(); as m) {
        <p class="text-sm text-neutral-800">{{ notice.sent }}</p>

        <p class="text-xs font-semibold text-neutral-600" aria-live="polite">
          {{ seenCount() }} de {{ rows().length }} parágrafos vistos
        </p>

        <div
          #region
          class="max-h-[50vh] overflow-auto rounded-xl border border-neutral-200 bg-neutral-50 p-3 space-y-3"
          tabindex="0"
          role="region"
          aria-label="Texto mascarado que será enviado para a IA. Role até o fim para autorizar."
        >
          @for (row of rows(); track row.id; let i = $index) {
            <p
              class="text-sm text-neutral-900 whitespace-pre-wrap break-words"
              [attr.data-pi]="i"
            >@for (seg of row.segments; track $index) {@if (seg.marker) {<span class="rounded bg-amber-200 px-0.5 font-mono text-xs text-amber-900">{{ seg.text }}</span>} @else {{{ seg.text }}}}</p>
          } @empty {
            <p class="text-sm text-neutral-500">O arquivo não tem texto para enviar.</p>
          }
          <div data-end="1" class="h-px" aria-hidden="true"></div>
        </div>

        @if (invisibleCount() > 0) {
          <p role="note" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Este texto contém {{ invisibleCount() }} caracteres invisíveis, mostrados como
            ⟦U+…⟧. Eles também são enviados.
          </p>
        }

        @if (!viewedAll() && !canObserve) {
          <button
            type="button"
            (click)="markViewed()"
            class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Li o texto inteiro
          </button>
        }
        @if (!viewedAll() && canObserve) {
          <p class="text-xs text-neutral-500">Role o texto até o fim para poder autorizar.</p>
        }

        @if (m.notMasked.length > 0) {
          <section
            class="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm text-amber-900"
            aria-labelledby="ai-notmasked-title"
          >
            <h3 id="ai-notmasked-title" class="font-semibold">O que NÃO é mascarado</h3>
            <ul class="list-disc list-inside space-y-1">
              @for (n of m.notMasked; track n.code) {
                <li>{{ n.label }}</li>
              }
            </ul>
          </section>
        }

        <label class="flex items-start gap-3 min-h-[44px] cursor-pointer text-sm text-neutral-800">
          <input
            type="checkbox"
            class="mt-0.5 h-6 w-6 shrink-0 accent-primary-600"
            [checked]="agreed()"
            [disabled]="svc.busy() || !viewedAll()"
            (change)="onAgree($event)"
          />
          <span>{{ notice.consent }}</span>
        </label>

        <div class="flex flex-col gap-2">
          <button
            type="button"
            (click)="send()"
            [disabled]="!agreed() || !viewedAll() || svc.busy()"
            class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            @if (svc.busy()) { Enviando… } @else { Enviar para análise }
          </button>
          <button
            type="button"
            (click)="confirmOpen.set(true)"
            [disabled]="svc.busy()"
            class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            Descartar arquivo
          </button>
          <button
            type="button"
            (click)="svc.cancelConsent()"
            [disabled]="svc.busy()"
            class="w-full min-h-[44px] rounded-xl text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      } @else {
        <button
          type="button"
          (click)="svc.loadMaskedText()"
          class="w-full min-h-[44px] rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700"
        >
          Tentar carregar de novo
        </button>
        <button
          type="button"
          (click)="confirmOpen.set(true)"
          [disabled]="svc.busy()"
          class="w-full min-h-[44px] rounded-xl text-sm font-medium text-neutral-600"
        >
          Descartar arquivo
        </button>
      }
    </div>

    <app-confirm-dialog
      [open]="confirmOpen()"
      title="Descartar arquivo?"
      message="O arquivo enviado será apagado e nada será analisado."
      confirmLabel="Descartar"
      variant="danger"
      (confirmed)="discardConfirmed()"
      (cancelled)="confirmOpen.set(false)"
    />
  `,
})
export class ContractAiConsent implements OnInit {
  protected readonly svc = inject(ContractAiService);
  protected readonly notice = AI_SEND_NOTICE;
  protected readonly canObserve = typeof IntersectionObserver !== 'undefined';
  protected readonly confirmOpen = signal(false);
  private readonly region = viewChild<ElementRef<HTMLElement>>('region');

  /** Consentimento e leitura valem só para a versão+hash exibidos; texto novo recomeça. */
  private readonly agreedKey = signal<string | null>(null);
  private readonly viewedKey = signal<string | null>(null);
  protected readonly seenCount = signal(0);

  private readonly key = computed(() => {
    const m = this.svc.masked();
    return m ? m.consentVersion + ':' + m.maskedTextSha256 : null;
  });
  protected readonly agreed = computed(
    () => this.key() !== null && this.agreedKey() === this.key(),
  );
  protected readonly viewedAll = computed(
    () => this.key() !== null && this.viewedKey() === this.key(),
  );

  protected readonly rows = computed<{ id: string; segments: TextSegment[]; invisible: number }[]>(
    () =>
      (this.svc.masked()?.paragraphs ?? []).map((p) => {
        const r = revealInvisible(p.text);
        return { id: p.id, segments: r.segments, invisible: r.invisible };
      }),
  );
  protected readonly invisibleCount = computed(() =>
    this.rows().reduce((n, r) => n + r.invisible, 0),
  );

  constructor() {
    afterRenderEffect(() => {
      const root = this.region()?.nativeElement;
      const key = this.key();
      if (!root || !key || typeof IntersectionObserver === 'undefined') return undefined;
      const seen = new Set<number>();
      this.seenCount.set(0);
      const total = this.rows().length;
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const t = e.target as HTMLElement;
            if (t.dataset['end']) {
              this.viewedKey.set(key);
              continue;
            }
            seen.add(Number(t.dataset['pi']));
            this.seenCount.set(seen.size);
          }
          if (total > 0 && seen.size >= total) this.viewedKey.set(key);
        },
        { root, threshold: 0.01 },
      );
      root.querySelectorAll('[data-pi],[data-end]').forEach((el) => io.observe(el));
      return () => io.disconnect();
    });
  }

  ngOnInit(): void {
    this.svc.loadMaskedText();
  }

  protected markViewed(): void {
    this.viewedKey.set(this.key());
    this.seenCount.set(this.rows().length);
  }

  protected onAgree(event: Event): void {
    if (!this.viewedAll()) return;
    const on = (event.target as HTMLInputElement).checked;
    this.agreedKey.set(on ? this.key() : null);
  }

  protected send(): void {
    if (!this.agreed() || !this.viewedAll() || this.svc.busy()) return;
    this.svc.consent();
  }

  protected discardConfirmed(): void {
    this.confirmOpen.set(false);
    this.svc.discard();
  }
}
