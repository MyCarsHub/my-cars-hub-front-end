import { Component, Type, signal } from '@angular/core';
import { DeferBlockState, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOTTOM_SHEET_REDUCED_FADE_MS } from '../core/bottom-sheet/bottom-sheet';
import { NewsNoticeCard } from './news-notice-card';
import { NoticesPopup } from './notices-popup';
import { Notice, NoticeMedia, NoticeOutcome, NoticesService } from './notices.service';

@Component({
  imports: [NewsNoticeCard],
  template: `<app-news-notice-card
    title="Gastos da locadora no painel"
    message="Agora você lança despesas."
    [items]="items()"
    [linkLabel]="link()"
    [media]="media()"
    [audience]="audience()"
    (dismissRequested)="dismissed = dismissed + 1"
    (linkRequested)="linked = linked + 1"
  />`,
})
class CardHost {
  readonly items = signal<string[] | null>(['Gasto com ou sem veículo', '  ', 'Comprovante em PDF ou foto']);
  readonly link = signal<string | null>('Ver Gastos');
  readonly media = signal<NoticeMedia | null>(null);
  readonly audience = signal<'LOCADORA' | 'MOTORISTA'>('LOCADORA');
  dismissed = 0;
  linked = 0;
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}


/**
 * O cartão v2 do popup vem por `@defer`. Carrega o bloco UMA vez (renderiza e desmonta) para
 * que os blocos seguintes renderizem na hora, como num app que já baixou o pedaço.
 */
async function warmNewsCard(host: Type<unknown>): Promise<void> {
  const notices = TestBed.inject(NoticesService);
  notices.enqueue({ id: 'news:warm-up', type: 'NEWS', title: 'w', message: 'w' }).subscribe();
  const f = TestBed.createComponent(host);
  f.detectChanges();
  for (const block of await f.getDeferBlocks()) await block.render(DeferBlockState.Complete);
  notices.dismiss('news:warm-up');
  f.destroy();
}

describe('NewsNoticeCard (novidade v2)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [CardHost] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  function render(setup?: (h: CardHost) => void) {
    const f = TestBed.createComponent(CardHost);
    setup?.(f.componentInstance);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { f, el, q: (sel: string) => el.querySelector<HTMLElement>(sel) };
  }

  it('sem mídia: topo laranja sólido da marca com o desenho, título grande e selo com estrela', () => {
    const { q } = render();
    expect(q('[data-testid="news-hero"]')?.getAttribute('data-hero')).toBe('brand');
    const brand = q('[data-testid="news-brand"]')!;
    expect(brand.className).toContain('bg-[#F63B04]');
    expect(brand.className).not.toContain('gradient');
    expect(brand.querySelector('svg')).not.toBeNull();
    expect(brand.textContent).toContain('Novo no MyCarsHub');
    expect(q('[data-testid="news-title"]')?.className).toContain('font-extrabold');
    expect(q('[data-testid="notice-type"]')?.textContent?.trim()).toBe('Novidade');
    expect(q('[data-testid="notice-type"] svg')).not.toBeNull();
    expect(q('[data-testid="news-count"]')).toBeNull();
    expect(q('[data-testid="bottom-sheet-close"]')).not.toBeNull();
  });

  it('motorista: a frase do topo é para quem dirige', () => {
    const { q } = render((h) => h.audience.set('MOTORISTA'));
    expect(q('[data-testid="news-brand"]')?.textContent).toContain('Para você');
  });

  it('"O que mudou" é uma lista com check laranja, sem itens vazios e sem linhas', () => {
    const { el, q } = render();
    const items = Array.from(el.querySelectorAll('[data-testid="notice-items"] li')).map((li) => li.textContent?.trim());
    expect(items).toEqual(['Gasto com ou sem veículo', 'Comprovante em PDF ou foto']);
    expect(el.querySelectorAll('[data-testid="news-check"] svg')).toHaveLength(2);
    expect(q('[data-testid="news-card"]')?.innerHTML).not.toMatch(/divide-|border-[tb]\b|<hr/);
  });

  it('com link: botão principal laranja com seta e "Entendi" quieto', () => {
    const { f, q } = render();
    const cta = q('[data-testid="notice-link"]')!;
    expect(cta.className).toContain('bg-[#F63B04]');
    expect(cta.className).toContain('text-white');
    expect(cta.querySelector('svg')).not.toBeNull();
    const ok = q('[data-testid="notice-dismiss"]')!;
    expect(ok.textContent?.trim()).toBe('Entendi');
    expect(ok.getAttribute('data-tone')).toBe('quiet');
    expect(ok.className).not.toContain('bg-[#F63B04]');
    cta.click();
    ok.click();
    f.detectChanges();
    expect(f.componentInstance.linked).toBe(1);
    expect(f.componentInstance.dismissed).toBe(1);
  });

  it('sem link: "Entendi" vira o botão laranja sólido', () => {
    const { q } = render((h) => h.link.set(null));
    expect(q('[data-testid="notice-link"]')).toBeNull();
    const ok = q('[data-testid="notice-dismiss"]')!;
    expect(ok.getAttribute('data-tone')).toBe('primary');
    expect(ok.className).toContain('bg-[#F63B04]');
  });

  it('com mídia: ela ocupa o topo de ponta a ponta; se falhar, o topo volta ao laranja', () => {
    const { f, q } = render((h) => h.media.set({ type: 'IMAGE', url: 'https://cdn.test/a.webp', width: 1600, height: 900 }));
    expect(q('[data-testid="news-hero"]')?.getAttribute('data-hero')).toBe('media');
    expect(q('[data-testid="announcement-media"]')?.className).not.toContain('rounded-2xl');
    q('[data-testid="media-image"]')!.dispatchEvent(new Event('error'));
    f.detectChanges();
    expect(q('[data-testid="news-hero"]')?.getAttribute('data-hero')).toBe('brand');
    expect(q('[data-testid="notice-message"]')?.textContent).toContain('Agora você lança despesas.');
  });

  it('menos movimento: vídeo do topo não toca sozinho', () => {
    stubReducedMotion(true);
    const { q } = render((h) => h.media.set({ type: 'VIDEO', url: 'https://cdn.test/v.mp4', width: 1080, height: 1920 }));
    expect(q('[data-testid="media-video"]')?.hasAttribute('autoplay')).toBe(false);
  });
});

