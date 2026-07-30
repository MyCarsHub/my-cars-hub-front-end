import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationFeedService } from './notification-feed.service';
import { SessionService } from './session.service';
import type { NotificationItem } from '../types/notification-feed.types';

/**
 * Cobre o feed persistido do sino:
 *  - polling: start idempotente, tick imediato, intervalo de 60s, stop e
 *    limpeza via DestroyRef;
 *  - o polling não roda em SSR, com a aba escondida ou sem token;
 *  - `visibilitychange` traz o contador de volta ao voltar pra aba;
 *  - `markRead` decrementa (sem passar de 0) e `markAllRead` ZERA — nunca usa
 *    o `count` devolvido, que são as linhas marcadas AGORA;
 *  - as mutações recarregam a página atual com os últimos filtros.
 */
describe('NotificationFeedService', () => {
  const item: NotificationItem = {
    id: 'n-1',
    type: 'CNH_DUE_SOON',
    typeLabel: 'CNH',
    severity: 'DANGER',
    title: 'CNH de João vence em 3 dias',
    message: 'Renove a habilitação.',
    entityType: 'DRIVER',
    entityId: 'd-1',
    dueDate: '2026-08-01',
    actionUrl: '/motoristas/d-1',
    read: false,
    createdAt: '2026-07-29T10:00:00Z',
  };

  const page = (content: NotificationItem[]) => ({
    content,
    page: 0,
    size: 10,
    total: content.length,
  });

  let httpGet: ReturnType<typeof vi.fn>;
  let httpPatch: ReturnType<typeof vi.fn>;
  let getToken: ReturnType<typeof vi.fn>;
  let getItem: ReturnType<typeof vi.fn>;
  let sessionStore: Record<string, string>;
  let unreadCountResponse: number;
  let hidden: boolean;

  function isUnreadCountUrl(url: unknown): boolean {
    return String(url).endsWith('/unread-count');
  }

  function unreadCountCalls(): number {
    return httpGet.mock.calls.filter((c) => isUnreadCountUrl(c[0])).length;
  }

  function listCalls(): unknown[][] {
    return httpGet.mock.calls.filter((c) => !isUnreadCountUrl(c[0]));
  }

  function create(platform: 'browser' | 'server' = 'browser'): NotificationFeedService {
    TestBed.configureTestingModule({
      providers: [
        NotificationFeedService,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: HttpClient, useValue: { get: httpGet, patch: httpPatch } },
        { provide: SessionService, useValue: { getToken, getItem } },
      ],
    });
    return TestBed.inject(NotificationFeedService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();

    hidden = false;
    unreadCountResponse = 3;
    getToken = vi.fn(() => 'jwt-token');
    sessionStore = { selectedCompanyId: 'company-a' };
    getItem = vi.fn((key: string) => sessionStore[key] ?? null);
    httpPatch = vi.fn(() => of(''));
    httpGet = vi.fn((url: string) =>
      isUnreadCountUrl(url) ? of({ count: unreadCountResponse }) : of(page([item])),
    );

    // `document.hidden` é readonly em jsdom — sobrescrito por teste e removido
    // depois para não vazar para outras suítes.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    delete (document as unknown as Record<string, unknown>)['hidden'];
  });

  describe('list', () => {
    it('envia page/size e só manda unreadOnly quando pedido', () => {
      const service = create();

      service.list().subscribe();
      let params = listCalls().at(-1)?.[1] as { params: HttpParams };
      expect(params.params.get('page')).toBe('0');
      expect(params.params.get('size')).toBe('10');
      expect(params.params.get('unreadOnly')).toBeNull();

      service.list(true, 2, 25).subscribe();
      params = listCalls().at(-1)?.[1] as { params: HttpParams };
      expect(params.params.get('page')).toBe('2');
      expect(params.params.get('size')).toBe('25');
      expect(params.params.get('unreadOnly')).toBe('true');
    });

    it('publica a página nos signals e baixa o loading', () => {
      const service = create();
      service.list().subscribe();

      expect(service.items()).toEqual([item]);
      expect(service.total()).toBe(1);
      expect(service.loading()).toBe(false);
      expect(service.error()).toBeNull();
    });

    it('grava a mensagem de erro e reemite a falha', () => {
      const service = create();
      httpGet.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
      );

      const onError = vi.fn();
      service.list().subscribe({ error: onError });

      expect(service.error()).toBe('Não foi possível carregar as notificações.');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(service.loading()).toBe(false);
    });
  });

  describe('contador de não lidas', () => {
    it('refreshUnreadCount alimenta o signal e trata resposta vazia como 0', () => {
      const service = create();

      service.refreshUnreadCount().subscribe();
      expect(service.unreadCount()).toBe(3);

      httpGet.mockReturnValue(of(null));
      service.refreshUnreadCount().subscribe();
      expect(service.unreadCount()).toBe(0);
    });

    it('markRead decrementa em 1, marca o item como lido e recarrega a lista', () => {
      const service = create();
      service.refreshUnreadCount().subscribe();
      service.list(true).subscribe();
      const listsBefore = listCalls().length;

      service.markRead('n-1').subscribe();

      expect(httpPatch.mock.calls[0][0]).toContain('/notifications/n-1/read');
      expect(service.unreadCount()).toBe(2);
      // Recarrega mantendo o último filtro (`unreadOnly=true`).
      expect(listCalls().length).toBe(listsBefore + 1);
      const params = listCalls().at(-1)?.[1] as { params: HttpParams };
      expect(params.params.get('unreadOnly')).toBe('true');
    });

    it('markRead nunca leva o contador abaixo de zero', () => {
      const service = create();
      unreadCountResponse = 0;
      service.refreshUnreadCount().subscribe();

      service.markRead('n-1').subscribe();

      expect(service.unreadCount()).toBe(0);
    });

    it('markAllRead ZERA o contador em vez de usar o count devolvido', () => {
      const service = create();
      service.refreshUnreadCount().subscribe();
      service.list().subscribe();
      const listsBefore = listCalls().length;
      httpPatch.mockReturnValue(of({ count: 7 }));

      service.markAllRead().subscribe();

      expect(httpPatch.mock.calls.at(-1)?.[0]).toContain('/notifications/read-all');
      expect(service.unreadCount()).toBe(0);
      expect(listCalls().length).toBe(listsBefore + 1);
    });

    it('não mexe no contador quando a mutação falha', () => {
      const service = create();
      service.refreshUnreadCount().subscribe();
      httpPatch.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
      );

      service.markRead('n-1').subscribe({ error: () => void 0 });

      expect(service.unreadCount()).toBe(3);
    });
  });

  describe('polling', () => {
    it('faz um tick imediato e repete a cada 60s', () => {
      const service = create();

      service.startPolling();
      expect(unreadCountCalls()).toBe(1);

      vi.advanceTimersByTime(60_000);
      expect(unreadCountCalls()).toBe(2);

      vi.advanceTimersByTime(120_000);
      expect(unreadCountCalls()).toBe(4);
      expect(service.unreadCount()).toBe(3);
    });

    it('é idempotente — chamar de novo não cria um segundo interval', () => {
      const service = create();

      service.startPolling();
      service.startPolling();
      expect(unreadCountCalls()).toBe(1);

      vi.advanceTimersByTime(60_000);
      expect(unreadCountCalls()).toBe(2);
    });

    it('stopPolling encerra o interval e o listener de visibilidade', () => {
      const service = create();
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      service.startPolling();
      service.stopPolling();
      vi.advanceTimersByTime(180_000);

      expect(unreadCountCalls()).toBe(1);
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

      // Depois do stop, `visibilitychange` não pode mais disparar nada.
      document.dispatchEvent(new Event('visibilitychange'));
      expect(unreadCountCalls()).toBe(1);
      removeSpy.mockRestore();
    });

    it('não roda em SSR', () => {
      const service = create('server');

      service.startPolling();
      vi.advanceTimersByTime(180_000);

      expect(unreadCountCalls()).toBe(0);
      expect(service.unreadCount()).toBe(0);
    });

    it('pula o tick com a aba escondida e volta ao reaparecer', () => {
      const service = create();
      hidden = true;

      service.startPolling();
      vi.advanceTimersByTime(120_000);
      expect(unreadCountCalls()).toBe(0);

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));

      expect(unreadCountCalls()).toBe(1);
      expect(service.unreadCount()).toBe(3);
    });

    it('não faz o tick sem token na sessão', () => {
      const service = create();
      getToken.mockReturnValue(null);

      service.startPolling();
      vi.advanceTimersByTime(120_000);

      expect(unreadCountCalls()).toBe(0);
    });

    it('engole falhas do tick sem quebrar o polling', () => {
      const service = create();
      httpGet.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })),
      );

      expect(() => {
        service.startPolling();
        vi.advanceTimersByTime(60_000);
      }).not.toThrow();
      expect(unreadCountCalls()).toBe(2);
    });

    it('o polling parado no logout não volta sozinho', () => {
      const service = create();
      service.startPolling();
      expect(unreadCountCalls()).toBe(1);

      service.stopPolling();
      service.reset();
      vi.advanceTimersByTime(300_000);

      expect(unreadCountCalls()).toBe(1);
      expect(service.unreadCount()).toBe(0);
    });

    it('o DestroyRef do injector para o polling ao destruir a aplicação', () => {
      const service = create();
      service.startPolling();
      expect(unreadCountCalls()).toBe(1);

      TestBed.resetTestingModule();
      vi.advanceTimersByTime(180_000);

      expect(unreadCountCalls()).toBe(1);
    });
  });

  /**
   * O serviço é root e o logout NÃO recarrega a página: sem `reset()` o próximo
   * usuário da mesma aba veria os títulos (que carregam placa/nome) do anterior.
   */
  describe('reset', () => {
    it('devolve todos os signals ao estado inicial', () => {
      const service = create();
      service.list(true, 2, 25).subscribe();
      service.refreshUnreadCount().subscribe();

      expect(service.items()).toEqual([item]);
      expect(service.unreadCount()).toBe(3);

      service.reset();

      expect(service.items()).toEqual([]);
      expect(service.unreadCount()).toBe(0);
      expect(service.page()).toBe(0);
      expect(service.size()).toBe(10);
      expect(service.total()).toBe(0);
      expect(service.loading()).toBe(false);
      expect(service.error()).toBeNull();
    });

    it('esquece o último filtro — o próximo reload não vaza `unreadOnly` da sessão anterior', () => {
      const service = create();
      service.list(true).subscribe();

      service.reset();
      service.markRead('n-1').subscribe();

      const params = listCalls().at(-1)?.[1] as { params: HttpParams };
      expect(params.params.get('unreadOnly')).toBeNull();
    });

    it('limpa a mensagem de erro herdada da sessão anterior', () => {
      const service = create();
      httpGet.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
      );
      service.list().subscribe({ error: () => void 0 });
      expect(service.error()).not.toBeNull();

      service.reset();

      expect(service.error()).toBeNull();
    });
  });

  /**
   * A troca de empresa só navega — o AppShell e o sino não são destruídos, então
   * sem `syncTenant()` o contador da empresa A sobreviveria até 60s sob a B.
   */
  describe('syncTenant', () => {
    it('zera o cache e faz um tick imediato quando a empresa muda', () => {
      const service = create();
      service.startPolling();
      service.list().subscribe();
      expect(service.items()).toEqual([item]);
      expect(service.unreadCount()).toBe(3);
      const ticksBefore = unreadCountCalls();

      sessionStore['selectedCompanyId'] = 'company-b';
      unreadCountResponse = 1;
      service.syncTenant();

      // Refetch imediato: não espera o próximo poll de 60s.
      expect(unreadCountCalls()).toBe(ticksBefore + 1);
      expect(service.items()).toEqual([]);
      expect(service.unreadCount()).toBe(1);
    });

    it('é no-op quando a empresa selecionada não mudou', () => {
      const service = create();
      service.startPolling();
      service.list().subscribe();
      const ticksBefore = unreadCountCalls();

      service.syncTenant();
      service.syncTenant();

      expect(unreadCountCalls()).toBe(ticksBefore);
      expect(service.items()).toEqual([item]);
    });

    it('não vaza a empresa antiga quando `startPolling` já está ativo', () => {
      const service = create();
      service.startPolling();
      expect(service.unreadCount()).toBe(3);

      sessionStore['selectedCompanyId'] = 'company-b';
      unreadCountResponse = 0;
      service.syncTenant();

      expect(service.unreadCount()).toBe(0);
      // O interval original continua vivo (start é idempotente, não recria).
      unreadCountResponse = 5;
      vi.advanceTimersByTime(60_000);
      expect(service.unreadCount()).toBe(5);
    });
  });
});
