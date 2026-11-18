import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminFeedback } from './admin-feedback';
import { FeedbackService } from '../../../services/feedback.service';
import { NotificationService } from '../../../services/notification.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { FeedbackTaskResponse } from '../../../types/feedback.types';

/**
 * Padrão de listagem: a coluna de ações é o menu de três pontos
 * (`app-actions-menu`), com as MESMAS ações em mobile (cards) e desktop
 * (tabela). "Excluir" é destrutiva: só chama o service depois da confirmação.
 */
describe('AdminFeedback — menu de ações', () => {
  const TASK: FeedbackTaskResponse = {
    id: 'fb-1',
    title: 'Exportar relatório em CSV',
    description: null,
    status: 'BACKLOG',
    fuelCount: 4,
    hasVoted: false,
    authorId: null,
    authorName: 'Fulano',
    createdDate: '2026-01-01T00:00:00Z',
    modifyDate: null,
    adminNote: null,
  };

  let adminDelete: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;

  function openMenuItems(
    fixture: { nativeElement: unknown; detectChanges: () => void },
    scope: 'mobile' | 'desktop',
  ): HTMLElement[] {
    const host = fixture.nativeElement as HTMLElement;
    const containers = Array.from(host.querySelectorAll('app-actions-menu'));
    const container = scope === 'mobile' ? containers[0] : containers[containers.length - 1];
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
    fixture.detectChanges();
    return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    adminDelete = vi.fn().mockReturnValue(of(void 0));
    updateStatus = vi.fn().mockReturnValue(of(TASK));
    TestBed.configureTestingModule({
      imports: [AdminFeedback],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: FeedbackService,
          useValue: {
            tasks: signal<FeedbackTaskResponse[]>([TASK]),
            loading: signal(false),
            loadTasks: vi.fn().mockReturnValue(of({ content: [TASK], total: 1 })),
            updateStatus,
            adminDelete,
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
  });

  it.each(['mobile', 'desktop'] as const)(
    'oferece as transições de status (menos a atual) e Excluir (%s)',
    (scope) => {
      const fixture = TestBed.createComponent(AdminFeedback);
      fixture.detectChanges();

      const labels = openMenuItems(fixture, scope).map((el) => el.textContent?.trim());

      expect(labels).toContain('Mover para Planejado');
      expect(labels).toContain('Mover para Concluído');
      expect(labels).toContain('Rejeitar…');
      // o status atual (Backlog) não é oferecido
      expect(labels).not.toContain('Mover para Backlog');
      // a destrutiva fica por último
      expect(labels[labels.length - 1]).toBe('Excluir');
    },
  );

  it('"Excluir" abre a confirmação e NÃO chama o service antes de confirmar', () => {
    const fixture = TestBed.createComponent(AdminFeedback);
    fixture.detectChanges();

    const remove = openMenuItems(fixture, 'mobile').find(
      (el) => el.textContent?.trim() === 'Excluir',
    );
    remove?.click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      deletingTask: () => FeedbackTaskResponse | null;
      confirmDelete: () => void;
    };
    expect(component.deletingTask()?.id).toBe('fb-1');
    expect(adminDelete).not.toHaveBeenCalled();

    component.confirmDelete();
    expect(adminDelete).toHaveBeenCalledWith('fb-1');
  });

  it('"Rejeitar…" abre o diálogo de motivo em vez de aplicar o status direto', () => {
    const fixture = TestBed.createComponent(AdminFeedback);
    fixture.detectChanges();

    const reject = openMenuItems(fixture, 'mobile').find(
      (el) => el.textContent?.trim() === 'Rejeitar…',
    );
    reject?.click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      rejectingTask: () => FeedbackTaskResponse | null;
    };
    expect(component.rejectingTask()?.id).toBe('fb-1');
    expect(updateStatus).not.toHaveBeenCalled();
    // A folha compartilhada (não mais um diálogo feito à mão) pede o motivo.
    const sheet = fixture.nativeElement.querySelector('app-bottom-sheet') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('Rejeitar sugestão');
    expect(sheet.textContent).toContain('Exportar relatório em CSV');
  });
});

