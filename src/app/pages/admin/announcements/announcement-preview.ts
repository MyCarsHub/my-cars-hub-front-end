import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AnnouncementMedia } from '../../../components/notices/announcement-media';
import { AnnouncementAudience, AnnouncementMediaType } from '../../../types/announcement.types';

export type PreviewDevice = 'phone' | 'desk';

/**
 * Prévia da novidade como o popup de avisos a mostra (`NoticesPopup` em modo NEWS): folha que
 * sobe de baixo no celular, janela no centro no computador. A área do LOCADORA aparece no
 * tema escuro e a do MOTORISTA no claro, como nas pranchas NovidadePopup/NovidadeMotorista.
 *
 * É desenho, não o popup de verdade: nada aqui é clicável (`inert`) e o texto é interpolado,
 * nunca HTML.
 */
@Component({
  selector: 'app-announcement-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .desk { position: relative; width: 333px; height: 346px; border-radius: 16px; overflow: hidden; margin: 0 auto; }
    .desk-inner { position: absolute; left: 0; top: 0; width: 640px; height: 666px; transform: scale(0.52); transform-origin: 0 0; }
    @media (min-width: 640px) {
      .desk { width: 384px; height: 400px; }
      .desk-inner { transform: scale(0.6); }
    }
  `,
  template: `
    <div inert aria-hidden="true" data-testid="announcement-preview" [attr.data-area]="area()" [attr.data-device]="device()">
      @if (device() === 'phone') {
        <div
          class="relative mx-auto h-[620px] w-[280px] overflow-hidden sm:h-[640px] sm:w-[300px] rounded-[40px] border-8 border-neutral-800"
          [class]="c().bg"
        >
          <div class="h-12" [class]="c().bar"></div>
          <div class="flex flex-col gap-2.5 p-3.5">
            <div class="h-[70px] rounded-2xl bg-primary-500"></div>
            <div class="h-[90px] rounded-2xl" [class]="c().card"></div>
            <div class="h-[90px] rounded-2xl" [class]="c().card"></div>
          </div>
          <div class="absolute inset-0" [class]="c().scrim"></div>
          <div class="absolute inset-x-0 bottom-0">
            <ng-container *ngTemplateOutlet="sheet; context: { $implicit: true }" />
          </div>
        </div>
      } @else {
        <div class="desk" [class]="c().bg">
          <div class="desk-inner">
            <div class="flex h-full">
              <div class="w-[150px] flex-none" [class]="c().bar"></div>
              <div class="flex flex-1 flex-col gap-3 p-[22px]">
                <div class="h-[70px] rounded-2xl bg-primary-500"></div>
                <div class="h-[90px] rounded-2xl" [class]="c().card"></div>
              </div>
            </div>
            <div class="absolute inset-0" [class]="c().scrim"></div>
            <div class="absolute left-[120px] top-[30px] w-[400px]">
              <ng-container *ngTemplateOutlet="sheet; context: { $implicit: false }" />
            </div>
          </div>
        </div>
      }
    </div>

    <ng-template #sheet let-isSheet>
      <div
        class="flex flex-col gap-4"
        [class]="(isSheet ? 'rounded-t-3xl px-5 pb-6 pt-2.5 ' : 'rounded-3xl p-6 ') + c().panel"
      >
        @if (isSheet) {
          <span class="mx-auto block h-1.5 w-10 rounded-full" [class]="c().grab"></span>
        }
        @if (mediaPending() || (mediaType() && mediaUrl())) {
          <app-announcement-media
            [type]="mediaType()"
            [url]="mediaUrl()"
            [width]="mediaWidth()"
            [height]="mediaHeight()"
            [alt]="titleText()"
            [pending]="mediaPending()"
            [interactive]="false"
            [tone]="area() === 'MOTORISTA' ? 'light' : 'dark'"
            [fit]="isSheet ? 'sheet' : 'dialog'"
          />
        }
        <div class="flex items-start gap-3">
          <p class="m-0 min-w-0 flex-1 break-words text-xl font-bold leading-tight" [class]="c().title" data-testid="preview-title">
            {{ titleText() }}
          </p>
          <span class="-mr-1 grid size-8 shrink-0 place-items-center" [class]="c().x">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </span>
        </div>
        <span class="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold" [class]="c().chip">Novidade</span>
        <p class="m-0 whitespace-pre-line break-words text-base" [class]="c().body" data-testid="preview-body">{{ bodyText() }}</p>
        @if (cleanItems().length) {
          <div>
            <p class="m-0 text-sm font-semibold" [class]="c().title">O que mudou</p>
            <ul class="mt-1.5 flex flex-wrap gap-2 p-0" data-testid="preview-items">
              @for (item of cleanItems(); track $index) {
                <li class="list-none rounded-full px-3 py-1 text-sm" [class]="c().pill">{{ item }}</li>
              }
            </ul>
          </div>
        }
        <div class="mt-1 grid gap-2">
          @if (linkText()) {
            <span class="grid min-h-12 place-items-center rounded-xl text-base font-semibold" [class]="c().link" data-testid="preview-link">{{ linkText() }}</span>
          }
          <span class="grid min-h-12 place-items-center rounded-xl text-base font-semibold" [class]="c().ok">Entendi</span>
        </div>
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet, AnnouncementMedia],
})
export class AnnouncementPreview {
  readonly title = input('');
  readonly body = input('');
  readonly items = input<readonly string[]>([]);
  readonly linkLabel = input<string | null>(null);
  readonly area = input<AnnouncementAudience>('LOCADORA');
  readonly device = input<PreviewDevice>('phone');
  /** Mídia gravada (URL assinada, curta) ou envio em andamento (só o esqueleto). */
  readonly mediaType = input<AnnouncementMediaType | null>(null);
  readonly mediaUrl = input<string | null>(null);
  readonly mediaWidth = input<number | null>(null);
  readonly mediaHeight = input<number | null>(null);
  readonly mediaPending = input(false);

