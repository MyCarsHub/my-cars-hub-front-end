import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { LandingNavComponent } from '../landing/components/landing-nav/landing-nav.component';
import { LandingFooterComponent } from '../landing/components/landing-footer/landing-footer.component';
import { BLOG_CATEGORIES, BlogPostCategory, BlogPostListItem, blogCategoryLabel } from '../../types/blog.types';
import { BlogService } from './blog.service';

/**
 * Página pública /blog. Grid de cards estilo abacatepay: capa (ou placeholder
 * com gradient laranja + logo mark), categoria pill, título, excerpt, meta.
 * Mobile-first. Reutiliza nav e footer da landing.
 */
@Component({
  selector: 'app-blog-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterModule, LandingNavComponent, LandingFooterComponent],
  templateUrl: './blog-list.html',
  styleUrl: './blog-list.css',
})
export class BlogList implements OnInit {
  private readonly service = inject(BlogService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly items = signal<BlogPostListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = 12;
  protected readonly selectedCategory = signal<BlogPostCategory | 'ALL'>('ALL');

  protected readonly categories = BLOG_CATEGORIES;
  protected readonly totalPages = computed(() =>
    this.total() === 0 ? 0 : Math.ceil(this.total() / this.size),
  );

  ngOnInit(): void {
    this.load();
  }

  protected categoryLabel(c: BlogPostCategory | string): string {
    return blogCategoryLabel(c);
  }

  protected selectCategory(c: BlogPostCategory | 'ALL'): void {
    if (this.selectedCategory() === c) return;
    this.selectedCategory.set(c);
    this.page.set(0);
    this.load();
  }

  protected goPage(p: number): void {
    if (p < 0 || p >= this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    const cat = this.selectedCategory() === 'ALL' ? undefined : this.selectedCategory();
    this.service.listPublished(cat, this.page(), this.size).subscribe({
      next: (res) => {
        this.items.set(res.content);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractError(err, 'Não foi possível carregar os posts.'));
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
