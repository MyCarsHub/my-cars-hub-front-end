import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AdminBlogForm } from './admin-blog-form';
import { BlogService } from '../../blog/blog.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';

/**
 * Padrão de feedback (fase 3): um `fieldErrors.slug` vindo do backend (slug já em
 * uso) precisa aparecer INLINE embaixo do campo de slug, NÃO pode ser repetido no
 * banner do formulário e NUNCA pode virar toast.
 */
describe('AdminBlogForm — erros de campo vindos do backend', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let notifySuccess: ReturnType<typeof vi.fn>;
  let notifyPush: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<AdminBlogForm>>;

  function slugError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#blog-slug-error');
  }

  function fillValidForm(): void {
    const form = (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form;
    form.patchValue({
      title: 'Como cobrar sem virar chato',
      slug: 'como-cobrar-sem-virar-chato',
      category: 'COBRANCAS',
      excerpt: 'Resumo curto.',
      coverUrl: '',
      bodyMarkdown:
        'Conteúdo do post com folga suficiente para passar do mínimo de cinquenta caracteres.',
      metaDescription: '',
    });
  }

  function save(): void {
    (fixture.componentInstance as unknown as { save: (publish?: boolean) => void }).save(false);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    create = vi.fn();
    notifyError = vi.fn();
    notifySuccess = vi.fn();
    notifyPush = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminBlogForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        {
          provide: BlogService,
          useValue: {
            create,
            update: vi.fn(),
            publish: vi.fn(),
            findByIdAdmin: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            push: notifyPush,
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: notifySuccess,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminBlogForm);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o slug duplicado embaixo do campo, sem banner e sem toast', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Slug já utilizado por outro post.',
        fieldErrors: { slug: 'Slug já utilizado por outro post.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    save();

    // (a) renderizado inline embaixo do campo slug
    const inline = slugError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('Slug já utilizado por outro post.');
    expect(inline?.getAttribute('role')).toBe('alert');

    const input = fixture.nativeElement.querySelector('#blog-slug') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('blog-slug-error');

    // (b) não repetido no banner do formulário
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    // (c) nenhum toast — nem direto, nem pela rede de segurança do interceptor
    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(notifyPush).not.toHaveBeenCalled();
  });

  it('mostra erro de negócio sem campo no banner do formulário', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Limite de posts do plano atingido.' },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    save();

    expect(fixture.nativeElement.innerHTML).toContain('Limite de posts do plano atingido.');
    expect(slugError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('não bloqueia o submit: formulário inválido revela as mensagens por campo', () => {
    save();

    expect(create).not.toHaveBeenCalled();
    expect(slugError()?.textContent?.trim()).toBe('Informe o slug da URL.');
    expect(fixture.nativeElement.querySelector('#blog-body-error')?.textContent?.trim()).toBe(
      'Escreva o conteúdo do post.',
    );
    expect(notifyError).not.toHaveBeenCalled();
  });
});
