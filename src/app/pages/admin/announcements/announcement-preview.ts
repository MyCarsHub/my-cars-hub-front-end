import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NewsNoticeCard } from '../../../components/notices/news-notice-card';
import { NoticeMedia } from '../../../components/notices/notices.service';
import { AnnouncementAudience, AnnouncementMediaType } from '../../../types/announcement.types';

export type PreviewDevice = 'phone' | 'desk';

/**
 * Prévia da novidade como o popup de avisos a mostra (`NoticesPopup` em modo NEWS): folha que
 * sobe de baixo no celular, janela no centro no computador. A área do LOCADORA aparece no
 * tema escuro e a do MOTORISTA no claro, como nas pranchas NovidadePopupV2/NovidadeMotoristaV2; o cartão é o mesmo do popup
 * (`NewsNoticeCard`).
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
            <div class="absolute left-[80px] top-[30px] w-[480px]">
              <ng-container *ngTemplateOutlet="sheet; context: { $implicit: false }" />
            </div>
          </div>
        </div>
      }
    </div>

    <ng-template #sheet let-isSheet>
      <!-- O mesmo cartão do popup (v2), com o tema da área forçado: locadora escura, motorista clara. -->
      <div class="overflow-hidden shadow-2xl" [class]="(isSheet ? 'rounded-t-[28px] ' : 'rounded-[28px] ') + (area() === 'MOTORISTA' ? 'theme-paper' : 'dark')">
        <app-news-notice-card
          titleId="preview-news-title"
          [title]="titleText()"
          [message]="bodyText()"
          [items]="cleanItems()"
          [linkLabel]="linkText()"
          [media]="previewMedia()"
          [mediaPending]="mediaPending()"
          [audience]="area()"
          [layout]="isSheet ? 'sheet' : 'dialog'"
          [interactive]="false"
        />
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet, NewsNoticeCard],
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
  protected readonly previewMedia = computed<NoticeMedia | null>(() => {
    const type = this.mediaType();
    const url = this.mediaUrl();
    return type && url ? { type, url, width: this.mediaWidth(), height: this.mediaHeight() } : null;
  });

  /** Paleta da prancha: escuro (locadora) ou claro (motorista). */
  protected readonly c = computed(() =>
    this.area() === 'MOTORISTA'
      ? {
          bg: 'bg-[#F0F0F0]',
          bar: 'bg-white',
          card: 'bg-white',
          scrim: 'bg-[rgba(16,16,16,0.5)]',
        }
      : {
          bg: 'bg-black',
          bar: 'bg-[#0b0b0b]',
          card: 'bg-[#141414]',
          scrim: 'bg-[rgba(0,0,0,0.66)]',
        },
  );
}
