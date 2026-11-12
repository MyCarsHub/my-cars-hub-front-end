import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { AnnouncementAudience } from '../../types/announcement.types';
import { AnnouncementMedia } from './announcement-media';
import { NoticeMedia } from './notices.service';

/** `responsive`: folha até 1023 px, janela de 480 px a partir de 1024 px. Os outros fixam um (prévia). */
export type NewsCardLayout = 'responsive' | 'sheet' | 'dialog';

/**
 * Corpo da novidade v2 (pranchas NovidadePopupV2 / NovidadeMotoristaV2 / NovidadeSheetV2):
 * topo de ponta a ponta (mídia, ou laranja sólido da marca com o desenho), selo "Novidade" com
 * estrela, título grande, "O que mudou" como lista com check, botão principal laranja com seta
 * e "Entendi" quieto (laranja quando não há link). Várias novidades: barras + "1 de 3" e o botão
 * quieto vira "Próxima".
 *
 * Só espaço entre os blocos, sem linhas. Texto sempre interpolado, nunca HTML. Cores: claro por
 * padrão, `dark:` no tema escuro (a prévia do admin força com `.dark` / `.theme-paper`).
 * A mídia em si (proporção, esqueleto, vídeo, menos movimento, falha) é do `AnnouncementMedia`;
 * se ela falhar, o topo volta a ser o laranja da marca.
 */
