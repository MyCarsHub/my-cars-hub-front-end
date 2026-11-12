import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { NoticesService } from '../components/notices/notices.service';
import { SILENT_HTTP_ERRORS } from './http-errors.context';
import { IMPERSONATION_STATE_KEY } from './impersonation.context';
import { NEWS_FEED_PAGE_SIZE, NewsFeedService } from './news-feed.service';
import { NewsUnreadBadgeStore } from './news-unread-badge.store';
import { SessionService } from './session.service';

const FEED = `${environment.apiUrl}/announcements`;
const UNREAD = `${environment.apiUrl}/announcements/unread`;

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function token(role: string, companyId: string | null = 'c1'): string {
  const payload: Record<string, unknown> = { role, exp: 4102444800 };
  if (companyId) payload['companyId'] = companyId;
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

describe('NewsFeedService', () => {
  let http: HttpTestingController;
  let service: NewsFeedService;
  let badge: NewsUnreadBadgeStore;

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', token('OWNER'));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NewsFeedService);
    badge = TestBed.inject(NewsUnreadBadgeStore);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('pede a página com page e size, em silêncio, e devolve na ordem do servidor', () => {
    let titles: string[] = [];
    service.page(2).subscribe((res) => (titles = res.content.map((c) => c.title)));
    const req = http.expectOne((r) => r.url === FEED);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe(String(NEWS_FEED_PAGE_SIZE));
    expect(req.request.context.get(SILENT_HTTP_ERRORS)).toBe(true);
    req.flush({
      content: [
        { id: 'b', title: 'Mais nova', body: '', items: null, linkUrl: null, linkLabel: null, startsOn: null, publishedAt: '2026-11-11T10:00:00', read: false },
        { id: 'a', title: 'Mais antiga', body: '', items: null, linkUrl: null, linkLabel: null, startsOn: null, publishedAt: '2026-11-01T10:00:00', read: true },
      ],
      page: 2,
      size: 10,
      hasMore: false,
    });
    expect(titles).toEqual(['Mais nova', 'Mais antiga']);
  });

  it('resposta torta vira página vazia sem próxima', () => {
    let result: unknown;
    service.page(0).subscribe((res) => (result = res));
    http.expectOne((r) => r.url === FEED).flush(null);
    expect(result).toEqual({ content: [], page: 0, size: NEWS_FEED_PAGE_SIZE, hasMore: false });
  });

  it('conta as não lidas para o chip do menu, uma vez por pessoa e papel', () => {
    service.loadUnreadCount();
    http.expectOne(UNREAD).flush([{ id: '1' }, { id: '2' }]);
    expect(badge.unread()).toBe(2);
    expect(badge.label()).toBe('2 novas');

    service.loadUnreadCount();
    http.expectNone(UNREAD);
  });

  it('falha no contador não mostra chip e tenta de novo depois', () => {
    service.loadUnreadCount();
    http.expectOne(UNREAD).flush('x', { status: 500, statusText: 'err' });
    expect(badge.label()).toBe('');
    service.loadUnreadCount();
    http.expectOne(UNREAD).flush([{ id: '1' }]);
    expect(badge.label()).toBe('1 nova');
  });

  it('sessão de suporte nem busca o contador', () => {
    sessionStorage.setItem(IMPERSONATION_STATE_KEY, '{}');
    service.loadUnreadCount();
    http.expectNone(UNREAD);
    expect(badge.unread()).toBe(0);
  });

  it('token sem empresa nem busca o contador', () => {
    sessionStorage.setItem('token', token('OWNER', null));
    service.loadUnreadCount();
    http.expectNone(UNREAD);
  });

  it('a novidade que sai do popup desconta uma do chip', () => {
    service.loadUnreadCount();
    http.expectOne(UNREAD).flush([{ id: '1' }, { id: '2' }]);
    const notices = TestBed.inject(NoticesService);
    notices.enqueue({ id: 'news:1', type: 'NEWS', title: 't', message: 'm' }).subscribe();
    TestBed.tick();
    notices.dismiss('news:1');
    TestBed.tick();
    expect(badge.unread()).toBe(1);
  });

  it('logout zera o chip', () => {
    service.loadUnreadCount();
    http.expectOne(UNREAD).flush([{ id: '1' }]);
    TestBed.inject(SessionService).clear();
    expect(badge.unread()).toBe(0);
  });
});