describe('AdminFeedback — padrão da lista', () => {
  const base: FeedbackTaskResponse = {
    id: 'fb-1',
    title: 'Exportar relatório em CSV',
    description: 'Planilha com os aluguéis do mês',
    status: 'BACKLOG',
    fuelCount: 4,
    hasVoted: false,
    authorId: null,
    authorName: 'Fulano',
    // 01:30 UTC do dia 19 = 22:30 do dia 18 em Brasília.
    createdDate: '2026-11-19T01:30:00',
    modifyDate: null,
    adminNote: null,
  };
  const TASKS: FeedbackTaskResponse[] = [
    base,
    { ...base, id: 'fb-2', title: 'Ação em lote', status: 'PLANNED', authorName: 'Beltrana' },
    { ...base, id: 'fb-3', title: 'Modo escuro', status: 'REJECTED', adminNote: 'Já existe' },
  ];

  function create(total = TASKS.length) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminFeedback],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: FeedbackService,
          useValue: {
            tasks: signal<FeedbackTaskResponse[]>(TASKS),
            loading: signal(false),
            loadTasks: vi.fn().mockReturnValue(of({ content: TASKS, total })),
            updateStatus: vi.fn(),
            adminDelete: vi.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminFeedback);
    fixture.detectChanges();
    return fixture;
  }

  const rowTitles = (host: HTMLElement): string[] =>
    Array.from(host.querySelectorAll('[data-table] [data-row]')).map(
      (r) => r.querySelector('td')?.textContent?.trim().split('\n')[0].trim() ?? '',
    );

  it('chama a tela de "Sugestões" e usa pílulas com contagem que filtram', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Sugestões');
    expect(host.textContent).not.toContain('Moderação de Feedback');
    expect(host.querySelector('select')).toBeNull();

    const pills = Array.from(host.querySelectorAll<HTMLButtonElement>('app-pill-tabs [role="radio"]'));
    const pillText = (p: HTMLElement): string =>
      Array.from(p.querySelectorAll('span'))
        .map((span) => span.textContent?.trim())
        .join(' ');
    expect(pills.map(pillText)).toEqual([
      'Todas 3',
      'Backlog 1',
      'Planejado 1',
      'Em desenvolvimento 0',
      'Concluído 0',
      'Rejeitado 1',
    ]);

    pills[2].click();
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-table] [data-row]').length).toBe(1);
    expect(host.querySelector('[data-table]')?.textContent).toContain('Ação em lote');
  });

  it('busca sem acento no título, autor e nota', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    (fixture.componentInstance as unknown as { onQueryChange: (q: string) => void }).onQueryChange(
      'acao',
    );
    fixture.detectChanges();
    expect(rowTitles(host)).toHaveLength(1);
    expect(host.querySelector('[data-table]')?.textContent).toContain('Ação em lote');
  });

  it('situação em chip com tom, sem caixa alta e sem linha entre itens', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    const chips = Array.from(host.querySelectorAll('[data-table] app-status-chip')).map(
      (c) => c.textContent?.trim(),
    );
    expect(chips).toEqual(['Backlog', 'Planejado', 'Rejeitado']);
    expect(host.querySelector('.uppercase')).toBeNull();
    // Nenhuma linha entre registros nem entre itens do kebab (só espaço e preenchimento).
    const list = host.querySelector('app-data-list') as HTMLElement;
    const lineTokens = Array.from(list.querySelectorAll<HTMLElement>('[class]'))
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => /^(border-[tblrxy](-|$)|divide-)/.test(c));
    expect(lineTokens).toEqual([]);
  });

  it('data de envio no fuso de Brasília, com a hora no balão', () => {
    const fixture = create();
    const sent = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="feedback-sent"]',
    ) as HTMLElement;
    expect(sent.textContent).toContain('18/11/2026');
    expect(sent.getAttribute('title')).toContain('às 22:30:00');
  });

  it('avisa quando o servidor tem mais sugestões do que as carregadas', () => {
    const fixture = create(250);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="feedback-partial"]')
        ?.textContent,
    ).toContain('3 mais recentes de 250');
  });
});
