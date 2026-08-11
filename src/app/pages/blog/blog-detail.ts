import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LandingNavComponent } from '../landing/components/landing-nav/landing-nav.component';
import { LandingFooterComponent } from '../landing/components/landing-footer/landing-footer.component';
import { BlogPostDetail, blogCategoryLabel } from '../../types/blog.types';
import { SeoService } from '../../services/seo.service';
import { BREADCRUMB_JSONLD_ID, breadcrumbListJsonLd } from '../../services/structured-data';
import { blogPostingJsonLd } from './blog-structured-data';
import { BlogService } from './blog.service';

/** Id of the `BlogPosting` block, so a slug-to-slug navigation replaces it, never stacks. */
const POST_JSONLD_ID = 'blog-posting';

/**
 * The only statuses that mean "este post não existe", and therefore the only ones allowed
 * to deindex the page. `410 Gone` joins `404` because it is the same fact, stated more
 * strongly. Everything else — 0 (rede/abort), 5xx, 429 — é falha de transporte, e falha de
 * transporte nunca é prova de ausência de conteúdo.
 */
function isMissing(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * Página pública /blog/:slug. Renderiza o body_html (já sanitizado pelo backend
 * via commonmark com escapeHtml). Typography editorial dentro de .prose.
 */
@Component({
  selector: 'app-blog-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterModule, LandingNavComponent, LandingFooterComponent],
  templateUrl: './blog-detail.html',
  styleUrl: './blog-detail.css',
})
export class BlogDetail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(BlogService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly seo = inject(SeoService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly post = signal<BlogPostDetail | null>(null);
  protected readonly safeBody = signal<SafeHtml>('');

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error.set('Post inválido.');
      this.loading.set(false);
      return;
    }
    this.load(slug);
  }

  ngOnDestroy(): void {
    // Sair do post no SPA não pode deixar o schema dele grudado na próxima página.
    this.seo.removeJsonLd(POST_JSONLD_ID);
    this.seo.removeJsonLd(BREADCRUMB_JSONLD_ID);
  }

  protected categoryLabel(c: string): string {
    return blogCategoryLabel(c);
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  private load(slug: string): void {
    this.loading.set(true);
    this.service.findBySlug(slug).subscribe({
      next: (p) => {
        this.post.set(p);
        this.safeBody.set(this.sanitizer.bypassSecurityTrustHtml(p.bodyHtml));
        // `data.pageTitle` da rota é o literal "Blog" para TODO post, e o prerender
        // congela isso no HTML estático — sem isto, todo post sai como
        // `<title>Blog — MyCarsHub</title>` e fica indistinguível na busca. O sufixo da
        // marca é aplicado dentro do serviço; aqui vai só a manchete.
        this.seo.setTitle(p.title);
        // `data.seo.description` da rota é a MESMA frase para todo post; sem isto o blog
        // inteiro sai com meta descriptions duplicadas — justo no conteúdo que existe
        // para rankear. O post traz a sua; o excerpt é o plano B.
        this.seo.setDescription(p.metaDescription ?? p.excerpt ?? '');
        // Só depois que o post chegou: headline, datas e capa saem do payload real, e a
        // trilha usa o título de verdade — o mesmo <h1> que a página renderiza.
        this.seo.setJsonLd(POST_JSONLD_ID, blogPostingJsonLd(p));
        this.seo.setJsonLd(
          BREADCRUMB_JSONLD_ID,
          breadcrumbListJsonLd([
            { name: 'Início', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: p.title, path: `/blog/${p.slug}` },
          ]),
        );
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(
          err.status === 404
            ? 'Post não encontrado.'
            : this.extractError(err, 'Não foi possível carregar o post.'),
        );
        // SÓ quando o post realmente não existe. Aí sim esta página é um soft 404: HTTP
        // 200 com "Post não encontrado" no corpo, e como a rota é pública `applyRouteSeo`
        // já publicou `index, follow` mais uma canônica — ou seja, a página está PEDINDO
        // para ser indexada. O prerender nunca chega aqui (o gerador poda a página de
        // erro), mas em runtime este é o caminho normal de todo slug publicado depois do
        // último deploy.
        //
        // O GATE É O PONTO. Um 500/502/timeout NÃO é "post inexistente", é o backend
        // fora do ar por um instante — e como `transferCache: false`
        // (`prerender-api-base.interceptor.ts`) faz todo post prerenderizado refazer a
        // chamada na hidratação, desindexar aqui gravaria `noindex, nofollow` em cima de
        // um post correto, já prerenderizado e já indexado, além de tirar a canônica.
        // Cold start de free tier devolve 502 com frequência e o Googlebot executa JS:
        // uma piscada do backend durante um rastreio apagaria conteúdo real do índice.
        // Qualquer outro status mantém `index, follow` e a canônica intactas.
        if (isMissing(err.status)) {
          this.seo.markNotFound();
        }
        this.loading.set(false);
      },
    });
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') return body.message;
    return fallback;
  }
}