@Component({
  selector: 'app-news-notice-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnnouncementMedia],
  host: { class: 'block' },
  styles: `
    @keyframes nv2-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    @keyframes nv2-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes nv2-spark {
      0% { opacity: 0; transform: scale(0.4) rotate(-30deg); }
      60% { opacity: 1; transform: scale(1.12) rotate(6deg); }
      100% { opacity: 1; transform: none; }
    }
    .s1, .s2, .s3, .s4 { animation: nv2-in 420ms cubic-bezier(0.32, 0.72, 0, 1) both; }
    .s1 { animation-delay: 140ms; }
    .s2 { animation-delay: 200ms; }
    .s3 { animation-delay: 260ms; }
    .s4 { animation-delay: 320ms; }
    .spark { transform-box: fill-box; transform-origin: 50% 50%; animation: nv2-spark 700ms cubic-bezier(0.34, 1.4, 0.64, 1) 180ms both; }
    .btn { transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1), background-color 160ms; }
    .btn:active { transform: scale(0.97); }
    @media (prefers-reduced-motion: reduce) {
      .s1, .s2, .s3, .s4, .spark { animation: nv2-fade 160ms linear both; }
      .btn { transition: none; }
      .btn:active { transform: none; }
    }
  `,
  template: `
    <article class="flex flex-col bg-white text-[#121212] dark:bg-[#151515] dark:text-[#FAFAFA]" data-testid="news-card">
      <div class="relative w-full shrink-0 overflow-hidden" data-testid="news-hero" [attr.data-hero]="showMedia() ? 'media' : 'brand'">
        @if (showMedia()) {
          <app-announcement-media
            [edge]="true"
            [pending]="mediaPending()"
            [type]="media()?.type ?? null"
            [url]="media()?.url ?? null"
            [width]="media()?.width ?? null"
            [height]="media()?.height ?? null"
            [alt]="title()"
            [interactive]="interactive()"
            [fit]="layout() === 'responsive' ? 'responsive' : layout()"
            [refresh]="media()?.refresh ?? null"
            (failedToLoad)="mediaFailed.set(true)"
          />
        } @else {
          <div class="relative overflow-hidden bg-[#F63B04]" [class]="L().brandHeight" data-testid="news-brand">
            <svg class="absolute inset-0 size-full" viewBox="0 0 440 188" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
              <g stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="1.5">
                <circle cx="350" cy="96" r="44" /><circle cx="350" cy="96" r="78" /><circle cx="350" cy="96" r="114" /><circle cx="350" cy="96" r="152" />
              </g>
              <g stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" stroke-linecap="round">
                <path d="M-10 150 C 90 150, 150 120, 230 120" /><path d="M-10 166 C 100 166, 170 136, 250 136" />
              </g>
              <path class="spark" d="M350 52 C 354 80, 366 92, 394 96 C 366 100, 354 112, 350 140 C 346 112, 334 100, 306 96 C 334 92, 346 80, 350 52 Z" fill="#FFFFFF" />
              <path d="M404 34 C 405.5 42, 409 45.5, 417 47 C 409 48.5, 405.5 52, 404 60 C 402.5 52, 399 48.5, 391 47 C 399 45.5, 402.5 42, 404 34 Z" fill="#FFFFFF" fill-opacity="0.85" />
              <path d="M292 138 C 293 143, 295 145, 300 146 C 295 147, 293 149, 292 154 C 291 149, 289 147, 284 146 C 289 145, 291 143, 292 138 Z" fill="#FFFFFF" fill-opacity="0.7" />
              <circle cx="268" cy="58" r="3" fill="#FFFFFF" fill-opacity="0.55" />
            </svg>
            <span class="absolute bottom-5 left-6 text-[13px] font-bold uppercase tracking-[0.08em] text-white">{{ heroWord() }}</span>
          </div>
        }

        @if (multi()) {
          <div aria-hidden="true" class="pointer-events-none absolute left-4 right-[72px] top-3.5 flex gap-1" data-testid="news-progress">
            @for (s of segments(); track $index) {
              <span class="h-[3px] flex-1 rounded-sm shadow-[0_1px_2px_rgba(0,0,0,0.25)]" [class]="s ? 'bg-white' : 'bg-white/40'"></span>
            }
          </div>
        }
        @if (L().grab) {
          <span aria-hidden="true" class="pointer-events-none absolute left-1/2 top-2 -ml-5 h-[5px] w-10 rounded-full bg-white/70" [class]="L().grab"></span>
        }
        @if (closable()) {
          <button
            type="button"
            class="press absolute right-2 top-2 grid size-11 place-items-center rounded-full text-white focus:outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#FF8A5C]"
            [class]="showMedia() ? 'bg-black/50' : 'bg-black/20'"
            aria-label="Fechar"
            data-testid="bottom-sheet-close"
            (click)="closeRequested.emit()"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        }
      </div>

      <div class="flex flex-col gap-5" [class]="L().body" data-testid="notice-body">
        <div class="s1 flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <span
              class="inline-flex w-fit items-center gap-1.5 rounded-full py-[5px] pl-2.5 pr-3 text-[13px] font-bold tracking-[0.01em]
                     bg-[#FFE9E0] text-[#B32B00] dark:bg-[rgba(246,59,4,0.18)] dark:text-[#FF8A5C]"
              data-testid="notice-type"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.6 4.8 2.6 7.4 8 8.2v1.6c-5.4.8-7.4 3.4-8 8.2h-1.6c-.6-4.8-2.6-7.4-8-8.2v-1.6c5.4-.8 7.4-3.4 8-8.2z" transform="translate(.8 1)" /></svg>
              Novidade
            </span>
            @if (multi()) {
              <span class="text-[13px] font-semibold tabular-nums text-[#5C5C5C] dark:text-[#A3A3A3]" data-testid="news-count">{{ index() }} de {{ total() }}</span>
            }
          </div>
          <h2
            [id]="titleId()"
            class="m-0 break-words font-extrabold leading-[1.12] tracking-[-0.9px] [text-wrap:balance]"
            [class]="L().title"
            data-testid="news-title"
          >{{ title() }}</h2>
        </div>
        <p class="s2 m-0 whitespace-pre-line break-words text-base leading-6 text-[#474747] dark:text-[#C9C9C9]" data-testid="notice-message">{{ message() }}</p>
        @if (cleanItems().length) {
          <div class="s3 flex flex-col gap-3">
            <p class="m-0 text-[13px] font-bold uppercase tracking-[0.06em] text-[#6B6B6B] dark:text-[#9E9E9E]">O que mudou</p>
            <ul class="m-0 flex list-none flex-col gap-3 p-0" data-testid="notice-items">
              @for (item of cleanItems(); track $index) {
                <li class="flex items-start gap-3 text-base font-medium leading-[22px] text-[#262626] dark:text-[#EDEDED]">
                  <span aria-hidden="true" class="grid size-6 shrink-0 place-items-center rounded-full bg-[#FFE9E0] text-[#D93400] dark:bg-[rgba(246,59,4,0.18)] dark:text-[#FF7A45]" data-testid="news-check">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </span>
                  <span class="min-w-0 break-words pt-px">{{ item }}</span>
                </li>
              }
            </ul>
          </div>
        }
        <div class="s4 mt-2 flex gap-2.5" [class]="L().actions">
          @if (linkText()) {
            <button
              type="button"
              data-autofocus
              class="btn inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#F63B04] px-5 text-base font-bold tracking-[-0.1px] text-white
                     shadow-[0_8px_20px_rgba(246,59,4,0.28)] hover:bg-primary-600 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#FF8A5C]"
              data-testid="notice-link"
              (click)="linkRequested.emit()"
            >
              {{ linkText() }}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          }
          <button
            type="button"
            [attr.data-autofocus]="linkText() ? null : ''"
            class="btn inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-5 text-base font-bold tracking-[-0.1px]
                   focus:outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#FF8A5C]"
            [class]="linkText() ? L().quiet : 'flex-1 bg-[#F63B04] text-white shadow-[0_8px_20px_rgba(246,59,4,0.28)] hover:bg-primary-600'"
            [attr.data-tone]="linkText() ? 'quiet' : 'primary'"
            data-testid="notice-dismiss"
            (click)="dismissRequested.emit()"
          >{{ okLabel() }}</button>
        </div>
      </div>
    </article>
  `,
})
export class NewsNoticeCard {
  readonly title = input.required<string>();
  readonly message = input('');
  readonly items = input<readonly string[] | null | undefined>(null);
  readonly linkLabel = input<string | null | undefined>(null);
  readonly media = input<NoticeMedia | null | undefined>(null);
  readonly audience = input<AnnouncementAudience>('LOCADORA');
  /** Envio em andamento (prévia do admin): o topo mostra o esqueleto 16:9. */
  readonly mediaPending = input(false);
  /** Posição na fila de novidades desta sessão (1-based) e quantas há. */
  readonly index = input(1);
  readonly total = input(1);
  readonly layout = input<NewsCardLayout>('responsive');
  readonly closable = input(true);
  /** `false` na prévia do admin (o vídeo não vira botão). */
  readonly interactive = input(true);
  readonly titleId = input('news-notice-title');

