import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { NotificationService } from '../../../services/notification.service';
import { BlogService } from '../../blog/blog.service';
import {
  BLOG_CATEGORIES,
  BlogPostCategory,
  BlogPostDetail,
  BlogPostRequest,
} from '../../../types/blog.types';

/**
 * Editor de post. Cria (/admin/blog/novo) OU edita (/admin/blog/:id/editar).
 * Markdown puro no textarea. Preview HTML abaixo (renderiza via backend após
 * salvar — no editor mostra plain text truncado como aproximação leve).
 */
@Component({
  selector: 'app-admin-blog-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [FormsModule, RouterModule, DefaultPageLayout, PageCard],
  templateUrl: './admin-blog-form.html',
  styleUrl: './admin-blog-form.css',
})
export class AdminBlogForm implements OnInit {
  private readonly service = inject(BlogService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly categories = BLOG_CATEGORIES;
  protected readonly editing = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly publishing = signal(false);

  protected readonly id = signal<string | null>(null);
  protected readonly status = signal<'DRAFT' | 'PUBLISHED'>('DRAFT');
  protected readonly slug = signal('');
  protected readonly title = signal('');
  protected readonly excerpt = signal('');
  protected readonly coverUrl = signal('');
  protected readonly category = signal<BlogPostCategory>('PRODUTO');
  protected readonly bodyMarkdown = signal('');
  protected readonly metaDescription = signal('');
  protected readonly bodyHtmlPreview = signal<SafeHtml>('');

  protected readonly canSubmit = computed(() =>
    this.slug().trim().length >= 3 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(this.slug().trim()) &&
    this.title().trim().length >= 5 &&
    this.bodyMarkdown().trim().length >= 50 &&
    !this.saving() && !this.publishing()
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editing.set(true);
      this.id.set(id);
      this.load(id);
    }
  }

  protected onTitleInput(v: string): void {
    this.title.set(v);
    if (!this.editing() && this.slug().trim() === '') {
      this.slug.set(this.slugify(v));
    }
  }

  protected save(publish = false): void {
    if (!this.canSubmit()) return;
    const req: BlogPostRequest = {
      slug: this.slug().trim(),
      title: this.title().trim(),
      excerpt: this.excerpt().trim() || undefined,
      coverUrl: this.coverUrl().trim() || undefined,
      category: this.category(),
      bodyMarkdown: this.bodyMarkdown(),
      metaDescription: this.metaDescription().trim() || undefined,
    };
    const busy = publish ? this.publishing : this.saving;
    busy.set(true);
    const op = this.editing() && this.id()
      ? this.service.update(this.id()!, req)
      : this.service.create(req);
    op.subscribe({
      next: (post) => {
        // Se pediu publicar, dispara o publish depois de salvar.
        if (publish && post.status !== 'PUBLISHED') {
          this.service.publish(post.id).subscribe({
            next: () => {
              busy.set(false);
              this.notifications.push('success', 'Post publicado.');
              this.router.navigate(['/admin/blog']);
            },
            error: (err: HttpErrorResponse) => {
              busy.set(false);
              this.notifications.push('error', this.extractError(err, 'Falha ao publicar.'));
            },
          });
        } else {
          busy.set(false);
          this.hydrate(post);
          this.notifications.push('success', this.editing() ? 'Post atualizado.' : 'Rascunho salvo.');
          if (!this.editing()) {
            // Redireciona para o modo edit após criar
            this.router.navigate(['/admin/blog', post.id, 'editar']);
          }
        }
      },
      error: (err: HttpErrorResponse) => {
        busy.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao salvar.'));
      },
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.service.findByIdAdmin(id).subscribe({
      next: (post) => {
        this.hydrate(post);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.notifications.push('error', this.extractError(err, 'Post não encontrado.'));
        this.router.navigate(['/admin/blog']);
      },
    });
  }

  private hydrate(p: BlogPostDetail): void {
    this.id.set(p.id);
    this.status.set(p.status);
    this.slug.set(p.slug);
    this.title.set(p.title);
    this.excerpt.set(p.excerpt ?? '');
    this.coverUrl.set(p.coverUrl ?? '');
    this.category.set(p.category);
    this.bodyMarkdown.set(p.bodyMarkdown);
    this.metaDescription.set(p.metaDescription ?? '');
    this.bodyHtmlPreview.set(this.sanitizer.bypassSecurityTrustHtml(p.bodyHtml));
  }

  private slugify(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 200);
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') return body.message;
    return fallback;
  }
}
