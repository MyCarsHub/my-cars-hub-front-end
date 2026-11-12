import { Component, Type } from '@angular/core';
import { DeferBlockState, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { CompanyContactService } from '../../services/company-contact.service';
import { IMPERSONATION_STATE_KEY } from '../../services/impersonation.context';
import { SessionService } from '../../services/session.service';
import { EMPTY_COMPANY_CONTACT } from '../../types/company-contact.types';
import { UnreadAnnouncement } from '../../types/announcement.types';
import { NewsNoticesService } from './news-notices.service';
import { NoticesPopup } from './notices-popup';
import { NoticesService } from './notices.service';

const UNREAD = `${environment.apiUrl}/announcements/unread`;
const readUrl = (id: string) => `${environment.apiUrl}/announcements/${id}/read`;

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function accessToken(): string {
  return `${b64url({ alg: 'none' })}.${b64url({ companyId: 'c1', role: 'OWNER', exp: 4102444800 })}.sig`;
}

function news(id: string, extra: Partial<UnreadAnnouncement> = {}): UnreadAnnouncement {
  return {
    id,
    title: `Título ${id}`,
    body: `Texto ${id}`,
    items: ['um', ''],
    linkUrl: null,
    linkLabel: null,
    startsOn: '2026-11-01',
    ...extra,
  };
}

@Component({ imports: [NoticesPopup], template: '<app-notices-popup />' })
class Host {}

/**
 * Cada `it` é uma "carga do app": TestBed novo = serviço novo. O `sessionStorage` é o da aba e
 * sobrevive entre cargas, como num reload; `newSession()` limpa, como um novo login.
 */

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

describe('NewsNoticesService (F1: novidade no popup de avisos)', () => {
  let http: HttpTestingController;
  let service: NewsNoticesService;
  let notices: NoticesService;

  function boot(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: CompanyContactService,
          useValue: { load: () => of({ name: 'L', contact: EMPTY_COMPANY_CONTACT }), save: vi.fn() },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NewsNoticesService);
    notices = TestBed.inject(NoticesService);
  }

  function newSession(): void {
    sessionStorage.clear();
    sessionStorage.setItem('token', accessToken());
    sessionStorage.setItem('id', 'u1');
  }

  function render() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return f;
  }
  const q = (f: { nativeElement: HTMLElement }, sel: string) => f.nativeElement.querySelector<HTMLElement>(sel);

  /** Fecha pelo caminho pedido e espera a animação do BottomSheet. */
  function settle(f: { detectChanges(): void }): void {
    vi.advanceTimersByTime(400);
    TestBed.tick();
    f.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    newSession();
    boot();
    await warmNewsCard(Host);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
    // isolate:false — nada desta suíte vaza para a vizinha.
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('mídia vai para o aviso e, se a URL assinada vencer, pede a lista de novo UMA vez', () => {
    render();
    service.maybeShow();
    http
      .expectOne(UNREAD)
      .flush([news('a', { mediaType: 'VIDEO', mediaUrl: 'https://cdn.test/v.mp4?t=1', mediaWidth: 1080, mediaHeight: 1920 })]);
    TestBed.tick();
    const media = notices.current()?.media;
    expect(media).toEqual(expect.objectContaining({ type: 'VIDEO', url: 'https://cdn.test/v.mp4?t=1', width: 1080, height: 1920 }));
    let fresh: string | null = null;
    media!.refresh!().subscribe((u) => (fresh = u));
    http.expectOne(UNREAD).flush([news('a', { mediaType: 'VIDEO', mediaUrl: 'https://cdn.test/v.mp4?t=2' })]);
    expect(fresh).toBe('https://cdn.test/v.mp4?t=2');
    // Nunca guardada no storage.
    expect(JSON.stringify(sessionStorage)).not.toContain('cdn.test');
    expect(JSON.stringify(localStorage)).not.toContain('cdn.test');
    notices.dismiss('news:a');
    http.expectOne(readUrl('a')).flush(null);
  });

  it('o cartão não baixou (@error): a novidade sai da fila SEM marcar como lida e o lembrete bloqueante segue', async () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()?.id).toBe('news:a');
    let reminder: string | null = null;
    notices
      .enqueue({ id: 'contact', type: 'REMINDER', title: 'Contato', message: 'Falta o contato.', blocking: true })
      .subscribe((o) => (reminder = o));

    const [block] = await f.getDeferBlocks();
    await block.render(DeferBlockState.Error);
    TestBed.tick();
    f.detectChanges();

    expect(notices.current()?.id).toBe('contact');
    expect(q(f, '[data-testid="notice-type"]')?.textContent).toContain('Lembrete');
    http.expectNone(readUrl('a'));
    notices.resolve('contact');
    expect(reminder).toBe('resolved');
  });

  it('enfileira a MAIS ANTIGA como NEWS, com "Entendi", texto simples e itens vazios fora', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a'), news('b')]);
    TestBed.tick();
    f.detectChanges();
    const current = notices.current();
    expect(current?.id).toBe('news:a');
    expect(current?.type).toBe('NEWS');
    expect(current?.items).toEqual(['um']);
    expect(q(f, '[data-testid="notice-dismiss"]')?.textContent?.trim()).toBe('Entendi');
    expect(q(f, '[data-testid="notice-type"]')?.textContent).toContain('Novidade');
  });

  it('renderiza como texto: HTML no título/corpo não vira elemento', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('x', { title: '<b>oi</b>', body: '<img src=x onerror=alert(1)>' })]);
    TestBed.tick();
    f.detectChanges();
    const body = q(f, '[data-testid="notice-body"]')!;
    expect(body.querySelector('img')).toBeNull();
    expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(f.nativeElement.querySelector('h2 b')).toBeNull();
  });

  it('"Entendi" marca como lida UMA vez; reload na mesma sessão não a mostra de novo', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();
    f.detectChanges();
    q(f, '[data-testid="notice-dismiss"]')!.click();
    settle(f);
    const read = http.expectOne(readUrl('a'));
    expect(read.request.method).toBe('POST');
    read.flush(null, { status: 204, statusText: 'No Content' });
    expect(notices.current()).toBeNull();
    service.maybeShow();
    http.expectNone(UNREAD);

    // Reload: mesma aba, app novo. Busca de novo; o servidor já não devolve a lida.
    boot();
    render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([]);
    TestBed.tick();
    expect(notices.current()).toBeNull();
  });

  it('marcada como lida, a próxima sessão não a vê (o servidor já não devolve)', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();
    f.detectChanges();
    q(f, '[data-testid="notice-dismiss"]')!.click();
    settle(f);
    http.expectOne(readUrl('a')).flush(null, { status: 204, statusText: 'No Content' });

    newSession();
    boot();
    render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([]);
    TestBed.tick();
    expect(notices.current()).toBeNull();
  });

  /** Fecha a novidade na tela com "Entendi" e responde o POST de lida. */
  function closeCurrent(f: { nativeElement: HTMLElement; detectChanges(): void }, id: string): void {
    expect(notices.current()?.id).toBe(`news:${id}`);
    q(f, '[data-testid="notice-dismiss"]')!.click();
    settle(f);
    const read = http.expectOne(readUrl(id));
    expect(read.request.method).toBe('POST');
    read.flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();
    f.detectChanges();
  }

  it('3 não lidas: todas na MESMA sessão, uma depois da outra, a mais antiga primeiro, cada uma marcada', () => {
    const f = render();
    service.maybeShow();
    service.maybeShow(); // o shell chama a cada navegação
    http.expectOne(UNREAD).flush([news('a'), news('b'), news('c')]);
    TestBed.tick();
    f.detectChanges();

    const shown: string[] = [];
    for (const id of ['a', 'b', 'c']) {
      shown.push(notices.current()!.id);
      // Uma de cada vez: a próxima só entra quando esta sai.
      expect(notices.waiting()).toBe(0);
      closeCurrent(f, id);
    }
    expect(shown).toEqual(['news:a', 'news:b', 'news:c']);
    expect(notices.current()).toBeNull();
    service.maybeShow();
    http.expectNone(UNREAD);
  });

  it('reload no meio da sequência: retoma as que faltam e não repete a já lida', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a'), news('b'), news('c')]);
    TestBed.tick();
    f.detectChanges();
    closeCurrent(f, 'a');
    expect(notices.current()?.id).toBe('news:b');

    // Reload com "b" na tela: nunca foi fechada, continua não lida.
    boot();
    const g = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('b'), news('c')]);
    TestBed.tick();
    g.detectChanges();
    closeCurrent(g, 'b');
    closeCurrent(g, 'c');
    expect(notices.current()).toBeNull();
    http.expectNone(readUrl('a'));
  });

  it('logout no meio da sequência: a da tela e as que esperavam saem SEM marcar como lidas', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a'), news('b'), news('c')]);
    TestBed.tick();
    f.detectChanges();
    closeCurrent(f, 'a');
    expect(notices.current()?.id).toBe('news:b');

    TestBed.inject(SessionService).clear();
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()).toBeNull();
    expect(notices.queue()).toEqual([]);
    http.expectNone(readUrl('b'));
    http.expectNone(readUrl('c'));

    // B entra na mesma carga: recebe só as suas, nada de A.
    sessionStorage.setItem('token', accessToken());
    sessionStorage.setItem('id', 'u2');
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('z')]);
    TestBed.tick();
    f.detectChanges();
    closeCurrent(f, 'z');
    expect(notices.current()).toBeNull();
  });

  it('suporte ("Ver como") aberto no meio da sequência: as próximas não aparecem nem são marcadas', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a'), news('b')]);
    TestBed.tick();
    f.detectChanges();
    sessionStorage.setItem(IMPERSONATION_STATE_KEY, '{"companyId":"c1"}');
    q(f, '[data-testid="notice-dismiss"]')!.click();
    settle(f);
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()).toBeNull();
    http.expectNone(readUrl('a'));
    http.expectNone(readUrl('b'));
  });

  it('falha da busca não bloqueia: nada na tela, nenhum erro, sem marca de sessão', () => {
    render();
    expect(() => {
      service.maybeShow();
      http.expectOne(UNREAD).flush('boom', { status: 500, statusText: 'Server Error' });
      TestBed.tick();
    }).not.toThrow();
    expect(notices.current()).toBeNull();
    expect(Object.keys(sessionStorage).filter((k) => k.includes('news'))).toEqual([]);
  });

  it.each([
    ['X', (f: { nativeElement: HTMLElement }) => q(f, '[data-testid="bottom-sheet-close"]')!.click()],
    ['Esc', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['link', (f: { nativeElement: HTMLElement }) => q(f, '[data-testid="notice-link"]')!.click()],
  ])('%s também marca como lida, uma vez só', (_label, act) => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a', { linkUrl: '/gastos', linkLabel: 'Ver Gastos' })]);
    TestBed.tick();
    f.detectChanges();
    act(f);
    settle(f);
    http.expectOne(readUrl('a')).flush(null, { status: 204, statusText: 'No Content' });
    http.expectNone(readUrl('a'));
    expect(notices.current()).toBeNull();
    if (_label === 'link') expect(nav).toHaveBeenCalledWith('/gastos');
  });

  it('link https abre em outra aba, sem o router', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      const f = render();
      service.maybeShow();
      http.expectOne(UNREAD).flush([news('a', { linkUrl: 'https://www.gov.br/denatran', linkLabel: 'Ler' })]);
      TestBed.tick();
      f.detectChanges();
      q(f, '[data-testid="notice-link"]')!.click();
      settle(f);
      http.expectOne(readUrl('a')).flush(null, { status: 204, statusText: 'No Content' });
      expect(open).toHaveBeenCalledWith('https://www.gov.br/denatran', '_blank', 'noopener,noreferrer');
      expect(nav).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it('sessão de suporte ("Ver como") não busca e não marca como lida', () => {
    sessionStorage.setItem(IMPERSONATION_STATE_KEY, '{"companyId":"c1"}');
    render();
    service.maybeShow();
    http.expectNone(UNREAD);
    expect(notices.current()).toBeNull();
  });

  it('sessão de suporte aberta com a novidade na tela: fechar não marca como lida', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();
    f.detectChanges();
    sessionStorage.setItem(IMPERSONATION_STATE_KEY, '{"companyId":"c1"}');
    q(f, '[data-testid="notice-dismiss"]')!.click();
    settle(f);
    http.expectNone(readUrl('a'));
  });

  it('lembrete bloqueante na tela tem prioridade: a novidade espera a fila esvaziar', () => {
    const f = render();
    notices.enqueue({ id: 'gate', type: 'REMINDER', title: 'Contato', message: 'Falta', blocking: true });
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()?.id).toBe('gate');
    expect(notices.waiting()).toBe(0);
    notices.dismiss('gate');
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()?.id).toBe('news:a');
  });

  it('quebra de linha do texto chega ao popup (pre-line, sem HTML)', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a', { body: 'Linha 1\nLinha 2' })]);
    TestBed.tick();
    f.detectChanges();
    const msg = q(f, '[data-testid="notice-message"]')!;
    expect(msg.textContent).toBe('Linha 1\nLinha 2');
    expect(msg.classList.contains('whitespace-pre-line')).toBe(true);
    expect(msg.querySelector('br')).toBeNull();
  });

  it('logout com a novidade de A esperando: B nunca vê nem marca a de A, e recebe a sua', () => {
    const f = render();
    notices.enqueue({ id: 'gate', type: 'REMINDER', title: 'Contato', message: 'Falta', blocking: true });
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();

    // Logout de A (SessionService.clear roda o SessionResetRegistry) e login de B na mesma carga.
    TestBed.inject(SessionService).clear();
    sessionStorage.setItem('token', accessToken());
    sessionStorage.setItem('id', 'u2');
    notices.dismiss('gate');
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()).toBeNull();

    service.maybeShow();
    http.expectOne(UNREAD).flush([news('b')]);
    TestBed.tick();
    expect(notices.current()?.id).toBe('news:b');
  });

  it('logout com a novidade de A NA TELA: sai da fila sem marcar como lida', () => {
    const f = render();
    service.maybeShow();
    http.expectOne(UNREAD).flush([news('a')]);
    TestBed.tick();
    f.detectChanges();
    expect(notices.current()?.id).toBe('news:a');
    TestBed.inject(SessionService).clear();
    TestBed.tick();
    expect(notices.current()).toBeNull();
    http.expectNone(readUrl('a'));
  });

  it('sem token de empresa (antes de escolher empresa) não busca', () => {
    sessionStorage.removeItem('token');
    service.maybeShow();
    http.expectNone(UNREAD);
  });
});
