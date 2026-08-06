import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertsService } from './alerts.service';
import { ImpersonationService } from './impersonation.service';
import { InsurancesService } from './insurances.service';
import { InvitesService } from './invites.service';
import { NotificationFeedService } from './notification-feed.service';
import { NotificationService } from './notification.service';
import { SessionResetRegistry } from './session-reset.registry';
import { SessionService } from './session.service';
import {
  IMPERSONATION_ADMIN_CONTEXT_KEY,
  IMPERSONATION_ADMIN_TOKEN_KEY,
  IMPERSONATION_STATE_KEY,
  USE_ADMIN_TOKEN,
} from './impersonation.context';
import { ImpersonationStartResponse } from '../types/impersonation.types';

const ADMIN_TOKEN = 'admin.jwt.token';
const IMPERSONATION_TOKEN = 'impersonation.jwt.token';

/**
 * `startedAt` e `expiresAt` vêm da MESMA resposta, logo do MESMO relógio — e é
 * disso que `measureClockOffset()` depende. O fixture antigo fixava `startedAt`
 * num literal enquanto `expiresAt` era calculado a partir de `Date.now()`: a
 * distância entre os dois crescia um dia por dia de calendário, e o serviço
 * armava o timer de expiração para MESES à frente. `setTimeout` estoura em
 * int32 (~24,8 dias) e o Node degrada o atraso para 1ms — o timer disparava
 * logo depois do corpo do teste, já com o TestBed derrubado (NG0205).
 * Por isso o padrão é "agora": é o que o servidor de verdade manda.
 */
function startResponse(
  expiresAt: string,
  startedAt = new Date().toISOString(),
): ImpersonationStartResponse {
  return {
    sessionId: 'sess-1',
    token: IMPERSONATION_TOKEN,
    impersonation: true,
    readOnly: true,
    companyId: 'co-1',
    companyName: 'Locadora Alfa',
    startedAt,
    expiresAt,
  };
}

/**
 * `sessionStorage` de mentira — o teste precisa observar a troca de credencial.
 *
 * `clear()` dispara os ganchos do `SessionResetRegistry` porque é EXATAMENTE o
 * que o `SessionService` real passou a fazer. Um dublê que só esvaziasse o mapa
 * esconderia o bug que motivou a mudança: o estado de impersonação sobrevivendo
 * em memória a uma sessão já zerada.
 */
class FakeSession {
  readonly store = new Map<string, string>();
  registry: SessionResetRegistry | null = null;
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
    this.registry?.run();
  }
  setToken(token: string): void {
    this.setItem('token', token);
  }
  getToken(): string | null {
    return this.getItem('token');
  }
}

