import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { HttpErrorResponse } from '@angular/common/http';
import { PageTitleStrategy } from '../../services/page-title.strategy';
import { BlogPostDetail } from '../../types/blog.types';
import { BlogDetail } from './blog-detail';
import { BlogService } from './blog.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';

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
    ).toBe(`https://www.mycarshub.app.br/blog/${POST.slug}`);
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
    ).toBe(`https://www.mycarshub.app.br/blog/${POST.slug}`);
  });
});

/**
 * FIX-0325 — a MENSAGEM de erro desta tela nunca teve teste.
 *
 * O arquivo acima cobre head tags e o gate de desindexacao, que e o efeito
 * COLATERAL do erro; o texto que o leitor le, que e o assunto, estava
 * descoberto. E era a pior ocorrencia do defeito do FIX-0050: o `extractError`
 * local lia o TypeError do navegador e escrevia "Failed to fetch" numa pagina
 * publica, para um leitor anonimo.
 */
describe('BlogDetail — mensagem de erro (FIX-0325)', () => {
  let notifyError: ReturnType<typeof vi.fn>;

  function configureFailing(error: unknown): void {
    notifyError = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'blog/:slug', component: BlogDetail, data: { pageTitle: 'Blog' } },
        ]),
        { provide: TitleStrategy, useClass: PageTitleStrategy },
        { provide: BlogService, useValue: { findBySlug: () => throwError(() => error) } },
        ApiErrorService,
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  }

  async function textAfterVisit(slug = 'um-post'): Promise<string> {
    const harness = await RouterTestingHarness.create(`/blog/${slug}`);
    harness.detectChanges();
    return ((harness.fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falha de rede mostra o fallback em portugues, nao "Failed to fetch"', async () => {
    configureFailing(new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }));

    const text = await textAfterVisit();

    expect(text).toContain('Não foi possível carregar o post.');
    expect(text).not.toContain('Failed to fetch');
  });

  /** A frase do 404 e desta tela e nao pode virar a generica do extrator. */
  it('preserva "Post nao encontrado." no 404', async () => {
    configureFailing(new HttpErrorResponse({ status: 404, error: {} }));

    const text = await textAfterVisit('nao-existe');

    expect(text).toContain('Post não encontrado.');
    expect(text).not.toContain('Registro não encontrado');
  });

  /**
   * O 404 nao passa pelo `messageFor` — a frase e fixa — entao ele precisa
   * reivindicar o erro POR CONTA PROPRIA. E o erro mais provavel num blog: sem
   * isso, a rede de seguranca de 4xx toastaria por cima da mensagem da pagina.
   */
  it('reivindica o 404 — nada de toast por cima da pagina', async () => {
    vi.useFakeTimers();
    const failure = new HttpErrorResponse({ status: 404, error: {} });
    configureFailing(failure);

    await textAfterVisit('nao-existe');
    TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
    vi.runAllTimers();

    expect(notifyError).not.toHaveBeenCalled();
  });

  /**
   * O gate de desindexacao usa `isMissing()` — 404 OU 410 — mas a MENSAGEM
   * ramificava so no 404. Um `410 Gone` mostrava a frase generica numa pagina
   * que estava sendo marcada `noindex` no mesmo instante: a pagina dizia uma
   * coisa ao leitor e outra ao rastreador.
   */
  it('410 Gone mostra a frase de post inexistente, nao a generica', async () => {
    configureFailing(new HttpErrorResponse({ status: 410, error: {} }));

    const text = await textAfterVisit('post-removido');

    expect(text).toContain('Post não encontrado.');
    expect(text).not.toContain('Não foi possível carregar o post.');
  });

  /**
   * A ARMADILHA DESTE NO. Hoje o 410 cai no ramo do `else`, passa pelo
   * `messageFor` e por isso e reivindicado de graca. Mover o 410 para o ramo da
   * frase fixa — que NAO passa pelo `messageFor` — reintroduziria o toast
   * duplicado enquanto conserta a redacao. O `claim` explicito daquele ramo e o
   * que impede isso, e este teste e o que prova que ele esta la.
   */
  it('410 continua sem toast depois de mudar de ramo', async () => {
    vi.useFakeTimers();
    const failure = new HttpErrorResponse({ status: 410, error: {} });
    configureFailing(failure);

    await textAfterVisit('post-removido');
    TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
    vi.runAllTimers();

    expect(notifyError).not.toHaveBeenCalled();
  });

  /** O 500 NAO e ausencia de conteudo e continua com a frase generica. */
  it('500 continua na frase generica — falha de transporte nao e post inexistente', async () => {
    configureFailing(new HttpErrorResponse({ status: 500, error: {} }));

    const text = await textAfterVisit();

    expect(text).toContain('Não foi possível carregar o post.');
    expect(text).not.toContain('Post não encontrado.');
  });

  it('mostra a mensagem do backend quando ela vem', async () => {
    configureFailing(
      new HttpErrorResponse({ status: 500, error: { message: 'Blog em manutenção.' } }),
    );

    expect(await textAfterVisit()).toContain('Blog em manutenção.');
  });

  it('mostra fieldErrors, que o extrator local ignorava', async () => {
    configureFailing(
      new HttpErrorResponse({ status: 400, error: { fieldErrors: { slug: 'Slug inválido.' } } }),
    );

    expect(await textAfterVisit()).toContain('Slug inválido.');
  });

  /** Controle: um erro que NINGUEM reivindicou continua toastando. */
  it('controle: erro nao reivindicado ainda dispara a rede de seguranca', async () => {
    vi.useFakeTimers();
    configureFailing(new HttpErrorResponse({ status: 500, error: {} }));
    await textAfterVisit();

    const orphan = new HttpErrorResponse({ status: 400, error: { message: 'Sem dono.' } });
    TestBed.inject(ApiErrorService).scheduleSafetyNet(orphan);
    vi.runAllTimers();

    expect(notifyError).toHaveBeenCalledWith('Sem dono.');
  });
});
