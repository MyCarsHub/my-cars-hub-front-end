import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { NotificationBell } from './notification-bell';
import { NotificationFeedService } from '../../services/notification-feed.service';
import type { NotificationItem } from '../../types/notification-feed.types';

/**
 * Cobre o sino do header:
 *  - badge escondido em 0 e limitado a "99+", com o número real no aria-label;
 *  - contrato de a11y do gatilho (aria-haspopup/aria-expanded);
 *  - clique num item marca como lida ANTES de navegar;
 *  - "marcar todas como lidas" delega ao service;
 *  - Escape fecha o painel e devolve o foco ao gatilho.
 */
describe('NotificationBell', () => {
  const item: NotificationItem = {
    id: 'n-1',
    type: 'CNH_DUE_SOON',
    typeLabel: 'CNH',
    severity: 'DANGER',
    title: 'CNH de João vence em 3 dias',
    message: 'Renove a habilitação para manter o motorista ativo.',
    entityType: 'DRIVER',
    entityId: 'd-1',
    dueDate: '2026-08-01',
    actionUrl: '/motoristas/d-1',
    read: false,
    createdAt: '2026-07-29T10:00:00Z',
  };

  let unreadCount: ReturnType<typeof signal<number>>;
  let items: ReturnType<typeof signal<NotificationItem[]>>;
  let markReadSpy: ReturnType<typeof vi.fn>;
  let markAllReadSpy: ReturnType<typeof vi.fn>;
  let listSpy: ReturnType<typeof vi.fn>;

  function configure(): void {
    unreadCount = signal(3);
    items = signal<NotificationItem[]>([item]);
    markReadSpy = vi.fn().mockReturnValue(of(void 0));
    markAllReadSpy = vi.fn().mockReturnValue(of({ count: 3 }));
    listSpy = vi.fn().mockReturnValue(of({ content: [item], page: 0, size: 10, total: 1 }));

    TestBed.configureTestingModule({
      imports: [NotificationBell],
      providers: [
        provideRouter([]),
        {
          provide: NotificationFeedService,
          useValue: {
            items,
            loading: signal(false),
            error: signal<string | null>(null),
            unreadCount,
            list: listSpy,
            markRead: markReadSpy,
            markAllRead: markAllReadSpy,
            refreshUnreadCount: vi.fn().mockReturnValue(of({ count: 3 })),
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
          },
        },
      ],
    });
  }

  function trigger(host: HTMLElement): HTMLButtonElement {
    const el = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    if (!el) throw new Error('trigger não renderizado');
    return el;
  }

  /** Botões de notificação do painel (a lista, sem o cromo do cabeçalho/rodapé). */
  function itemButtons(host: HTMLElement): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="dialog"] ul li button'));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    configure();
  });

  it('esconde o badge quando não há não lidas', () => {
    unreadCount.set(0);
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(trigger(host).querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(trigger(host).getAttribute('aria-label')).toBe('Notificações, nenhuma não lida');
  });

  it('renderiza "99+" acima de 99 mas mantém o número real no aria-label', () => {
    unreadCount.set(128);
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(trigger(host).textContent?.trim()).toContain('99+');
    expect(trigger(host).getAttribute('aria-label')).toBe('Notificações, 128 não lidas');
  });

  it('abre o painel e reflete o estado em aria-expanded', () => {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(trigger(host).getAttribute('aria-expanded')).toBe('false');

    trigger(host).click();
    fixture.detectChanges();

    expect(trigger(host).getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(listSpy).toHaveBeenCalled();
  });

  /**
   * AXE `aria-required-children`: o painel carrega cabeçalho, botão de "marcar
   * todas", skeleton e estado vazio — nada disso é item de menu. O painel é um
   * diálogo rotulado e a lista é uma `<ul>` de verdade.
   */
  it('não usa role=menu/menuitem no painel — é um diálogo rotulado com lista', () => {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    trigger(host).click();
    fixture.detectChanges();

    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[role="menuitem"]')).toBeNull();

    const panel = host.querySelector('[role="dialog"]');
    expect(panel?.getAttribute('aria-label')).toBe('Notificações recentes');
    expect(panel?.querySelectorAll('ul > li')).toHaveLength(1);
  });

  it('move o foco para o primeiro item ao abrir o painel', () => {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(document.activeElement).not.toBe(itemButtons(host)[0]);

    trigger(host).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(itemButtons(host)[0]);
  });

  it('sem notificações o foco ainda entra no painel (primeiro item focável)', () => {
    items.set([]);
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    trigger(host).click();
    fixture.detectChanges();

    const panel = host.querySelector('[role="dialog"]');
    // Contêiner focável é a rede de segurança quando nem o link do rodapé existe.
    expect(panel?.getAttribute('tabindex')).toBe('-1');
    expect(itemButtons(host)).toHaveLength(0);
    expect(panel?.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement | null)?.textContent?.trim()).toBe(
      'Ver todos os alertas',
    );
  });

  it('clicar num item marca como lida e navega para o actionUrl', () => {
    const fixture = TestBed.createComponent(NotificationBell);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    trigger(host).click();
    fixture.detectChanges();

    itemButtons(host)[0]?.click();
    fixture.detectChanges();

    expect(markReadSpy).toHaveBeenCalledWith('n-1');
    expect(navigate).toHaveBeenCalledWith('/motoristas/d-1');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('"Marcar todas como lidas" delega ao service', () => {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    trigger(host).click();
    fixture.detectChanges();

    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Marcar todas como lidas',
    );
    button?.click();

    expect(markAllReadSpy).toHaveBeenCalled();
  });

  it('Escape fecha o painel e devolve o foco ao gatilho', () => {
    const fixture = TestBed.createComponent(NotificationBell);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    trigger(host).click();
    fixture.detectChanges();

    const panel = host.querySelector('[role="dialog"]');
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger(host));
  });
});
