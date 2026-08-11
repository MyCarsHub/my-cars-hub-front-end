import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';
import { describe, it, expect } from 'vitest';

import { HttpErrorResponse } from '@angular/common/http';
import { PageTitleStrategy } from '../../services/page-title.strategy';
import { BlogPostDetail } from '../../types/blog.types';
import { BlogDetail } from './blog-detail';
import { BlogService } from './blog.service';

/** The generic title every `/blog/:slug` navigation resolves to from `data.pageTitle`. */
const ROUTE_TITLE = 'Blog — MyCarsHub';

const POST: BlogPostDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'como-precificar-a-diaria-da-frota',
  title: 'Como precificar a diária da frota sem perder margem',
  excerpt: 'Um método simples para achar o piso da diária.',
  coverUrl: null,
  category: 'OPERACAO',
  status: 'PUBLISHED',
  publishedAt: '2026-07-02T12:00:00Z',
  createdDate: '2026-07-01T09:00:00Z',
  modifyDate: null,
  authorId: null,
  readingMinutes: 7,
  metaDescription: 'Como achar o piso da diária a partir do custo real do veículo.',
  bodyMarkdown: '# Piso',
  bodyHtml: '<p>Some o custo fixo e divida pelos dias úteis.</p>',
};

describe('BlogDetail — head tags', () => {
  function configure(response: Observable<BlogPostDetail>): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'blog/:slug',
            component: BlogDetail,
            data: {
              pageTitle: 'Blog',
              seo: { description: 'Artigo do blog MyCarsHub sobre gestão de locadoras.' },
            },
          },
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy },
        { provide: BlogService, useValue: { findBySlug: () => response } },
      ],
    });
  }

  async function visit(slug: string): Promise<void> {
    await RouterTestingHarness.create(`/blog/${slug}`);
  }

  function title(): string {
    return TestBed.inject(Title).getTitle();
  }

  function meta(selector: string): string | null {
    return TestBed.inject(DOCUMENT).head.querySelector(selector)?.getAttribute('content') ?? null;
  }

  /**
   * THE defect this file exists for. `data.pageTitle` is the literal `Blog` for every
   * post, and prerendering freezes whatever the title is when the page serializes — so if
   * the route label silently wins, every static post file ships the SAME headline and the
   * posts are indistinguishable in search results. The assertion is deliberately written
   * as "not the route title" as well as "is the post title": a regression that reverts to
   * the generic one must fail here, not just a regression that changes the wording.
   */
  it('titles the page with the post headline, not the generic route title', async () => {
    configure(of(POST));

    await visit(POST.slug);

    expect(title()).not.toBe(ROUTE_TITLE);
    expect(title()).toBe('Como precificar a diária da frota sem perder margem — MyCarsHub');
  });

  it('mirrors the post headline into og:title and twitter:title', async () => {
    configure(of(POST));

    await visit(POST.slug);

    const expected = 'Como precificar a diária da frota sem perder margem — MyCarsHub';
    expect(meta('meta[property="og:title"]')).toBe(expected);
    expect(meta('meta[name="twitter:title"]')).toBe(expected);
  });

  it('overrides the shared route description with the post one', async () => {
    configure(of(POST));

    await visit(POST.slug);

    expect(meta('meta[name="description"]')).toBe(POST.metaDescription);
  });

  /** A post with a blank headline must keep the route title, never an empty `<title>`. */
  it('keeps the route title when the post has no headline', async () => {
    configure(of({ ...POST, title: '   ' }));

    await visit(POST.slug);

    expect(title()).toBe(ROUTE_TITLE);
  });

  /** A failed fetch must not leave a headline behind either. */
  it('keeps the route title when the post cannot be loaded', async () => {
    configure(throwError(() => new HttpErrorResponse({ status: 404 })));

    await visit('nao-existe');

    expect(title()).toBe(ROUTE_TITLE);
  });

  /**
   * A slug with no post renders "Post não encontrado." under HTTP 200 — a soft 404. The
   * route is public, so `applyRouteSeo` has already published `index, follow` and a
   * canonical, i.e. the page is ASKING to be indexed. The build-time generator prunes
   * this case out of the static output, but at runtime — the normal path for every slug
   * published since the last deploy — nothing else does, so the component must fail
   * closed itself, the same way an unknown route does.
   */
  it('marks a post that cannot be loaded as noindex and withdraws the canonical', async () => {
    configure(throwError(() => new HttpErrorResponse({ status: 404 })));

    await visit('nao-existe');

    expect(meta('meta[name="robots"]')).toBe('noindex, nofollow');
    expect(TestBed.inject(DOCUMENT).head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  /** A `410 Gone` is the same fact as a 404, stated more strongly. */
  it('marks a post the API reports as gone (410) noindex too', async () => {
    configure(throwError(() => new HttpErrorResponse({ status: 410 })));

    await visit('post-removido');

    expect(meta('meta[name="robots"]')).toBe('noindex, nofollow');
  });

  /**
   * THE DEINDEXING DEFECT. A 5xx is not "this post does not exist", it is the backend
   * blinking — and `transferCache: false` (`prerender-api-base.interceptor.ts`) makes
   * EVERY prerendered post refetch on hydration, so an unconditional `markNotFound()`
   * here would write `noindex, nofollow` over a correctly prerendered, already-indexed
   * post and strip its canonical. Render free-tier cold starts answer 502 routinely and
   * Googlebot executes JS, so one backend blip during a crawl would erase real content
   * from the index — strictly worse than the soft-404 this branch exists to prevent.
   * Every other `markNotFound` test above uses 404; this one must not.
   */
  it('leaves the page indexable when the fetch fails with a 500, instead of deindexing a real post', async () => {
    configure(throwError(() => new HttpErrorResponse({ status: 500 })));

    await visit(POST.slug);

    expect(meta('meta[name="robots"]')).toBe('index, follow');
    expect(
      TestBed.inject(DOCUMENT).head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe(`https://mycarshub.app.br/blog/${POST.slug}`);
  });

  /** The same for a 502 and for the status-0 abort a client timeout surfaces as. */
  it('leaves the page indexable on a 502 and on a status-0 transport abort', async () => {
    configure(throwError(() => new HttpErrorResponse({ status: 502 })));
    await visit(POST.slug);
    expect(meta('meta[name="robots"]')).toBe('index, follow');

    TestBed.resetTestingModule();
    configure(throwError(() => new HttpErrorResponse({ status: 0 })));
    await visit(POST.slug);
    expect(meta('meta[name="robots"]')).toBe('index, follow');
  });

  /** …and the fail-closed branch must not bleed into the posts that DO load. */
  it('leaves a post that loaded indexable, with its canonical intact', async () => {
    configure(of(POST));

    await visit(POST.slug);

    expect(meta('meta[name="robots"]')).toBe('index, follow');
    expect(
      TestBed.inject(DOCUMENT).head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe(`https://mycarshub.app.br/blog/${POST.slug}`);
  });
});
