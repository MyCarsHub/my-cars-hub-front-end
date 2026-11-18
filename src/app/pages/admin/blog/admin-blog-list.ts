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
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import {
  DataList,
  DataListActions,
  DataListCell,
  type DataListColumn,
} from '../../../components/lists/data-list/data-list';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import {
  ListFilterSelect,
  ListToolbar,
} from '../../../components/lists/list-toolbar/list-toolbar';
import type { FilterChipOption } from '../../../components/filter-chip-group/filter-chip-group';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { BlogService } from '../../blog/blog.service';
import { BLOG_CATEGORIES, BlogPostListItem } from '../../../types/blog.types';
import {
  BlogCategoryFilter,
  BlogRow,
  BlogStatusFilter,
  blogStatusCounts,
  filterBlogRows,
  toBlogRow,
} from './admin-blog-view';

const COLUMNS: readonly DataListColumn<BlogRow>[] = [
  { key: 'title', header: 'Post', primary: true, value: (r) => r.post.title },
  { key: 'category', header: 'Categoria', kind: 'status', value: (r) => r.category },
  {
    key: 'status',
    header: 'Situação',
    kind: 'status',
    value: (r) => r.status.label,
    tone: (r) => r.status.tone,
  },
  { key: 'date', header: 'Data', value: (r) => r.dateExact },
  { key: 'reading', header: 'Leitura', value: (r) => r.reading },
];

const CATEGORY_OPTIONS: readonly { value: BlogCategoryFilter; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  ...BLOG_CATEGORIES,
];

/**
 * Admin > Blog: posts (rascunho e publicados) com ações rápidas.
 *
 * Padrão da plataforma (auditoria 18/11, D1): `app-page-card "Lista"` + `app-list-toolbar`
 * (busca, "Categoria: X", pílulas de situação) + `app-data-list` (tabela a partir de 1024px,
 * cartões abaixo, sem linhas, kebab por linha). O servidor não filtra posts: busca, categoria
 * e situação recortam a página carregada (com mais de uma página, a tela avisa).
 */
@Component({
  selector: 'app-admin-blog-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    RouterModule,
    DefaultPageLayout,
    PageCard,
    ConfirmDialog,
    AlertBanner,
    StatusChip,
    DataList,
    DataListActions,
    DataListCell,
    DataListMenuItem,
    ListToolbar,
    ListFilterSelect,
  ],
  templateUrl: './admin-blog-list.html',
})
export class AdminBlogList implements OnInit {
  private readonly service = inject(BlogService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  /** Screen-level failure (load or row action). Never a toast. */
  protected readonly error = signal<string | null>(null);
  protected readonly items = signal<BlogPostListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly size = 20;
  protected readonly totalPages = computed(() =>
    this.total() === 0 ? 0 : Math.ceil(this.total() / this.size),
  );

  protected readonly columns = COLUMNS;
  protected readonly categoryOptions = CATEGORY_OPTIONS;
  protected readonly rowId = (row: BlogRow): string => row.post.id;
  /** Each kebab is named after its row, so a screen reader can tell them apart. */
  protected readonly kebabLabel = (row: BlogRow): string => `Ações do post ${row.post.title}`;

  protected readonly search = signal('');
  protected readonly statusFilter = signal<BlogStatusFilter>('ALL');
  protected readonly categoryFilter = signal<BlogCategoryFilter>('ALL');
  /** Troca a cada mudança de situação/categoria/página: a lista é refeita e a cascata recomeça. */
  private readonly epoch = signal(0);
  protected readonly epochs = computed(() => [{ id: this.epoch() }]);

  private readonly filters = computed(() => ({
    term: this.search(),
    status: this.statusFilter(),
    category: this.categoryFilter(),
  }));

  private readonly allRows = computed(() => this.items().map(toBlogRow));
  protected readonly rows = computed(() => filterBlogRows(this.allRows(), this.filters()));
  protected readonly hasAny = computed(() => this.total() > 0 || this.items().length > 0);

  protected readonly statusOptions = computed<readonly FilterChipOption<BlogStatusFilter>[]>(() => {
    const n = blogStatusCounts(this.allRows(), this.filters());
    return [
      { value: 'ALL', label: 'Todos', count: n.ALL },
      { value: 'PUBLISHED', label: 'Publicados', count: n.PUBLISHED },
      { value: 'DRAFT', label: 'Rascunhos', count: n.DRAFT },
    ];
  });

  protected readonly anyFilter = computed(
    () =>
      this.search().trim() !== '' ||
      this.statusFilter() !== 'ALL' ||
      this.categoryFilter() !== 'ALL',
  );

  /** Com mais de uma página, os filtros valem só para a página carregada: a tela diz isso. */
  protected readonly pageNote = computed(() =>
    this.anyFilter() && this.totalPages() > 1
      ? `Os filtros valem para os posts desta página (${this.items().length} de ${this.total()}).`
      : null,
  );

  protected readonly deleteOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly pendingDelete = signal<BlogPostListItem | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected setQuery(q: string): void {
    this.search.set(q);
  }

  protected setStatus(s: BlogStatusFilter): void {
    if (s === this.statusFilter()) return;
    this.statusFilter.set(s);
    this.replay();
  }

  protected onCategoryChange(event: Event): void {
    this.categoryFilter.set((event.target as HTMLSelectElement).value as BlogCategoryFilter);
    this.replay();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.statusFilter.set('ALL');
    this.categoryFilter.set('ALL');
    this.replay();
  }

  protected openEditor(row: BlogRow): void {
    this.router.navigate(['/admin/blog', row.post.id, 'editar']);
  }

  protected goPage(p: number): void {
    if (p < 0 || p >= this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.load();
  }

  protected togglePublish(post: BlogPostListItem): void {
    this.error.set(null);
    const req =
      post.status === 'PUBLISHED' ? this.service.unpublish(post.id) : this.service.publish(post.id);
    req.subscribe({
      next: () => {
        this.notifications.push(
          'success',
          post.status === 'PUBLISHED' ? 'Post despublicado.' : 'Post publicado.',
        );
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(
          this.apiErrors.messageFor(err, 'Não foi possível atualizar o status do post.'),
        );
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
    this.error.set(null);
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
        this.pendingDelete.set(null);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível excluir o post.'));
      },
    });
  }

  private replay(): void {
    this.epoch.update((n) => n + 1);
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.listAdmin(this.page(), this.size).subscribe({
      next: (res) => {
        this.items.set(res.content);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar os posts.'));
      },
    });
  }
}
