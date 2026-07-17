import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LandingNavComponent } from '../landing/components/landing-nav/landing-nav.component';
import { LandingFooterComponent } from '../landing/components/landing-footer/landing-footer.component';
import { BlogPostDetail, blogCategoryLabel } from '../../types/blog.types';
import { BlogService } from './blog.service';

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
export class BlogDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(BlogService);
  private readonly sanitizer = inject(DomSanitizer);

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
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(
          err.status === 404
            ? 'Post não encontrado.'
            : this.extractError(err, 'Não foi possível carregar o post.'),
        );
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