  readonly linkRequested = output<void>();
  readonly dismissRequested = output<void>();
  readonly closeRequested = output<void>();

  /** A mídia não carregou: o topo volta ao laranja da marca (o resto segue igual). */
  protected readonly mediaFailed = linkedSignal({ source: () => this.media()?.url ?? null, computation: () => false });
  protected readonly showMedia = computed(() => this.mediaPending() || (!!this.media()?.url && !this.mediaFailed()));
  protected readonly multi = computed(() => this.total() > 1);
  protected readonly segments = computed(() =>
    Array.from({ length: Math.max(1, this.total()) }, (_, i) => i < this.index()),
  );
  protected readonly okLabel = computed(() => (this.multi() && this.index() < this.total() ? 'Próxima' : 'Entendi'));
  protected readonly cleanItems = computed(() => (this.items() ?? []).map((s) => s.trim()).filter((s) => s.length > 0));
  protected readonly linkText = computed(() => (this.linkLabel() ?? '').trim());
  protected readonly heroWord = computed(() => (this.audience() === 'MOTORISTA' ? 'Para você' : 'Novo no MyCarsHub'));

  /** Classes de folha × janela; `responsive` troca em 1024 px (`lg`). */
  protected readonly L = computed(() => {
    const sheet = {
      brandHeight: 'h-[172px]',
      grab: 'block',
      body: 'px-5 pb-7 pt-6',
      title: 'text-[26px]',
      actions: 'flex-col',
      quiet: 'bg-transparent text-[#474747] dark:text-[#C9C9C9]',
    };
    const dialog = {
      brandHeight: 'h-[188px]',
      grab: '',
      body: 'p-7',
      title: 'text-[28px]',
      actions: 'flex-row-reverse',
      quiet: 'flex-none min-w-[132px] bg-[#F2F2F2] text-[#262626] dark:bg-[#242424] dark:text-[#F4F4F5]',
    };
    switch (this.layout()) {
      case 'sheet':
        return sheet;
      case 'dialog':
        return dialog;
      default:
        return {
          brandHeight: 'h-[172px] lg:h-[188px]',
          grab: 'block lg:hidden',
          body: 'px-5 pb-7 pt-6 lg:p-7',
          title: 'text-[26px] lg:text-[28px]',
          actions: 'flex-col lg:flex-row-reverse',
          quiet:
            'bg-transparent text-[#474747] dark:text-[#C9C9C9] lg:flex-none lg:min-w-[132px] lg:bg-[#F2F2F2] lg:text-[#262626] dark:lg:bg-[#242424] dark:lg:text-[#F4F4F5]',
        };
    }
  });
}