describe('ImpersonationService', () => {
  let session: FakeSession;
  let httpGet: ReturnType<typeof vi.fn>;
  let httpPost: ReturnType<typeof vi.fn>;
  let httpDelete: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let notifications: Record<string, ReturnType<typeof vi.fn>>;

  /** Última instância construída — o `afterEach` precisa dela para desarmar o timer. */
  let built: ImpersonationService | null = null;

  /** Instancia o service DEPOIS de o teste semear o storage (a hidratação lê no construtor). */
  function build(): ImpersonationService {
    TestBed.configureTestingModule({
      providers: [
        ImpersonationService,
        { provide: SessionService, useValue: session },
        {
          provide: HttpClient,
          useValue: { get: httpGet, post: httpPost, delete: httpDelete, patch: vi.fn() },
        },
        { provide: Router, useValue: { navigate } },
        { provide: NotificationService, useValue: notifications },
      ],
    });
    session.registry = TestBed.inject(SessionResetRegistry);
    built = TestBed.inject(ImpersonationService);
    return built;
  }

  function futureIso(minutes = 15): string {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    session = new FakeSession();
    session.setToken(ADMIN_TOKEN);
    httpGet = vi.fn(() => of({ count: 0, content: [], page: 0, size: 10, total: 0 }));
    httpPost = vi.fn(() => of(startResponse(futureIso())));
    httpDelete = vi.fn(() => of(''));
    navigate = vi.fn();
    notifications = {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    // O timer de expiração é um handle REAL: sobrevive ao `resetTestingModule()`
    // do próximo teste. Um teste que abre a sessão e não a encerra deixa o timer
    // armado, e se ele disparar depois disso o `finish()` alcança um Injector já
    // destruído (NG0205) — erro não capturado que reprova o processo do Vitest
    // com a suíte inteira verde. `reset()` desarma sem tocar em servidor nenhum.
    built?.reset();
    built = null;
    // Depois do `reset()`: com timers falsos ativos, o `clearTimeout` que
    // desarma precisa ser o mesmo dublê que armou.
    vi.useRealTimers();
  });

  describe('início da sessão', () => {
    it('troca a credencial ativa e PRESERVA o token administrativo', () => {
      const service = build();

      service.start('co-1').subscribe();

      expect(session.getToken()).toBe(IMPERSONATION_TOKEN);
      expect(session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY)).toBe(ADMIN_TOKEN);
      expect(service.active()).toBe(true);
      expect(service.companyName()).toBe('Locadora Alfa');
      expect(service.readOnly()).toBe(true);
    });

    it('aponta a empresa selecionada para o tenant impersonado', () => {
      session.setItem('selectedCompanyId', 'admin-co');
      session.setItem('selectedCompanyName', 'Empresa do admin');
      session.setItem('selectedRole', 'OWNER');
      const service = build();

      service.start('co-1').subscribe();

      expect(session.getItem('selectedCompanyId')).toBe('co-1');
      expect(session.getItem('selectedCompanyName')).toBe('Locadora Alfa');
      expect(session.getItem('userCompanies')).toContain('Locadora Alfa');
      expect(session.getItem(IMPERSONATION_ADMIN_CONTEXT_KEY)).toContain('admin-co');
    });

    it('recusa uma segunda sessão na mesma aba', () => {
      const service = build();
      service.start('co-1').subscribe();

      let failed = false;
      service.start('co-2').subscribe({ error: () => (failed = true) });

      expect(failed).toBe(true);
      expect(httpPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('encerramento pelo banner', () => {
    it('chama o DELETE com a credencial ADMINISTRATIVA e restaura o contexto', () => {
      session.setItem('selectedCompanyId', 'admin-co');
      session.setItem('selectedRole', 'MANAGER');
      session.setItem('userCompanies', '[{"companyId":"admin-co"}]');
      const service = build();
      service.start('co-1').subscribe();

      service.end().subscribe();

      expect(httpDelete).toHaveBeenCalledTimes(1);
      const [url, options] = httpDelete.mock.calls[0] as [string, { context: HttpContext }];
      expect(url).toContain('/admin/impersonation/sess-1');
      expect(options.context.get(USE_ADMIN_TOKEN)).toBe(true);

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(session.getItem(IMPERSONATION_STATE_KEY)).toBeNull();
      expect(session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY)).toBeNull();
      expect(session.getItem('selectedCompanyId')).toBe('admin-co');
      expect(session.getItem('selectedRole')).toBe('MANAGER');
      expect(session.getItem('userCompanies')).toBe('[{"companyId":"admin-co"}]');
      expect(navigate).toHaveBeenCalledWith(['/admin/companies', 'co-1']);
    });

    it('trata 404 (sessão já encerrada) como sucesso, sem alarmar o admin', () => {
      httpDelete = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 })));
      const service = build();
      service.start('co-1').subscribe();

      service.end().subscribe();

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(notifications['warning']).not.toHaveBeenCalled();
    });

    it('restaura o acesso do admin MESMO se o DELETE falhar — nunca deixa preso', () => {
      httpDelete = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));
      const service = build();
      service.start('co-1').subscribe();

      service.end().subscribe();

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(notifications['warning']).toHaveBeenCalled();
    });
  });

  describe('expiração de 15 minutos', () => {
    it('encerra sozinha quando o relógio chega em expiresAt', () => {
      vi.useFakeTimers();
      httpPost = vi.fn(() => of(startResponse(new Date(Date.now() + 15 * 60_000).toISOString())));
      const service = build();
      service.start('co-1').subscribe();
      expect(service.active()).toBe(true);

      // A janela ainda não fechou. Esta asserção é o que prova que o timer está
      // armado PARA `expiresAt`: com o atraso estourando o int32 do `setTimeout`
      // ele degradava para 1ms e a sessão morria aqui, com o teste ainda verde.
      vi.advanceTimersByTime(14 * 60_000);
      expect(service.active()).toBe(true);

      vi.advanceTimersByTime(60_000 + 10);

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(httpDelete).not.toHaveBeenCalled();
    });

    it('expire() devolve o admin ao próprio contexto sem chamar o servidor', () => {
      const service = build();
      service.start('co-1').subscribe();

      service.expire();

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(httpDelete).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/admin/companies', 'co-1']);
    });
  });

  describe('recarregar a aba', () => {
    it('mantém a sessão viva quando o estado ainda não venceu', () => {
      session.setToken(IMPERSONATION_TOKEN);
      session.setItem(IMPERSONATION_ADMIN_TOKEN_KEY, ADMIN_TOKEN);
      session.setItem(
        IMPERSONATION_STATE_KEY,
        JSON.stringify({
          sessionId: 'sess-1',
          companyId: 'co-1',
          companyName: 'Locadora Alfa',
          startedAt: '2026-01-01T12:00:00Z',
          expiresAt: futureIso(10),
        }),
      );

      const service = build();

      expect(service.active()).toBe(true);
      expect(service.companyName()).toBe('Locadora Alfa');
      expect(session.getToken()).toBe(IMPERSONATION_TOKEN);
    });

    it('nunca restaura uma sessão vencida — devolve o token administrativo na hidratação', () => {
      session.setToken(IMPERSONATION_TOKEN);
      session.setItem(IMPERSONATION_ADMIN_TOKEN_KEY, ADMIN_TOKEN);
      session.setItem(
        IMPERSONATION_STATE_KEY,
        JSON.stringify({
          sessionId: 'sess-1',
          companyId: 'co-1',
          companyName: 'Locadora Alfa',
          startedAt: '2020-01-01T00:00:00Z',
          expiresAt: '2020-01-01T00:15:00Z',
        }),
      );

      const service = build();

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      // No boot da aplicação o Router ainda não resolveu rota — não se navega.
      expect(navigate).not.toHaveBeenCalled();
    });

    it('estado ilegível não deixa a aba presa em modo leitura', () => {
      session.setToken(IMPERSONATION_TOKEN);
      session.setItem(IMPERSONATION_ADMIN_TOKEN_KEY, ADMIN_TOKEN);
      session.setItem(IMPERSONATION_STATE_KEY, '{ not json');

      const service = build();

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
    });
  });

  describe('reconciliação com os cabeçalhos do servidor', () => {
    it('mantém a sessão quando o servidor confirma a mesma empresa', () => {
      const service = build();
      service.start('co-1').subscribe();

      service.reconcile('CO-1');

      expect(service.active()).toBe(true);
    });

    it('encerra quando o servidor aponta outra empresa — o banner não pode mentir', () => {
      const service = build();
      service.start('co-1').subscribe();

      service.reconcile('co-outra');

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
    });
  });

  /**
   * VÃO DE COBERTURA 1 — encerramento concorrente com o DELETE em voo.
   *
   * A janela é a mais provável de todas: clicar "Encerrar" perto dos 15
   * minutos. `end()` dispara o DELETE, o timer de expiração (ou um 401 de outra
   * requisição, ou o `reconcile()`) encerra a sessão enquanto ele voa, e quando
   * a resposta chega o `finish()` roda uma SEGUNDA vez. A primeira já consumiu
   * e removeu o token administrativo, então a segunda concluía "sem credencial"
   * e derrubava a sessão inteira para o /login — deslogando o admin por ter
   * encerrado a impersonação com sucesso.
   */
  describe('encerramento concorrente com o DELETE em voo', () => {
    function pendingDelete(): { resolve: () => void } {
      const gate = new Subject<string>();
      httpDelete = vi.fn(() => gate.asObservable());
      return {
        resolve: () => {
          gate.next('');
          gate.complete();
        },
      };
    }

    it('expiração durante o DELETE: o admin volta ao próprio acesso, não ao /login', () => {
      const gate = pendingDelete();
      const service = build();
      service.start('co-1').subscribe();

      service.end().subscribe();
      expect(httpDelete).toHaveBeenCalledTimes(1);
      // A sessão morre enquanto o DELETE ainda está em voo.
      service.expire();
      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);

      gate.resolve();

      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(navigate).not.toHaveBeenCalledWith(['/login'], { replaceUrl: true });
      expect(notifications['warning']).not.toHaveBeenCalledWith(
        'Sua sessão terminou. Faça login novamente.',
      );
    });

    it('o timer de expiração disparando durante o DELETE tem o mesmo desfecho', () => {
      vi.useFakeTimers();
      const gate = pendingDelete();
      httpPost = vi.fn(() => of(startResponse(new Date(Date.now() + 15 * 60_000).toISOString())));
      const service = build();
      service.start('co-1').subscribe();

      service.end().subscribe();
      vi.advanceTimersByTime(15 * 60_000 + 10);
      gate.resolve();

      expect(service.active()).toBe(false);
      expect(session.getToken()).toBe(ADMIN_TOKEN);
      expect(navigate).not.toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    });

    it('a falha do DELETE não alarma sobre uma sessão que já foi encerrada', () => {
      const gate = new Subject<string>();
      httpDelete = vi.fn(() => gate.asObservable());
      const service = build();
      service.start('co-1').subscribe();

      service.end().subscribe();
      service.expire();
      notifications['warning'].mockClear();
      gate.error(new HttpErrorResponse({ status: 500 }));

      expect(notifications['warning']).not.toHaveBeenCalled();
    });
  });

  /**
   * VÃO DE COBERTURA 2 — a sessão sendo zerada FORA do `logout()`.
   *
   * Cinco dos seis `session.clear()` do app não desfaziam a impersonação: o
   * sinal continuava "ativo" sem nenhuma credencial atrás dele, e o
   * `impersonationInterceptor` passava a recusar todo POST — inclusive o
   * `/auth/login`, prendendo o admin fora da própria conta.
   */
  describe('sessão zerada por um caminho que não o logout', () => {
    it('`session.clear()` desfaz a impersonação, não só o armazenamento', () => {
      const service = build();
      service.start('co-1').subscribe();
      expect(service.active()).toBe(true);

      // É o que `errorInterceptor`, `authGuard` e `oauth-success` fazem.
      session.clear();

      expect(service.active()).toBe(false);
      expect(service.readOnly()).toBe(false);
      expect(session.getItem(IMPERSONATION_STATE_KEY)).toBeNull();
      expect(session.getItem(IMPERSONATION_ADMIN_TOKEN_KEY)).toBeNull();
      expect(session.getItem(IMPERSONATION_ADMIN_CONTEXT_KEY)).toBeNull();
    });

    it('o `clear()` que o próprio finish() dispara não reentra e não some com o login', () => {
      const service = build();
      service.start('co-1').subscribe();
      // Estado impossível por construção: alguém apagou a credencial na mão.
      session.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);

      service.expire();

      expect(service.active()).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
      expect(navigate).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * VÃO DE COBERTURA 3 — resíduo de cache entre contextos.
   *
   * Durante a sessão o admin LÊ as telas da empresa observada (é o objetivo da
   * feature) e os serviços de raiz enchem com dado dela. Como o encerramento só
   * restaurava as chaves de sessão, o sino, os seguros, os alertas e a lista de
   * convidados (que carrega os e-mails deles — PII do tenant) sobreviviam
   * dentro do contexto do próprio administrador.
   */
  describe('resíduo de cache entre contextos', () => {
    /** Contador que o backend devolve — muda para distinguir refetch de resíduo. */
    let unreadFromServer = 4;

    beforeEach(() => {
      unreadFromServer = 4;
    });

    function fillCaches(): {
      feed: NotificationFeedService;
      insurances: InsurancesService;
      alerts: AlertsService;
      invites: InvitesService;
    } {
      const feed = TestBed.inject(NotificationFeedService);
      const insurances = TestBed.inject(InsurancesService);
      const alerts = TestBed.inject(AlertsService);
      const invites = TestBed.inject(InvitesService);

      httpGet.mockImplementation((url: string) => {
        const target = String(url);
        if (target.endsWith('/unread-count')) return of({ count: unreadFromServer });
        if (target.includes('/invites')) {
          return of([{ id: 'inv-1', email: 'convidado@empresa-cliente.com', status: 'PENDING' }]);
        }
        if (target.includes('/alerts/documents')) {
          return of({ content: [{ title: 'CNH vence' }], page: 0, size: 20, total: 1 });
        }
        if (target.includes('/insurances')) {
          return of({ content: [{ id: 'i-1', plate: 'ABC1D23' }], page: 0, size: 20, total: 1 });
        }
        return of({
          content: [{ id: 'n-1', title: 'IPVA do ABC1D23 vence' }],
          page: 0,
          size: 10,
          total: 1,
        });
      });

      feed.list().subscribe();
      feed.refreshUnreadCount().subscribe();
      insurances.list().subscribe();
      alerts.listDocumentAlerts().subscribe();
      invites.list().subscribe();
      return { feed, insurances, alerts, invites };
    }

    it('encerrar não deixa nada da empresa observada no contexto do admin', () => {
      const service = build();
      service.start('co-1').subscribe();
      const caches = fillCaches();
      expect(caches.feed.items()).toHaveLength(1);
      expect(caches.feed.unreadCount()).toBe(4);
      expect(caches.invites.invites()).toHaveLength(1);

      // A partir daqui o backend responde pelo contexto do ADMIN: se o
      // contador continuar em 4, o que está na tela é resíduo do cliente.
      unreadFromServer = 1;
      service.end().subscribe();

      expect(service.active()).toBe(false);
      expect(caches.feed.items()).toEqual([]);
      expect(caches.feed.unreadCount()).toBe(1);
      expect(caches.insurances.insurances()).toEqual([]);
      expect(caches.alerts.documentAlerts()).toEqual([]);
      // Convites carregam o e-mail de quem foi convidado — PII do tenant.
      expect(caches.invites.invites()).toEqual([]);
    });

    it('expirar limpa o mesmo tanto que encerrar pelo botão', () => {
      const service = build();
      service.start('co-1').subscribe();
      const caches = fillCaches();

      service.expire();

      expect(caches.feed.items()).toEqual([]);
      expect(caches.invites.invites()).toEqual([]);
      expect(caches.insurances.insurances()).toEqual([]);
      expect(caches.alerts.documentAlerts()).toEqual([]);
    });

    it('ENTRAR também limpa — o admin não vê o próprio cache sob o banner do cliente', () => {
      const service = build();
      const caches = fillCaches();
      expect(caches.feed.items()).toHaveLength(1);

      service.start('co-1').subscribe();

      expect(service.active()).toBe(true);
      expect(caches.feed.items()).toEqual([]);
      expect(caches.insurances.insurances()).toEqual([]);
      expect(caches.alerts.documentAlerts()).toEqual([]);
      expect(caches.invites.invites()).toEqual([]);
    });
  });

  /**
   * O snapshot congelava só as quatro chaves do tenant. Se `getMe()` /
   * `hydrateSession()` rodasse durante a sessão, a identidade do admin era
   * substituída pela do usuário impersonado de forma permanente — e como
   * `SessionService` sincroniza `id`/`email` com o Sentry, os erros seguintes do
   * admin passavam a ser atribuídos ao cliente.
   */
  describe('congelamento da identidade do administrador', () => {
    const ADMIN_IDENTITY: ReadonlyArray<[string, string]> = [
      ['id', 'admin-user-1'],
      ['name', 'Lorran Admin'],
      ['email', 'admin@mycarshub.app.br'],
      ['systemRole', 'PLATFORM_ADMIN'],
      ['onboardingCompleted', 'true'],
    ];

    function seedAdminIdentity(): void {
      for (const [key, value] of ADMIN_IDENTITY) {
        session.setItem(key, value);
      }
    }

    it('congela id/nome/e-mail/papel/onboarding junto com as chaves do tenant', () => {
      seedAdminIdentity();
      const service = build();

      service.start('co-1').subscribe();

      const snapshot = session.getItem(IMPERSONATION_ADMIN_CONTEXT_KEY) ?? '';
      for (const [, value] of ADMIN_IDENTITY) {
        expect(snapshot).toContain(value);
      }
    });

    it('restaura a identidade do admin mesmo se algo a sobrescrever durante a sessão', () => {
      seedAdminIdentity();
      const service = build();
      service.start('co-1').subscribe();

      // É o que `writeSession()` faria se `getMe()` rodasse durante a sessão.
      session.setItem('id', 'cliente-user-9');
      session.setItem('name', 'Dono da Locadora');
      session.setItem('email', 'dono@empresa-cliente.com');
      session.setItem('systemRole', 'USER');
      session.setItem('onboardingCompleted', 'false');

      service.end().subscribe();

      for (const [key, value] of ADMIN_IDENTITY) {
        expect(session.getItem(key)).toBe(value);
      }
    });
  });

  /**
   * A contagem regressiva comparava um instante do SERVIDOR (`expiresAt`) com o
   * relógio do CLIENTE. Num cliente adiantado ou atrasado ela erra por
   * construção, e é ela que comunica ao admin que a janela é curta.
   */
  describe('contagem regressiva com relógio do cliente fora de hora', () => {
    it('desconta o desvio entre os dois relógios', () => {
      vi.useFakeTimers();
      const clientNow = Date.now();
      // O servidor está 5 minutos ADIANTE do cliente.
      const serverNow = clientNow + 5 * 60_000;
      httpPost = vi.fn(() =>
        of({
          ...startResponse(new Date(serverNow + 15 * 60_000).toISOString()),
          startedAt: new Date(serverNow).toISOString(),
        }),
      );
      const service = build();

      service.start('co-1').subscribe();

      // Sem o offset o cálculo cru daria 20 minutos; a sessão tem 15.
      expect(Math.round(service.remainingMs() / 60_000)).toBe(15);
    });
  });

  it('sem token administrativo guardado, derruba a sessão para o login em vez de travar', () => {
    const service = build();
    service.start('co-1').subscribe();
    session.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);

    service.expire();

    expect(service.active()).toBe(false);
    expect(session.getToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });
});
