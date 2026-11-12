import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { NewsUnreadBadgeStore } from '../../services/news-unread-badge.store';
import { AnnouncementFeedItem } from '../../types/announcement-feed.types';
import { routes } from '../../app.routes';
import { isRoleGuard } from '../../services/role.guard';
import { Route } from '@angular/router';
import { NewsFeedPage, feedDate } from './news-feed-page';

function findRoute(list: readonly Route[], path: string): Route | undefined {
  for (const r of list) {
    if (r.path === path) return r;
    const child = findRoute(r.children ?? [], path);
    if (child) return child;
  }
  return undefined;
}

describe('rota /novidades', () => {
  it('é carregada sob demanda e aberta a dono, gerente e motorista', async () => {
    const route = findRoute(routes, 'novidades');
    expect(route?.component).toBeUndefined();
    expect(typeof route?.loadComponent).toBe('function');
    const guards = (route?.canActivate ?? []).filter(isRoleGuard);
    expect(guards.map((g) => [...g.allowedRoles])).toEqual([['OWNER', 'MANAGER', 'DRIVER']]);
    expect(await route!.loadComponent!()).toBe(NewsFeedPage);
  });
});

const FEED = `${environment.apiUrl}/announcements`;

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function token(role: string): string {
  return `${b64url({ alg: 'none' })}.${b64url({ companyId: 'c1', role, exp: 4102444800 })}.sig`;
}

function item(id: string, extra: Partial<AnnouncementFeedItem> = {}): AnnouncementFeedItem {
  return {
    id,
    title: `Título ${id}`,
    body: `Texto ${id}`,
    items: null,
    linkUrl: null,
    linkLabel: null,
    startsOn: null,
    publishedAt: '2026-11-11T10:00:00',
    read: true,
    ...extra,
  };
}

