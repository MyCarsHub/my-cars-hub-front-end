import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { AnnouncementMediaType } from '../../types/announcement.types';

/** Cores do esqueleto: `app` segue o tema do app; `dark`/`light` são as pranchas da prévia. */
export type AnnouncementMediaTone = 'app' | 'dark' | 'light';

/** Altura do vídeo/imagem em pé: folha (300), janela (320) ou as duas pelo tamanho da tela. */
export type AnnouncementMediaFit = 'sheet' | 'dialog' | 'responsive';

/** Busca de novo a URL assinada (validade curta). `null` = não há outra. */
export type AnnouncementMediaRefresh = () => Observable<string | null>;

/**
 * Mídia da novidade (prancha NovidadeSheetMidia), no topo do aviso e na prévia do admin.
 *
 * - O espaço é reservado na proporção de `width`/`height` (16:9 sem medidas) com esqueleto
 *   até o primeiro quadro: nada pula.
 * - Em pé: altura limitada (300 px na folha, 320 px na janela) com laterais escuras.
 * - Imagem: `<img>` com `alt` (o título). Vídeo: sem som, repetindo, `playsinline`, toca
 *   sozinho; tocar liga/desliga o som. Com "menos movimento" não toca sozinho: mostra o
 *   primeiro quadro e o botão de reproduzir.
 * - Falhou ao carregar: pede a URL de novo UMA vez (`refresh`); se falhar de novo, some e o
 *   aviso segue só com o texto.
 * - Nunca HTML: a URL vai só em `src`.
 */
@Component({
  selector: 'app-announcement-media',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sem mídia (ou falhou): o host some junto, sem deixar margem de quem o posicionou.
  host: { class: 'block', '[class.hidden]': 'hidden()' },
  template: `
    @if (pending()) {
      <div
        class="relative w-full overflow-hidden"
        [class]="radius()"
        [style.aspect-ratio]="'16 / 9'"
        data-testid="media-skeleton"
      >
        <div class="absolute inset-0 motion-safe:animate-pulse" [class]="skeletonClass()" role="img" aria-label="Carregando mídia"></div>
      </div>
    } @else if (src() && !failed()) {
      <div
        class="relative w-full overflow-hidden"
        [class]="boxClass()"
        [style.aspect-ratio]="portrait() ? null : ratio()"
        data-testid="announcement-media"
        [attr.data-type]="type()"
      >
        @if (!loaded()) {
          <div class="absolute inset-0 motion-safe:animate-pulse" [class]="skeletonClass()" role="img" aria-label="Carregando mídia" data-testid="media-loading"></div>
        }
        <div [class]="portrait() ? 'relative mx-auto h-full overflow-hidden' : 'absolute inset-0 overflow-hidden'" [style.aspect-ratio]="portrait() ? ratio() : null">
          @if (type() === 'IMAGE') {
            <img
              [src]="src()"
              [alt]="alt()"
              decoding="async"
              class="absolute inset-0 size-full object-cover transition-opacity"
              [class.opacity-0]="!loaded()"
              data-testid="media-image"
              (load)="onLoaded($event)"
              (error)="onError()"
            />
          } @else {
            <video
              #video
              muted
              loop
              playsinline
              [attr.autoplay]="autoplay() ? '' : null"
              [attr.preload]="autoplay() ? 'auto' : 'metadata'"
              [muted]="muted()"
              [src]="videoSrc()"
              class="absolute inset-0 size-full object-cover"
              [class.opacity-0]="!loaded()"
              aria-hidden="true"
              data-testid="media-video"
              (loadeddata)="onLoaded($event)"
              (error)="onError()"
            ></video>
          }
        </div>
        @if (type() === 'VIDEO' && loaded()) {
          @if (interactive()) {
            <button
              type="button"
              class="absolute inset-0 size-full cursor-pointer focus:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-primary-500"
              [attr.aria-label]="videoAria()"
              [attr.aria-pressed]="playing() ? !muted() : false"
              data-testid="media-video-toggle"
              (click)="tap()"
            ></button>
          }
          @if (!playing()) {
            <span aria-hidden="true" class="pointer-events-none absolute inset-0 grid place-items-center bg-black/30" data-testid="media-play">
              <span class="grid size-16 place-items-center rounded-full bg-black/60 text-white">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
              </span>
            </span>
            <span aria-hidden="true" class="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-3 py-1.5 text-[13px] font-semibold text-white">Toque para reproduzir</span>
          } @else {
            <span
              aria-hidden="true"
              class="pointer-events-none absolute bottom-2.5 right-2.5 inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full bg-black/60 text-[13px] font-semibold text-white"
              [class]="muted() ? 'pl-[11px] pr-3.5' : ''"
              data-testid="media-sound"
            >
              @if (muted()) {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>
                <span>Ativar som</span>
              } @else {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
              }
            </span>
          }
        }
      </div>
    }
  `,
})
export class AnnouncementMedia {
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly type = input<AnnouncementMediaType | null>(null);
  readonly url = input<string | null>(null);
  readonly width = input<number | null>(null);
  readonly height = input<number | null>(null);
  /** Texto alternativo da imagem (o título da novidade). */
  readonly alt = input('');
  readonly tone = input<AnnouncementMediaTone>('app');
  readonly fit = input<AnnouncementMediaFit>('responsive');
  /** `false` na prévia do admin: só desenho, sem botão. */
  readonly interactive = input(true);
  /** De ponta a ponta (topo do popup v2): sem cantos próprios, quem envolve arredonda. */
  readonly edge = input(false);
  /** Envio em andamento (admin): só o esqueleto 16:9. */
  readonly pending = input(false);
  readonly refresh = input<AnnouncementMediaRefresh | null>(null);
  /** A mídia não carregou nem depois de pedir a URL de novo (ela some). */
  readonly failedToLoad = output<void>();

