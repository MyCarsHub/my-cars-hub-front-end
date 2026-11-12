import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementMediaType } from '../../types/announcement.types';
import { AnnouncementMedia } from './announcement-media';
import { NoticesPopup } from './notices-popup';
import { NoticesService } from './notices.service';

@Component({
  imports: [AnnouncementMedia],
  template: `<app-announcement-media
    [type]="type()"
    [url]="url()"
    [width]="w()"
    [height]="h()"
    alt="Gastos da locadora no painel"
    [refresh]="refresh()"
  />`,
})
class Host {
  readonly type = signal<AnnouncementMediaType>('IMAGE');
  readonly url = signal<string | null>('https://cdn.test/a.webp?token=1');
  readonly w = signal<number | null>(1600);
  readonly h = signal<number | null>(900);
  readonly refresh = signal<(() => Observable<string | null>) | null>(null);
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe('AnnouncementMedia (popup e área do motorista)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [Host] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  function render(setup?: (h: Host) => void) {
    const f = TestBed.createComponent(Host);
    setup?.(f.componentInstance);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('imagem: <img> com alt do título, espaço reservado na proporção e esqueleto até carregar', () => {
    const { f, el } = render();
    const box = el.querySelector<HTMLElement>('[data-testid="announcement-media"]')!;
    expect(box.style.aspectRatio.replace(/\s/g, '')).toBe('1600/900');
    const img = el.querySelector<HTMLImageElement>('[data-testid="media-image"]')!;
    expect(img.getAttribute('alt')).toBe('Gastos da locadora no painel');
    expect(img.getAttribute('src')).toBe('https://cdn.test/a.webp?token=1');
    expect(el.querySelector('[data-testid="media-loading"]')).not.toBeNull();
    img.dispatchEvent(new Event('load'));
    f.detectChanges();
    expect(el.querySelector('[data-testid="media-loading"]')).toBeNull();
    // Nunca HTML: nada além do elemento de mídia.
    expect(el.querySelector('iframe, object, embed')).toBeNull();
  });

  it('vídeo: muted, loop, playsinline e autoplay; tocar liga e desliga o som', () => {
    stubReducedMotion(false);
    const { f, el } = render((h) => {
      h.type.set('VIDEO');
      h.url.set('https://cdn.test/v.mp4?token=1');
    });
    const video = el.querySelector<HTMLVideoElement>('[data-testid="media-video"]')!;
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('loop')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(true);
    expect(video.getAttribute('poster')).toBeNull();
    video.dispatchEvent(new Event('loadeddata'));
    f.detectChanges();
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="media-video-toggle"]')!;
    expect(toggle.getAttribute('aria-label')).toBe('Ativar som do vídeo');
    expect(el.querySelector('[data-testid="media-sound"]')?.textContent).toContain('Ativar som');
    toggle.click();
    f.detectChanges();
    expect(video.muted).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Desativar som do vídeo');
    toggle.click();
    f.detectChanges();
    expect(video.muted).toBe(true);
  });

  it('menos movimento: sem autoplay, primeiro quadro e botão de reproduzir', () => {
    stubReducedMotion(true);
    const { f, el } = render((h) => {
      h.type.set('VIDEO');
      h.url.set('https://cdn.test/v.mp4?token=1');
      h.w.set(1080);
      h.h.set(1920);
    });
    const video = el.querySelector<HTMLVideoElement>('[data-testid="media-video"]')!;
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.getAttribute('src')).toBe('https://cdn.test/v.mp4?token=1#t=0.1');
    // Em pé: altura limitada, laterais escuras.
    expect(el.querySelector('[data-testid="announcement-media"]')?.className).toContain('h-[300px]');
    video.dispatchEvent(new Event('loadeddata'));
    f.detectChanges();
    expect(el.querySelector('[data-testid="media-play"]')).not.toBeNull();
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="media-video-toggle"]')!;
    expect(toggle.getAttribute('aria-label')).toBe('Reproduzir vídeo da novidade');
    video.play = vi.fn(() => Promise.resolve());
    toggle.click();
    f.detectChanges();
    expect(video.play).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="media-play"]')).toBeNull();
  });

  it('falhou: pede a URL de novo uma vez; falhou de novo, some', () => {
    const refresh = vi.fn(() => of('https://cdn.test/a.webp?token=2'));
    const { f, el } = render((h) => h.refresh.set(refresh));
    el.querySelector('[data-testid="media-image"]')!.dispatchEvent(new Event('error'));
    f.detectChanges();
    expect(refresh).toHaveBeenCalledTimes(1);
    const img = el.querySelector<HTMLImageElement>('[data-testid="media-image"]')!;
    expect(img.getAttribute('src')).toBe('https://cdn.test/a.webp?token=2');
    img.dispatchEvent(new Event('error'));
    f.detectChanges();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="announcement-media"]')).toBeNull();
    expect(el.querySelector('app-announcement-media')?.classList.contains('hidden')).toBe(true);
  });

  it('falhou sem como renovar: some na hora', () => {
    const { f, el } = render();
    el.querySelector('[data-testid="media-image"]')!.dispatchEvent(new Event('error'));
    f.detectChanges();
    expect(el.querySelector('[data-testid="announcement-media"]')).toBeNull();
  });
});

@Component({ imports: [NoticesPopup], template: '<app-notices-popup />' })
class PopupHost {}

describe('NoticesPopup com mídia', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PopupHost], providers: [provideRouter([])] });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('mídia no topo, acima do título; se não carrega, some e o texto fica', () => {
    const notices = TestBed.inject(NoticesService);
    notices
      .enqueue({
        id: 'news:a1',
        type: 'NEWS',
        title: 'Gastos da locadora no painel',
        message: 'Agora você lança despesas.',
        dismissLabel: 'Entendi',
        media: { type: 'IMAGE', url: 'https://cdn.test/a.webp', width: 1600, height: 900 },
      })
      .subscribe();
    const f = TestBed.createComponent(PopupHost);
    f.detectChanges();
    const media = document.querySelector<HTMLElement>('[data-testid="announcement-media"]')!;
    const title = document.querySelector<HTMLElement>('[data-testid="bottom-sheet"] h2')!;
    expect(media).not.toBeNull();
    expect(media.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-testid="media-image"]')?.getAttribute('alt')).toBe('Gastos da locadora no painel');

    document.querySelector('[data-testid="media-image"]')!.dispatchEvent(new Event('error'));
    f.detectChanges();
    expect(document.querySelector('[data-testid="announcement-media"]')).toBeNull();
    expect(document.querySelector('[data-testid="notice-message"]')?.textContent).toContain('Agora você lança despesas.');
    notices.dismiss('news:a1');
    f.destroy();
  });
});