describe('NewsFeedPage (Novidades)', () => {
  let http: HttpTestingController;

  function render() {
    const fixture = TestBed.createComponent(NewsFeedPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const flush = (page: number, content: AnnouncementFeedItem[], hasMore: boolean) => {
      const req = http.expectOne((r) => r.url === FEED && r.params.get('page') === String(page));
      req.flush({ content, page, size: 10, hasMore });
      fixture.detectChanges();
    };
    const fail = (page: number) => {
      http
        .expectOne((r) => r.url === FEED && r.params.get('page') === String(page))
        .flush('x', { status: 500, statusText: 'err' });
      fixture.detectChanges();
    };
    const q = (sel: string) => el.querySelector<HTMLElement>(sel);
    const titles = () => Array.from(el.querySelectorAll('[data-testid="feed-post"] h2')).map((h) => h.textContent?.trim());
    return { fixture, el, flush, fail, q, titles };
  }

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', token('OWNER'));
    TestBed.configureTestingModule({
      imports: [NewsFeedPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('mostra o esqueleto enquanto carrega', () => {
    const { q, flush } = render();
    expect(q('[data-testid="feed-loading"]')?.getAttribute('role')).toBe('status');
    flush(0, [], false);
    expect(q('[data-testid="feed-loading"]')).toBeNull();
  });

  it('desenha na ordem do servidor (mais nova primeiro), com Nova só nas não lidas', () => {
    const { flush, titles, el } = render();
    flush(
      0,
      [
        item('c', { read: false, publishedAt: '2026-11-11T09:00:00' }),
        item('b', { read: false, publishedAt: '2026-11-10T09:00:00' }),
        item('a', { publishedAt: '2026-11-04T09:00:00' }),
      ],
      false,
    );
    expect(titles()).toEqual(['Título c', 'Título b', 'Título a']);
    expect(el.querySelectorAll('[data-testid="post-new"]').length).toBe(2);
    const firstDate = el.querySelector('[data-testid="feed-post"] time');
    expect(firstDate?.getAttribute('datetime')).toBe('2026-11-11');
    expect(firstDate?.textContent?.trim()).toBe('11 nov.');
  });

  it('texto simples: itens viram lista e o HTML não é interpretado', () => {
    const { flush, el } = render();
    flush(0, [item('x', { body: '<b>oi</b>', items: ['um', ' ', 'dois'] })], false);
    const p = el.querySelector('[data-testid="feed-post"] p');
    expect(p?.textContent).toBe('<b>oi</b>');
    expect(el.querySelector('[data-testid="feed-post"] b')).toBeNull();
    expect(Array.from(el.querySelectorAll('li')).map((li) => li.textContent?.trim())).toEqual(['um', 'dois']);
  });

  it('link do app navega pela rota; externo abre em outra aba; outro esquema não vira botão', () => {
    const { flush, el } = render();
    flush(
      0,
      [
        item('i', { linkUrl: '/gastos', linkLabel: 'Ver Gastos' }),
        item('e', { linkUrl: 'https://mycarshub.app.br/blog', linkLabel: 'Ler' }),
        item('j', { linkUrl: 'javascript:alert(1)', linkLabel: 'Não' }),
      ],
      false,
    );
    const links = el.querySelectorAll<HTMLAnchorElement>('[data-testid="post-link"]');
    expect(links.length).toBe(2);
    expect(links[1].target).toBe('_blank');
    expect(links[1].rel).toContain('noopener');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    links[0].click();
    expect(nav).toHaveBeenCalledWith('/gastos');
  });

  it('Carregar mais traz a próxima página no fim da lista e some no fim', () => {
    const { flush, q, titles } = render();
    flush(0, [item('3'), item('2')], true);
    expect(q('[data-testid="feed-end"]')).toBeNull();
    expect(q('[data-testid="feed-more"]')?.textContent?.trim()).toBe('Carregar mais');

    q('[data-testid="feed-more"]')!.click();
    flush(1, [item('2'), item('1', { publishedAt: '2026-09-02T08:00:00' })], false);

    expect(titles()).toEqual(['Título 3', 'Título 2', 'Título 1']);
    expect(q('[data-testid="feed-more"]')).toBeNull();
    expect(q('[data-testid="feed-end"]')?.textContent).toContain('Estas são todas as novidades até agora.');
    expect(q('[data-testid="feed-list"]')?.parentElement?.textContent).toContain(
      'A primeira foi publicada em 2 de setembro de 2026.',
    );
  });

  it('falha no Carregar mais mantém a lista e deixa tentar de novo', () => {
    const { flush, fail, q, titles } = render();
    flush(0, [item('2')], true);
    q('[data-testid="feed-more"]')!.click();
    fail(1);
    expect(titles()).toEqual(['Título 2']);
    expect(q('[data-testid="feed-more-error"]')?.getAttribute('role')).toBe('alert');
    q('[data-testid="feed-more"]')!.click();
    flush(1, [item('1')], false);
    expect(titles()).toEqual(['Título 2', 'Título 1']);
    expect(q('[data-testid="feed-more-error"]')).toBeNull();
  });

  it('vazio: sem botão, com o texto da locadora', () => {
    const { flush, q } = render();
    flush(0, [], false);
    const empty = q('[data-testid="feed-empty"]');
    expect(empty?.textContent).toContain('Nenhuma novidade ainda');
    expect(empty?.textContent).toContain('Quando o MyCarsHub ganhar uma função nova');
    expect(empty?.querySelector('button')).toBeNull();
    expect(q('[data-testid="feed-end"]')).toBeNull();
  });

  it('vazio do motorista fala com o motorista', () => {
    sessionStorage.setItem('token', token('DRIVER'));
    const { flush, q } = render();
    flush(0, [], false);
    expect(q('[data-testid="feed-empty"]')?.textContent).toContain('Quando o app ganhar algo novo para você');
  });

  it('erro: alerta com Tentar de novo, que busca outra vez', () => {
    const { fail, flush, q, titles } = render();
    fail(0);
    const error = q('[data-testid="feed-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Não foi possível carregar as novidades');
    q('[data-testid="feed-retry"]')!.click();
    flush(0, [item('a')], false);
    expect(q('[data-testid="feed-error"]')).toBeNull();
    expect(titles()).toEqual(['Título a']);
  });

  it('a página não marca nada como lido (só GET)', () => {
    const { flush } = render();
    flush(0, [item('a', { read: false })], false);
    http.expectNone((r) => r.method !== 'GET');
  });

  it('o subtítulo conta as novas do menu', () => {
    TestBed.inject(NewsUnreadBadgeStore).set(2);
    const { flush, el } = render();
    flush(0, [item('a', { read: false })], false);
    expect(el.textContent).toContain('2 novas desde a sua última visita.');
  });

  it('data do servidor é lida como está, sem fuso', () => {
    expect(feedDate('2026-01-01T00:30:00')).toEqual({
      iso: '2026-01-01',
      short: '1 jan.',
      year: '2026',
      long: '1 de janeiro de 2026',
    });
    expect(feedDate(null)).toBeNull();
    expect(feedDate('lixo')).toBeNull();
  });
});