  /** Lido uma vez: "menos movimento" desliga o autoplay. */
  protected readonly reducedMotion =
    this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  protected readonly autoplay = signal(!this.reducedMotion).asReadonly();

  /** URL em uso: a do input, ou a renovada depois de uma falha. */
  private readonly currentUrl = linkedSignal(() => this.url());
  protected readonly loaded = linkedSignal({ source: this.currentUrl, computation: () => false });
  protected readonly failed = linkedSignal({ source: this.url, computation: () => false });
  private readonly refreshed = linkedSignal({ source: this.url, computation: () => false });
  protected readonly playing = linkedSignal({ source: this.currentUrl, computation: () => !this.reducedMotion });
  protected readonly muted = linkedSignal({ source: this.currentUrl, computation: () => true });
  /** Medidas lidas do arquivo quando o servidor não as tinha. */
  private readonly natural = linkedSignal<string | null, { w: number; h: number } | null>({
    source: this.currentUrl,
    computation: () => null,
  });

  protected readonly src = computed(() => this.currentUrl() ?? '');
  protected readonly hidden = computed(() => !this.pending() && (!this.src() || this.failed()));
  /** Sem autoplay, `#t=0.1` faz o navegador mostrar o primeiro quadro (sem capa). */
  protected readonly videoSrc = computed(() => {
    const url = this.src();
    return !this.autoplay() && url && !url.includes('#') ? `${url}#t=0.1` : url;
  });
  private readonly dims = computed(() => {
    const w = this.width();
    const h = this.height();
    if (w && h && w > 0 && h > 0) return { w, h };
    return this.natural() ?? { w: 16, h: 9 };
  });
  protected readonly portrait = computed(() => this.dims().h > this.dims().w);
  protected readonly ratio = computed(() => `${this.dims().w} / ${this.dims().h}`);
  protected readonly portraitBoxClass = computed(() => {
    const h = this.fit() === 'sheet' ? 'h-[300px]' : this.fit() === 'dialog' ? 'h-[320px]' : 'h-[300px] lg:h-[320px]';
    return `${h} bg-[#0a0a0a]`;
  });
  protected readonly radius = computed(() => (this.edge() ? '' : 'rounded-2xl'));
  protected readonly boxClass = computed(() => `${this.radius()} ${this.portrait() ? this.portraitBoxClass() : ''}`.trim());
  protected readonly skeletonClass = computed(() => {
    switch (this.tone()) {
      case 'dark':
        return 'bg-[#262626]';
      case 'light':
        return 'bg-[#EDEDED]';
      default:
        return 'bg-surface-muted';
    }
  });
  protected readonly videoAria = computed(() => {
    if (!this.playing()) return 'Reproduzir vídeo da novidade';
    return this.muted() ? 'Ativar som do vídeo' : 'Desativar som do vídeo';
  });

  protected onLoaded(event: Event): void {
    const el = event.target as HTMLImageElement | HTMLVideoElement | null;
    if (el && !this.width()) {
      const w = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
      const h = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
      if (w > 0 && h > 0) this.natural.set({ w, h });
    }
    this.loaded.set(true);
  }

  protected onError(): void {
    const refresh = this.refresh();
    if (refresh && !this.refreshed()) {
      this.refreshed.set(true);
      refresh()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (next) => {
            if (next && next !== this.currentUrl()) this.currentUrl.set(next);
            else this.fail();
          },
          error: () => this.fail(),
        });
      return;
    }
    this.fail();
  }

  /** Parado (menos movimento): toca. Tocando: liga/desliga o som. */
  protected tap(): void {
    const el = this.video()?.nativeElement;
    if (!this.playing()) {
      this.playing.set(true);
      void el?.play?.()?.catch?.(() => this.playing.set(false));
      return;
    }
    const next = !this.muted();
    this.muted.set(next);
    if (el) el.muted = next;
  }

  private fail(): void {
    if (this.failed()) return;
    this.failed.set(true);
    this.failedToLoad.emit();
  }
}
