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
import { editorDatesLine, exactDateTime, toBlogRow } from './admin-blog-view';

/**
 * Padrão da plataforma (auditoria 18/11, D1): `app-page-card "Lista"` + `app-list-toolbar` +
 * `app-data-list`; ações da linha no kebab. "Excluir" é destrutiva: só chama o service depois
 * da confirmação no `app-confirm-dialog`. A `app-data-list` desenha tabela E cartões, então os
 * testes leem a tabela (`[data-row]`).
 */
describe('AdminBlogList', () => {
  const DRAFT: BlogPostListItem = {
    id: 'post-1',
    slug: 'como-alugar',
    title: 'Como alugar um carro',
    excerpt: null,
    coverUrl: null,
    category: 'PRODUTO',
    status: 'DRAFT',
    publishedAt: null,
    createdDate: '2026-01-01T12:00:00',
    readingMinutes: 4,
  };
  // 01:30 do dia 19 em UTC = 22:30 do dia 18 em Brasília.
  const PUBLISHED: BlogPostListItem = {
    ...DRAFT,
    id: 'post-2',
    slug: 'multas-sem-dor',
    title: 'Multas sem dor de cabeça',
    category: 'COBRANCAS',
    status: 'PUBLISHED',
    publishedAt: '2026-11-19T01:30:00',
  };

  let remove: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let listAdmin: ReturnType<typeof vi.fn>;

  type Fixture = ReturnType<typeof TestBed.createComponent<AdminBlogList>>;

  function render(): { fixture: Fixture; host: HTMLElement } {
    const fixture = TestBed.createComponent(AdminBlogList);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  function tableRows(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-row]'));
  }

  function openMenuItems(fixture: Fixture, row = 0): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const container = tableRows(host)[row].querySelector('app-actions-menu') as HTMLElement;
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  function chip(host: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('app-filter-chip-group button')).find(
      (b) => b.textContent?.trim().startsWith(label),
    )!;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    remove = vi.fn().mockReturnValue(of(void 0));
    publish = vi.fn().mockReturnValue(of(void 0));
    listAdmin = vi.fn().mockReturnValue(of({ content: [DRAFT, PUBLISHED], total: 2 }));
    TestBed.configureTestingModule({
      imports: [AdminBlogList],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: BlogService,
          useValue: {
            listAdmin,
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

  it('mora no cartão "Lista" com busca, pílulas de situação e a lista sem linhas', () => {
    const { host } = render();
    expect(host.querySelector('app-page-card h2')?.textContent?.trim()).toBe('Lista');
    expect(host.querySelector('app-page-card [data-testid="new-post"]')).not.toBeNull();
    expect(host.querySelector('[data-list-search]')).not.toBeNull();
    expect(host.querySelector('[data-filter-category]')?.className).toContain('text-base');
    expect(chip(host, 'Todos').textContent).toContain('2');
    // Contagem no campo `count` da pílula (número à parte), não colada no rótulo.
    expect(chip(host, 'Todos').textContent).not.toContain('·');
    expect(tableRows(host)).toHaveLength(2);
    // Entrada em cascata da própria app-data-list (`animateRows`), sem CSS da página.
    expect(host.querySelector('[data-row]')?.classList.contains('enter-up')).toBe(true);
    expect(host.querySelector('.divide-y, [class*="divide-"]')).toBeNull();
    expect(host.querySelector('[data-export]')).not.toBeNull();
  });

  it('situação em chip colorido, categoria em chip neutro, nada em caixa alta', () => {
    const { host } = render();
    const [draft, published] = tableRows(host);
    expect(draft.querySelector('[data-testid="post-status"]')?.textContent?.trim()).toBe('Rascunho');
    expect(published.querySelector('[data-testid="post-status"]')?.className).toContain('bg-emerald-100');
    expect(published.querySelector('[data-testid="post-category"]')?.className).toContain('bg-surface-sunken');
    expect(published.querySelector('[data-testid="post-path"]')?.textContent?.trim()).toBe('/blog/multas-sem-dor');
    expect(host.querySelector('[data-row] .uppercase')).toBeNull();
  });

  it('data no fuso do negócio: 01:30 UTC do dia 19 é 18/11 às 22:30, com o ano', () => {
    const { host } = render();
    const date = tableRows(host)[1].querySelector('[data-testid="post-date"]') as HTMLElement;
    expect(date.textContent?.trim()).toBe('Publicado em 18/11/2026');
    expect(date.getAttribute('title')).toBe('18/11/2026 às 22:30');
    expect(tableRows(host)[0].querySelector('[data-testid="post-date"]')?.textContent?.trim()).toBe(
      'Criado em 01/01/2026',
    );
  });

  it('pílula Rascunhos e busca recortam a lista; "Limpar filtros" volta tudo', () => {
    const { fixture, host } = render();
    chip(host, 'Rascunhos').click();
    fixture.detectChanges();
    expect(tableRows(host).map((r) => r.querySelector('[data-testid="post-title"]')?.textContent?.trim())).toEqual([
      'Como alugar um carro',
    ]);

    const search = host.querySelector('[data-list-search]') as HTMLInputElement;
    search.value = 'multas';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(tableRows(host)).toHaveLength(0);
    expect(host.querySelector('[data-empty-text]')?.textContent).toContain('Nenhum post corresponde');

    (host.querySelector('[data-list-clear]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(tableRows(host)).toHaveLength(2);
  });

  it('expõe Editar, Publicar e Excluir no menu, sem linha entre os itens', () => {
    const { fixture } = render();
    const items = openMenuItems(fixture);
    const labels = items.map((el) => el.textContent?.trim());

    expect(labels).toEqual(['Editar', 'Publicar', 'Excluir']);
    expect(items.some((el) => el.className.includes('border-t'))).toBe(false);

    const editar = items.find((el): el is HTMLAnchorElement => el.tagName === 'A');
    expect(editar?.getAttribute('href')).toBe('/admin/blog/post-1/editar');
  });

  it('post publicado ganha "Ver no blog" e "Despublicar"', () => {
    const { fixture } = render();
    const labels = openMenuItems(fixture, 1).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Editar', 'Ver no blog', 'Despublicar', 'Excluir']);
  });

  it('"Excluir" abre a confirmação com o endereço real e NÃO chama o service antes de confirmar', () => {
    const { fixture } = render();

    const excluir = openMenuItems(fixture).find((el) => el.textContent?.trim() === 'Excluir');
    excluir?.click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deleteOpen: () => boolean;
      confirmDelete: () => void;
    };
    expect(component.deleteOpen()).toBe(true);
    expect(document.body.textContent).toContain('/blog/como-alugar deixará de funcionar');
    expect(remove).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(remove).toHaveBeenCalledWith('post-1');
  });

  it('paginação pelo rodapé da lista pede a próxima página ao servidor', () => {
    listAdmin.mockReturnValue(of({ content: [DRAFT, PUBLISHED], total: 45 }));
    const { fixture, host } = render();
    expect(host.querySelector('[data-pager-text]')?.textContent).toContain('45 posts');
    (host.querySelector('[data-page-next]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(listAdmin).toHaveBeenLastCalledWith(1, 20);
  });

  it('com mais de uma página, o filtro avisa que vale só para a página carregada', () => {
    listAdmin.mockReturnValue(of({ content: [DRAFT, PUBLISHED], total: 45 }));
    const { fixture, host } = render();
    expect(host.querySelector('[data-testid="page-note"]')).toBeNull();
    chip(host, 'Publicados').click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="page-note"]')?.textContent).toContain('(2 de 45)');
  });

  it('vazio: ícone, uma frase e o botão de escrever', () => {
    listAdmin.mockReturnValue(of({ content: [], total: 0 }));
    const { host } = render();
    expect(host.querySelector('[data-testid="empty"] [data-empty-text]')?.textContent).toContain('Nenhum post ainda');
    expect(host.querySelector('[data-testid="empty"] a[href="/admin/blog/novo"]')).not.toBeNull();
  });
});

describe('admin-blog-view — datas', () => {
  it('exactDateTime lê o LocalDateTime da API como UTC', () => {
    expect(exactDateTime('2026-07-30T14:35:00')).toBe('30/07/2026 às 11:35');
    expect(exactDateTime('2026-07-30T14:35:00Z')).toBe('30/07/2026 às 11:35');
    expect(exactDateTime(null)).toBeNull();
  });

  it('toBlogRow: rascunho mostra quando foi criado', () => {
    const row = toBlogRow({
      id: 'x',
      slug: 's',
      title: 'T',
      excerpt: null,
      coverUrl: null,
      category: 'LGPD',
      status: 'DRAFT',
      publishedAt: null,
      createdDate: '2026-11-19T02:00:00',
      readingMinutes: 1,
    });
    expect(row.date).toBe('Criado em 18/11/2026');
    expect(row.category).toBe('LGPD');
    expect(row.reading).toBe('1 min de leitura');
  });

  it('editorDatesLine junta publicação e última edição', () => {
    expect(
      editorDatesLine({
        status: 'PUBLISHED',
        publishedAt: '2026-11-18T17:32:00',
        createdDate: '2026-11-10T10:00:00',
        modifyDate: '2026-11-19T12:10:00',
      }),
    ).toBe('Publicado em 18/11/2026 às 14:32 · editado em 19/11/2026 às 09:10');
    expect(
      editorDatesLine({ status: 'DRAFT', publishedAt: null, createdDate: '2026-11-10T13:00:00', modifyDate: null }),
    ).toBe('Criado em 10/11/2026 às 10:00');
    expect(editorDatesLine({ status: 'DRAFT', publishedAt: null, createdDate: null, modifyDate: null })).toBeNull();
  });
});
