import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Roadmap } from './roadmap';
import { FeedbackService } from '../../services/feedback.service';
import { SessionService } from '../../services/session.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { FeedbackTaskResponse } from '../../types/feedback.types';

/**
 * O card corta a descrição com `line-clamp-3`; o caminho para ler a mensagem
 * inteira é abrir o `app-detail-dialog`. O que precisa ficar protegido: o card
 * abre, os controles internos (combustível) NÃO abrem, Escape fecha, e o
 * contador do formulário acompanha o que foi digitado.
 */
describe('Roadmap', () => {
  const LONG_DESCRIPTION = [
    'Primeira linha da sugestão, bem detalhada.',
    'Segunda linha explicando o problema.',
    'Terceira linha com a proposta.',
    'Quarta linha que o card nunca mostra por causa do line-clamp.',
  ].join('\n');

  const TASK: FeedbackTaskResponse = {
    id: 'fb-1',
    title: 'Notificações por WhatsApp',
    description: LONG_DESCRIPTION,
    status: 'BACKLOG',
    fuelCount: 3,
    hasVoted: false,
    authorId: 'user-9',
    authorName: 'Fulano',
    createdDate: '2026-01-01T00:00:00Z',
    modifyDate: null,
    adminNote: null,
  };

  let fixture: ComponentFixture<Roadmap>;
  let fuel: ReturnType<typeof vi.fn>;

  function settle(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function firstCard(): HTMLElement {
    const card = host().querySelector<HTMLElement>('article[role="button"]');
    if (!card) throw new Error('card do roadmap não renderizado');
    return card;
  }

  function dialog(): HTMLElement | null {
    return host().querySelector<HTMLElement>('app-detail-dialog [role="dialog"]');
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    fuel = vi.fn().mockReturnValue(of(TASK));
    TestBed.configureTestingModule({
      imports: [Roadmap],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: FeedbackService,
          useValue: {
            tasks: signal<FeedbackTaskResponse[]>([TASK]),
            loading: signal(false),
            error: signal<string | null>(null),
            loadTasks: vi.fn().mockReturnValue(of({ content: [TASK], total: 1 })),
            fuel,
            unfuel: vi.fn().mockReturnValue(of(void 0)),
            create: vi.fn().mockReturnValue(of(TASK)),
            update: vi.fn().mockReturnValue(of(TASK)),
            remove: vi.fn().mockReturnValue(of(void 0)),
            adminDelete: vi.fn().mockReturnValue(of(void 0)),
            updateStatus: vi.fn().mockReturnValue(of(TASK)),
          },
        },
        {
          provide: SessionService,
          useValue: {
            getUserId: () => null,
            getSystemRole: () => 'USER' as const,
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });
    fixture = TestBed.createComponent(Roadmap);
    fixture.detectChanges();
  });

  it('clicar no card abre o diálogo com a descrição completa', () => {
    expect(dialog()).toBeNull();

    firstCard().click();
    settle();

    const opened = dialog();
    expect(opened).not.toBeNull();
    expect(opened?.textContent).toContain(TASK.title);
    // as quatro linhas — inclusive a que o line-clamp esconde no card
    expect(opened?.textContent).toContain('Quarta linha que o card nunca mostra');
  });

  it('o card é acionável por teclado (Enter)', () => {
    firstCard().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    settle();

    expect(dialog()).not.toBeNull();
  });

  it('clicar no botão de combustível vota e NÃO abre o diálogo', () => {
    const vote = firstCard().querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(vote).not.toBeNull();

    vote?.click();
    settle();

    expect(fuel).toHaveBeenCalledWith('fb-1');
    expect(dialog()).toBeNull();
  });

  it('Escape fecha o diálogo de detalhe', async () => {
    firstCard().click();
    settle();
    expect(dialog()).not.toBeNull();

    const target = (document.activeElement as HTMLElement | null) ?? dialog();
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    settle();

    // a remoção do nó é concluída depois do `:leave`, mesmo com animações noop
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dialog()).toBeNull();
  });

  it('o contador do formulário reflete o que foi digitado', () => {
    const newSuggestion = Array.from(host().querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Nova Sugestão'),
    );
    newSuggestion?.click();
    settle();

    const textarea = host().querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('textarea de descrição não renderizado');
    expect(textarea.getAttribute('maxlength')).toBe('2000');

    function counterText(): string {
      const paragraphs = Array.from(host().querySelectorAll<HTMLElement>('p'));
      return paragraphs.find((p) => p.textContent?.includes('/ 2000'))?.textContent?.trim() ?? '';
    }

    expect(counterText()).toBe('0 / 2000');

    textarea.value = 'abcde';
    textarea.dispatchEvent(new Event('input'));
    settle();

    expect(counterText()).toBe('5 / 2000');
  });
});
