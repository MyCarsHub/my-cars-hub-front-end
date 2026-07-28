import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminBlogList } from './admin-blog-list';
import { BlogService } from '../../blog/blog.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { BlogPostListItem } from '../../../types/blog.types';

/**
 * Padrão de listagem: a coluna de ações é o menu de três pontos
 * (`app-actions-menu`). "Excluir" é destrutiva: só chama o service depois da
 * confirmação no `app-confirm-dialog`.
 */
describe('AdminBlogList — menu de ações', () => {
  const DRAFT: BlogPostListItem = {
    id: 'post-1',
    slug: 'como-alugar',
    title: 'Como alugar um carro',
    excerpt: null,
    coverUrl: null,
    category: 'PRODUTO',
    status: 'DRAFT',
    publishedAt: null,
    createdDate: '2026-01-01T00:00:00Z',
    readingMinutes: 4,
  };

  let remove: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;

  function openMenuItems(fixture: {
    nativeElement: unknown;
    detectChanges: () => void;
  }): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const container = host.querySelector('app-actions-menu') as HTMLElement;
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    remove = vi.fn().mockReturnValue(of(void 0));
    publish = vi.fn().mockReturnValue(of(void 0));
    TestBed.configureTestingModule({
      imports: [AdminBlogList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: BlogService,
          useValue: {
            listAdmin: vi.fn().mockReturnValue(of({ content: [DRAFT], total: 1 })),
            publish,
            unpublish: vi.fn().mockReturnValue(of(void 0)),
            delete: remove,
          },
        },
        {
          provide: NotificationService,
          useValue: { push: vi.fn(), success: vi.fn(), error: vi.fn() },
        },
      ],
    });
  });

  it('expõe Editar, Publicar e Excluir no menu', () => {
    const fixture = TestBed.createComponent(AdminBlogList);
    fixture.detectChanges();

    const items = openMenuItems(fixture);
    const labels = items.map((el) => el.textContent?.trim());

    expect(labels).toContain('Editar');
    expect(labels).toContain('Publicar');
    expect(labels[labels.length - 1]).toBe('Excluir');

    const editar = items.find((el): el is HTMLAnchorElement => el.tagName === 'A');
    expect(editar?.getAttribute('href')).toBe('/admin/blog/post-1/editar');
  });

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(AdminBlogList);
    fixture.detectChanges();

    const excluir = openMenuItems(fixture).find((el) => el.textContent?.trim() === 'Excluir');
    excluir?.click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deleteOpen: () => boolean;
      confirmDelete: () => void;
    };
    expect(component.deleteOpen()).toBe(true);
    expect(remove).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(remove).toHaveBeenCalledWith('post-1');
  });
});
