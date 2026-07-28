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
  });
});