  protected readonly titleText = computed(() => this.title().trim() || 'Título da novidade');
  protected readonly bodyText = computed(() => this.body().trim() || 'O texto aparece aqui.');
  protected readonly cleanItems = computed(() => this.items().map((s) => s.trim()).filter((s) => s.length > 0));
  protected readonly linkText = computed(() => (this.linkLabel() ?? '').trim());

  /** Paleta da prancha: escuro (locadora) ou claro (motorista). */
  protected readonly c = computed(() =>
    this.area() === 'MOTORISTA'
      ? {
          bg: 'bg-[#F0F0F0]',
          bar: 'bg-white',
          card: 'bg-white',
          scrim: 'bg-[rgba(16,16,16,0.45)]',
          panel: 'bg-white text-[#171717] shadow-2xl',
          grab: 'bg-[#D4D4D4]',
          title: 'text-[#171717]',
          x: 'text-[#525252]',
          chip: 'bg-[#F0F0F0] text-[#525252]',
          body: 'text-[#404040]',
          pill: 'bg-[#F0F0F0] text-[#404040]',
          link: 'text-[#C22F00]',
          ok: 'bg-[#F0F0F0] text-[#262626]',
        }
      : {
          bg: 'bg-black',
          bar: 'bg-[#0b0b0b]',
          card: 'bg-[#141414]',
          scrim: 'bg-[rgba(0,0,0,0.62)]',
          panel: 'bg-[#171717] text-[#F4F4F5] shadow-2xl',
          grab: 'bg-[#404040]',
          title: 'text-[#F4F4F5]',
          x: 'text-[#A3A3A3]',
          chip: 'bg-white/10 text-[#D4D4D4]',
          body: 'text-[#D4D4D4]',
          pill: 'bg-[#262626] text-[#E5E5E5]',
          link: 'text-[#FF8A5C]',
          ok: 'bg-[#262626] text-[#F4F4F5]',
        },
  );
}
