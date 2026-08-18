import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import { BlogService } from '../../blog/blog.service';
import {
  BLOG_CATEGORIES,
  BlogPostCategory,
  BlogPostDetail,
  BlogPostRequest,
} from '../../../types/blog.types';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Editor de post. Cria (/admin/blog/novo) OU edita (/admin/blog/:id/editar).
 * Markdown puro no textarea. Preview HTML abaixo (renderiza via backend após
 * salvar — no editor mostra plain text truncado como aproximação leve).
 */
@Component({
  selector: 'app-admin-blog-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    BackLink,
    ReactiveFormsModule,
    RouterModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './admin-blog-form.html',
  styleUrl: './admin-blog-form.css',
})
export class AdminBlogForm implements OnInit {
  private readonly service = inject(BlogService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly fb = inject(FormBuilder);
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
  protected readonly bodyHtmlPreview = signal<SafeHtml>('');

  /** Falha ao CARREGAR o post — o formulário não pode ser usado. */
  protected readonly loadError = signal<string | null>(null);
  /** Falha de uma OPERAÇÃO (salvar/publicar) que sobrou depois do inline. */
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(200)]],
    slug: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(200),
        Validators.pattern(SLUG_PATTERN),
      ],
    ],
    category: ['PRODUTO' as BlogPostCategory, [Validators.required]],
    excerpt: ['', [Validators.maxLength(400)]],
    coverUrl: ['', [Validators.maxLength(500)]],
    bodyMarkdown: ['', [Validators.required, Validators.minLength(50)]],
    metaDescription: ['', [Validators.maxLength(300)]],
  });

  /** Copy por chave de validador para o resolver do `app-form-field`. */
  protected readonly titleMessages: Readonly<Record<string, string>> = {
    required: 'Informe o título do post.',
    minlength: 'O título precisa de pelo menos 5 caracteres.',
  };
  protected readonly slugMessages: Readonly<Record<string, string>> = {
    required: 'Informe o slug da URL.',
    minlength: 'O slug precisa de pelo menos 3 caracteres.',
    pattern: 'Use apenas letras minúsculas, números e hífens (ex.: meu-post).',
  };
  protected readonly bodyMessages: Readonly<Record<string, string>> = {
    required: 'Escreva o conteúdo do post.',
    minlength: 'O conteúdo precisa de pelo menos 50 caracteres.',
  };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editing.set(true);
      this.id.set(id);
      this.load(id);
    }
  }

  /**
   * Deriva o slug do título enquanto o autor digita, mas só na criação e
   * enquanto o slug ainda estiver vazio — nunca sobrescreve edição manual.
   */
  protected onTitleInput(event: Event): void {
    if (this.editing()) return;
    const value = (event.target as HTMLInputElement).value;
    if (this.form.controls.slug.value.trim() !== '') return;
    this.form.controls.slug.setValue(this.slugify(value));
  }

  protected save(publish = false): void {
    if (this.saving() || this.publishing()) return;

    this.error.set(null);
    clearServerErrors(this.form);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }

    const raw = this.form.getRawValue();
    const req: BlogPostRequest = {
      slug: raw.slug.trim(),
      title: raw.title.trim(),
      excerpt: raw.excerpt.trim() || undefined,
      coverUrl: raw.coverUrl.trim() || undefined,
      category: raw.category,
      bodyMarkdown: raw.bodyMarkdown,
      metaDescription: raw.metaDescription.trim() || undefined,
    };
    const busy = publish ? this.publishing : this.saving;
    busy.set(true);
    // `id()` só é lido dentro do ramo em que `editing()` garante que ele existe.
    const currentId = this.id();
    const op =
      this.editing() && currentId ? this.service.update(currentId, req) : this.service.create(req);
    op.subscribe({
      next: (post) => {
        // Se pediu publicar, dispara o publish depois de salvar.
        if (publish && post.status !== 'PUBLISHED') {
          this.service.publish(post.id).subscribe({
            next: () => {
              busy.set(false);
              this.notifications.success('Post publicado.');
              this.router.navigate(['/admin/blog']);
            },
            error: (err: HttpErrorResponse) => {
              busy.set(false);
              this.error.set(this.apiErrors.messageFor(err, 'Não foi possível publicar o post.'));
            },
          });
        } else {
          busy.set(false);
          this.hydrate(post);
          this.notifications.success(this.editing() ? 'Post atualizado.' : 'Rascunho salvo.');
          if (!this.editing()) {
            // Redireciona para o modo edit após criar
            this.router.navigate(['/admin/blog', post.id, 'editar']);
          }
        }
      },
      error: (err: HttpErrorResponse) => {
        busy.set(false);
        this.handleSaveError(err);
      },
    });
  }

  /**
   * `fieldErrors` do backend (ex.: `slug` já em uso) caem no controle de mesmo
   * nome e aparecem embaixo do campo; só o que sobra vai para o banner.
   * Nunca vira toast — `handleForm` reivindica o erro.
   */
  private handleSaveError(err: HttpErrorResponse): void {
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar o post.',
    );
    this.error.set(formMessage);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.service.findByIdAdmin(id).subscribe({
      next: (post) => {
        this.hydrate(post);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.apiErrors.messageFor(err, 'Post não encontrado.'));
      },
    });
  }

  private hydrate(p: BlogPostDetail): void {
    this.id.set(p.id);
    this.status.set(p.status);
    this.form.patchValue({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt ?? '',
      coverUrl: p.coverUrl ?? '',
      category: p.category,
      bodyMarkdown: p.bodyMarkdown,
      metaDescription: p.metaDescription ?? '',
    });
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
}
