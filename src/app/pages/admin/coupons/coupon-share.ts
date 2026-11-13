import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { SegmentedTabs, SegmentedTabsOption } from '../../../components/core/segmented-tabs/segmented-tabs';
import { NotificationService } from '../../../services/notification.service';
import { AdminCoupon } from '../../../types/admin-coupon.types';
import { CardFormat, CardTone, CouponCardRenderer, cardContent, cardFileName } from './coupon-card-image';
import { copyCouponCode, copyCouponMessage, shareMessage } from './coupon-copy';

const FORMAT_OPTIONS: readonly SegmentedTabsOption<CardFormat>[] = [
  { value: 'SQUARE', label: 'Quadrado', testId: 'share-format-square' },
  { value: 'STORY', label: 'Story', testId: 'share-format-story' },
];

const TONE_OPTIONS: readonly SegmentedTabsOption<CardTone>[] = [
  { value: 'ORANGE', label: 'Laranja', testId: 'share-tone-orange' },
  { value: 'WHITE', label: 'Branco', testId: 'share-tone-white' },
];

const CODE_LINE = 'Use o código:';

/**
 * "Compartilhar cupom": a imagem pronta (quadrado ou story, laranja ou branca) e a
 * mensagem que vai junto. No celular, "Compartilhar imagem" abre a folha de apps do
 * sistema (WhatsApp, Instagram...); onde não dá para compartilhar arquivo, a imagem é
 * baixada. A imagem é gerada antes do toque: o iPhone só abre a folha de apps se o
 * compartilhamento sair direto do toque, sem esperar nada.
 */
@Component({
  selector: 'app-coupon-share',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, SegmentedTabs],
  templateUrl: './coupon-share.html',
})
export class CouponShare implements OnInit {
  private readonly renderer = inject(CouponCardRenderer);
  private readonly notify = inject(NotificationService);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly coupon = input.required<AdminCoupon>();
  /** Nome da empresa do código de empresa: a mensagem fala com ela. */
  readonly company = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly formatOptions = FORMAT_OPTIONS;
  protected readonly toneOptions = TONE_OPTIONS;
  protected readonly format = signal<CardFormat>('SQUARE');
  protected readonly tone = signal<CardTone>('ORANGE');

  private readonly blob = signal<Blob | null>(null);
  protected readonly imageUrl = signal<string | null>(null);
  protected readonly rendering = signal(true);
  protected readonly renderError = signal(false);
  protected readonly sharing = signal(false);
  /** Cada troca de formato ou cor invalida o desenho em voo. */
  private generation = 0;

  protected readonly code = computed(() => this.coupon().promotionCode ?? '');

  protected readonly message = computed(() =>
    shareMessage({ code: this.code(), coupon: this.coupon(), company: this.company() }),
  );

  /** A mensagem em parágrafos; o do código mostra o código sozinho, em destaque. */
  protected readonly paragraphs = computed(() =>
    this.message()
      .split('\n\n')
      .map((text) => (text.startsWith(CODE_LINE) ? { text: CODE_LINE, code: this.code() } : { text, code: null })),
  );

  protected readonly imageAlt = computed(() => `Imagem do cupom ${this.code()}`);

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.generation++;
      this.revoke();
    });
    void this.draw();
  }

  protected setFormat(format: CardFormat): void {
    if (format === this.format()) return;
    this.format.set(format);
    void this.draw();
  }

  protected setTone(tone: CardTone): void {
    if (tone === this.tone()) return;
    this.tone.set(tone);
    void this.draw();
  }

  protected async draw(): Promise<void> {
    const run = ++this.generation;
    this.rendering.set(true);
    this.renderError.set(false);
    try {
      const blob = await this.renderer.render(cardContent(this.coupon(), this.code()), this.format(), this.tone());
      if (run !== this.generation) return;
      this.revoke();
      this.blob.set(blob);
      this.imageUrl.set(URL.createObjectURL(blob));
    } catch {
      if (run !== this.generation) return;
      this.blob.set(null);
      this.renderError.set(true);
    } finally {
      if (run === this.generation) this.rendering.set(false);
    }
  }

  private revoke(): void {
    const url = this.imageUrl();
    if (url) URL.revokeObjectURL(url);
    this.imageUrl.set(null);
  }

  /**
   * Celular: a folha de apps do sistema, com a imagem e a mensagem. Sem compartilhar
   * arquivo (computador), baixa a imagem. Fechar a folha de apps não é erro.
   */
  protected async shareImage(): Promise<void> {
    const blob = this.blob();
    if (!blob || this.sharing()) return;
    const name = cardFileName(this.code(), this.format());
    const file = new File([blob], name, { type: 'image/png' });
    const nav = this.doc.defaultView?.navigator;
    const data: ShareData = { files: [file], text: this.message() };
    if (nav?.share && nav.canShare?.(data)) {
      this.sharing.set(true);
      try {
        await nav.share(data);
        return;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        this.sharing.set(false);
      }
    }
    this.download(blob, name);
  }

  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = this.doc.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    this.doc.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.notify.success('Imagem baixada.');
  }

  protected copyMessage(): void {
    void copyCouponMessage(this.doc.defaultView, this.notify, this.message());
  }

  protected copyCode(): void {
    const code = this.code();
    if (code) void copyCouponCode(this.doc.defaultView, this.notify, code);
  }
}