@Component({ imports: [NoticesPopup], template: '<app-notices-popup />' })
class PopupHost {}

describe('NoticesPopup — várias novidades na fila', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PopupHost], providers: [provideRouter([])] });
    await warmNewsCard(PopupHost);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  const news = (id: string): Notice => ({
    id: `news:${id}`,
    type: 'NEWS',
    title: `Novidade ${id}`,
    message: `Texto ${id}`,
    dismissLabel: 'Entendi',
  });
  const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

  it('"1 de 3" com barras, "Próxima" fecha só a atual (cada uma com o próprio desfecho) e a última volta a "Entendi"', () => {
    const notices = TestBed.inject(NoticesService);
    const outcomes: Record<string, NoticeOutcome> = {};
    for (const id of ['a', 'b', 'c']) notices.enqueue(news(id)).subscribe((o) => (outcomes[id] = o));
    const f = TestBed.createComponent(PopupHost);
    f.detectChanges();

    const step = () => {
      $('[data-testid="notice-dismiss"]')!.click();
      vi.advanceTimersByTime(400);
      f.detectChanges();
    };

    expect($('[data-testid="news-count"]')?.textContent?.trim()).toBe('1 de 3');
    expect($('[data-testid="news-progress"]')?.children).toHaveLength(3);
    expect($('[data-testid="notice-dismiss"]')?.textContent?.trim()).toBe('Próxima');

    step();
    expect(outcomes).toEqual({ a: 'dismissed' });
    expect($('[data-testid="news-title"]')?.textContent?.trim()).toBe('Novidade b');
    expect($('[data-testid="news-count"]')?.textContent?.trim()).toBe('2 de 3');

    step();
    expect($('[data-testid="news-count"]')?.textContent?.trim()).toBe('3 de 3');
    expect($('[data-testid="notice-dismiss"]')?.textContent?.trim()).toBe('Entendi');

    step();
    expect(outcomes).toEqual({ a: 'dismissed', b: 'dismissed', c: 'dismissed' });
    expect($('[data-testid="bottom-sheet"]')).toBeNull();
    f.destroy();
  });

  it('uma só: sem contador nem barras; folha 480 px de 28 px de canto', () => {
    const notices = TestBed.inject(NoticesService);
    notices.enqueue(news('a')).subscribe();
    const f = TestBed.createComponent(PopupHost);
    f.detectChanges();
    expect($('[data-testid="news-count"]')).toBeNull();
    expect($('[data-testid="news-progress"]')).toBeNull();
    const panel = $('[data-testid="bottom-sheet"] section')!;
    expect(panel.className).toContain('lg:max-w-[480px]');
    expect(panel.className).toContain('rounded-t-[28px]');
    expect(panel.getAttribute('aria-labelledby')).toBe('news-notice-title');
    expect($('#news-notice-title')?.textContent?.trim()).toBe('Novidade a');
    notices.dismiss('news:a');
    f.destroy();
  });

  it('menos movimento: sai com um fade curto, sem a mola', () => {
    stubReducedMotion(true);
    const notices = TestBed.inject(NoticesService);
    let outcome: NoticeOutcome | null = null;
    notices.enqueue(news('a')).subscribe((o) => (outcome = o));
    const f = TestBed.createComponent(PopupHost);
    f.detectChanges();
    $('[data-testid="notice-dismiss"]')!.click();
    f.detectChanges();
    expect($('[data-testid="bottom-sheet"]')?.className).toContain('leaving');
    expect($('[data-testid="bottom-sheet"]')?.className).toContain('is-bare');
    vi.advanceTimersByTime(BOTTOM_SHEET_REDUCED_FADE_MS - 1);
    expect(outcome).toBeNull();
    vi.advanceTimersByTime(1);
    f.detectChanges();
    expect(outcome).toBe('dismissed');
    f.destroy();
  });
});
