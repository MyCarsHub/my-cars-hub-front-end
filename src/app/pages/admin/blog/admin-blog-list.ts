import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { NotificationService } from '../../../services/notification.service';
import { BlogService } from '../../blog/blog.service';
import { BlogPostListItem, blogCategoryLabel } from '../../../types/blog.types';

/**
 * Admin: lista de posts (draft + published) com ações rápidas.
 */
@Component({
  selector: 'app-admin-blog-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterModule, DefaultPageLayout, PageCard, ConfirmDialog],
  templateUrl: './admin-blog-list.html',
  styleUrl: './admin-blog-list.css',
})
export class AdminBlogList implements OnInit {
  private readonly service = inject(BlogService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly items = signal<BlogPostListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = 20;
  protected readonly totalPages = computed(() =>
    this.total() === 0 ? 0 : Math.ceil(this.total() / this.size),
  );

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly pendingDelete = signal<BlogPostListItem | null>(null);

  ngOnInit(): void { this.load(); }

  protected categoryLabel(c: string): string { return blogCategoryLabel(c); }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  protected goPage(p: number): void {
    if (p < 0 || p >= this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.load();
  }

  protected togglePublish(post: BlogPostListItem): void {
    const req = post.status === 'PUBLISHED'
      ? this.service.unpublish(post.id)
      : this.service.publish(post.id);
    req.subscribe({
      next: () => {
        this.notifications.push('success',
          post.status === 'PUBLISHED' ? 'Post despublicado.' : 'Post publicado.');
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.notifications.push('error', this.extractError(err, 'Falha ao atualizar status.'));
      },
    });
  }

  protected askDelete(post: BlogPostListItem): void {
    this.pendingDelete.set(post);
    this.deleteOpen.set(true);
  }
  protected closeDelete(): void {
    if (this.deleting()) return;
    this.deleteOpen.set(false);
    this.pendingDelete.set(null);
  }
  protected confirmDelete(): void {
    const post = this.pendingDelete();
    if (!post) return;
    this.deleting.set(true);
    this.service.delete(post.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.pendingDelete.set(null);
        this.notifications.push('success', 'Post excluído.');
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao excluir.'));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.service.listAdmin(this.page(), this.size).subscribe({
      next: (res) => {
        this.items.set(res.content);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.notifications.push('error', this.extractError(err, 'Falha ao carregar posts.'));
      },
    });
  }

  private extractError(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.message === 'string') return body.message;
    return fallback;
  }
}
