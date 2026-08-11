import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { BillingAccessService } from '../../services/billing-access.service';
import { SILENT_HTTP_ERRORS } from '../../services/http-errors.context';
import { IMPERSONATION_STATE_KEY } from '../../services/impersonation.context';
import { LoggerService } from '../../services/logger.service';
import { SessionService } from '../../services/session.service';
import { LayoutStore } from '../core/layouts/layout.store';
import { TourService } from './tour.service';
import { TOUR_ANCHORS } from './tour.types';

const TOUR_SEEN_URL = `${environment.apiUrl}/users/me/tour-seen`;

/**
 * Dublê do `LayoutStore`: o real puxa Router, feed de notificações, seleção de
 * empresa e toasts para resolver duas coisas que o tour usa — se a viewport é
 * mobile e se o drawer está aberto. O dublê expõe exatamente essa superfície e
 * permite que o teste simule o efeito estrutural que importa: no mobile os
 * itens de menu só EXISTEM no DOM depois que o drawer abre.
 */
function makeLayoutStub(onOpen?: () => void) {
  const isMobile = signal(false);
  const isMobileOpen = signal(false);
  return {
    isMobile,
    isMobileOpen,
    openMobile: () => {
      isMobileOpen.set(true);
      onOpen?.();
    },
    closeMobile: () => isMobileOpen.set(false),
  };
}

/**
 * Dublê do `BillingAccessService`. Só duas leituras interessam ao tour: se a
 * resposta de acesso já chegou e se a empresa está bloqueada — o paywall de
 * bloqueio duro não pode ficar embaixo do holofote.
 */
function makeAccessStub() {
  return { loaded: signal(true), isBlocked: signal(false) };
}

/**
 * JWT sem assinatura válida — o `SessionService` só decodifica o payload, e é
 * dele que saem `companyId` (token ACCESS de empresa) e `system_role`. Um token
 * TEMPORALLY é o MESMO payload sem `companyId`: é essa ausência que o tour usa
 * para não tocar em `/users/me/tour-seen`, que responde 401 para ele.
 */
function jwt(payload: Record<string, unknown>): string {
  const segment = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment(payload)}.assinatura`;
}

const ACCESS_TOKEN = jwt({
  sub: 'user-1',
  system_role: 'USER',
  accessType: 'ACCESS',
  companyId: 'company-1',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const TEMPORALLY_TOKEN = jwt({
  sub: 'user-1',
  system_role: 'USER',
  accessType: 'TEMPORALLY',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

function anchor(key: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.setAttribute('data-tour', key);
  el.scrollIntoView = vi.fn(); // jsdom não implementa
  document.body.appendChild(el);
  return el;
}

describe('TourService', () => {
  let service: TourService;
  let session: SessionService;
  let http: HttpTestingController;
  let layout: ReturnType<typeof makeLayoutStub>;
  let access: ReturnType<typeof makeAccessStub>;

  function configure(layoutStub = makeLayoutStub()): void {
    layout = layoutStub;
    access = makeAccessStub();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        TourService,
        SessionService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LayoutStore, useValue: layout },
        { provide: BillingAccessService, useValue: access },
        { provide: LoggerService, useValue: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
      ],
    });
    service = TestBed.inject(TourService);
    session = TestBed.inject(SessionService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
    configure();
    session.setItem('selectedRole', 'OWNER');
    session.setToken(ACCESS_TOKEN);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  // ---- Disparo --------------------------------------------------------

  it('dispara quando o usuário ainda não viu o tour', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    service.maybeAutoStart();
    await vi.waitFor(() => expect(service.active()).toBe(true));

    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.dashboard);
  });

  it('NÃO dispara para quem já viu o tour', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    session.setTourSeen(true);

    service.maybeAutoStart();
    await Promise.resolve();

    expect(service.active()).toBe(false);
  });

  it('NÃO dispara para PLATFORM_ADMIN — o roteiro fala de uma empresa que ele não tem', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    vi.spyOn(session, 'isPlatformAdmin').mockReturnValue(true);

    service.maybeAutoStart();
    await Promise.resolve();

    expect(service.active()).toBe(false);
    // E não grava o flag: o atalho do Perfil continua valendo para ele.
    expect(session.hasSeenTour()).toBe(false);
  });

  it('só tenta disparar uma vez por aba, mesmo voltando ao dashboard', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    service.maybeAutoStart();
    await vi.waitFor(() => expect(service.active()).toBe(true));
    service.skip();
    http.expectOne(TOUR_SEEN_URL).flush(null);

    service.maybeAutoStart();
    await Promise.resolve();

    expect(service.active()).toBe(false);
  });

  it('NÃO dispara com a assinatura bloqueada — o paywall ficaria EMBAIXO do holofote', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    access.isBlocked.set(true);

    service.maybeAutoStart();
    await Promise.resolve();

    expect(service.active()).toBe(false);
    // E não gasta a tentativa: quem regularizar a assinatura nesta mesma aba
    // ainda merece ver o tour.
    expect(session.hasSeenTour()).toBe(false);
  });

  it('espera a resposta de acesso antes de decidir, sem gastar a tentativa', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    access.loaded.set(false);

    service.maybeAutoStart();
    await Promise.resolve();
    expect(service.active()).toBe(false);

    // O efeito do AppShell reavalia quando o status chega.
    access.loaded.set(true);
    service.maybeAutoStart();

    await vi.waitFor(() => expect(service.active()).toBe(true));
  });

  // ---- Impersonação ---------------------------------------------------

  /**
   * Durante a sessão de suporte a credencial ativa é a do CLIENTE — o admin é
   * quem olha, mas não é quem o backend enxerga. `isPlatformAdmin()` lê o token
   * e devolve `false`, então nenhuma das outras guardas barra: sem esta, o tour
   * dispara sobre a conta observada e o "Pular" grava `tourSeen` no cliente,
   * local e remotamente, tirando dele um tour que nunca viu.
   */
  describe('sessão de impersonação', () => {
    function startImpersonation(): void {
      session.setItem(
        IMPERSONATION_STATE_KEY,
        JSON.stringify({ sessionId: 's-1', companyId: 'company-9' }),
      );
    }

    it('NÃO dispara automaticamente', async () => {
      anchor(TOUR_ANCHORS.dashboard);
      startImpersonation();

      service.maybeAutoStart();
      await Promise.resolve();

      expect(service.active()).toBe(false);
      expect(session.hasSeenTour()).toBe(false);
    });

    /**
     * O atalho do Perfil continua abrindo o balão — ver o produto é o ponto da
     * sessão de suporte. O que ele não pode é MARCAR: nem em `sessionStorage`
     * (restaurado na saída, por `IMPERSONATION_FROZEN_KEYS`) nem no banco, onde
     * não haveria volta.
     */
    it('o atalho manual abre, mas fechar não grava nada — nem local, nem no backend', async () => {
      anchor(TOUR_ANCHORS.dashboard);
      startImpersonation();

      service.restart();
      await vi.waitFor(() => expect(service.active()).toBe(true));
      service.finish();

      expect(service.active()).toBe(false);
      expect(session.hasSeenTour()).toBe(false);
      // Nenhuma requisição pendente: o `http.verify()` do afterEach cobre o resto.
      http.expectNone(TOUR_SEEN_URL);
    });
  });

  // ---- Sessão TEMPORALLY ----------------------------------------------

  /**
   * O token TEMPORALLY (antes de `/auth/select-company`) só vale em
   * `/v1/auth/*`, `/v1/onboarding*` e no fluxo de convite — `JwtAuthFilter`
   * responde 401 em qualquer outra rota, inclusive `POST /users/me/tour-seen`.
   * `GET /auth/me` devolve `hasSeenTour` sob o mesmo token, então nada avisaria
   * o frontend: o tour subiria e, ao fechar, o 401 seguiria para o
   * `errorInterceptor`. O claim `companyId` é o que separa os dois tokens.
   */
  it('NÃO dispara sob um token TEMPORALLY — o registro do fim responderia 401', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    session.setToken(TEMPORALLY_TOKEN);

    service.maybeAutoStart();
    await Promise.resolve();

    expect(service.active()).toBe(false);
    expect(session.hasSeenTour()).toBe(false);
  });

  // ---- Alvo dentro do scroller da barra lateral -----------------------

  /**
   * O `<nav>` é scroller próprio (`sidebar.html`: `flex-1 min-h-0
   * overflow-y-auto`) e `getBoundingClientRect()` devolve a posição geométrica
   * mesmo de um item recortado pelo `overflow`. Sem rolar antes de medir, o
   * anel do passo "Alertas" é desenhado fora da tela num celular de 640px — e
   * como o overlay engole todo toque, o usuário não consegue rolar o menu para
   * procurar.
   */
  it('rola o alvo para dentro da vista antes de medir', async () => {
    const dashboard = anchor(TOUR_ANCHORS.dashboard);

    await service.start();

    expect(dashboard.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    );
  });

  it('rola a cada passo, não só no primeiro', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    const alerts = anchor(TOUR_ANCHORS.alerts);

    await service.start();
    await service.next();

    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.alerts);
    expect(alerts.scrollIntoView).toHaveBeenCalledOnce();
  });

  it('navegador sem scrollIntoView não derruba o tour', async () => {
    const dashboard = anchor(TOUR_ANCHORS.dashboard);
    Reflect.deleteProperty(dashboard, 'scrollIntoView');

    await service.start();

    expect(service.active()).toBe(true);
    expect(service.target()).toBe(dashboard);
  });

  // ---- Troca de breakpoint --------------------------------------------

  /**
   * Cruzar 1024px não redimensiona a barra: o `@if` de `sidebar.html` destrói
   * um `<aside>` e constrói o outro. Só reposicionar mediria um nó órfão —
   * tudo zero, um buraco de 12×12px no canto.
   */
  it('re-resolve o alvo quando o elemento guardado saiu do DOM', async () => {
    const first = anchor(TOUR_ANCHORS.dashboard);
    await service.start();
    expect(service.target()).toBe(first);

    first.remove();
    const rebuilt = anchor(TOUR_ANCHORS.dashboard);

    await service.revalidateTarget();

    expect(service.target()).toBe(rebuilt);
    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.dashboard);
  });

  /**
   * O caminho do `resize` anda para frente, e antes disso o esgotamento caía em
   * `complete()`: girar um celular lento no passo 2 fechava o tour E gravava
   * `tourSeen` para sempre, sem o usuário ter chegado ao fim. Fechar sem gravar
   * é a única saída honesta — quando a barra lateral remontar, o tour ainda
   * está disponível.
   */
  it('re-resolver sem achar nada fecha SEM marcar como visto', async () => {
    const dashboard = anchor(TOUR_ANCHORS.dashboard);
    await service.start();
    expect(service.target()).toBe(dashboard);

    // A barra lateral inteira saiu do DOM (troca de breakpoint) e ainda não
    // voltou: nenhum alvo do roteiro existe neste instante.
    dashboard.remove();
    await service.revalidateTarget();

    expect(service.active()).toBe(false);
    expect(session.hasSeenTour()).toBe(false);
    http.expectNone(TOUR_SEEN_URL);
  });

  it('não mexe em nada quando o alvo continua vivo', async () => {
    const dashboard = anchor(TOUR_ANCHORS.dashboard);
    await service.start();
    vi.mocked(dashboard.scrollIntoView).mockClear();

    await service.revalidateTarget();

    expect(service.target()).toBe(dashboard);
    expect(dashboard.scrollIntoView).not.toHaveBeenCalled();
  });

  // ---- Alvo ausente ---------------------------------------------------

  it('pula o passo cujo alvo não está no DOM em vez de quebrar', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    anchor(TOUR_ANCHORS.drivers);

    await service.start();
    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.dashboard);

    // Aluguéis e Veículos não existem: o tour salta os dois de uma vez.
    await service.next();

    expect(service.active()).toBe(true);
    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.drivers);
  });

  it('pula para trás na direção do percurso quando o alvo anterior sumiu', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    const drivers = anchor(TOUR_ANCHORS.drivers);
    anchor(TOUR_ANCHORS.alerts);

    await service.start();
    await service.next();
    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.drivers);
    await service.next();
    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.alerts);

    drivers.remove();
    await service.back();

    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.dashboard);
  });

  it('encerra como concluído quando nenhum alvo restante é alcançável', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    await service.start();
    await service.next();

    expect(service.active()).toBe(false);
    expect(session.hasSeenTour()).toBe(true);
    http.expectOne(TOUR_SEEN_URL).flush(null);
  });

  // ---- Persistência ---------------------------------------------------

  it('concluir grava o flag na sessão e avisa o backend', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    await service.start();
    service.finish();

    expect(session.hasSeenTour()).toBe(true);
    expect(service.active()).toBe(false);

    const req = http.expectOne(TOUR_SEEN_URL);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('pular grava o flag na sessão e avisa o backend', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    await service.start();
    service.skip();

    expect(session.hasSeenTour()).toBe(true);
    expect(service.active()).toBe(false);
    http.expectOne(TOUR_SEEN_URL).flush(null);
  });

  it('sucesso é 204 sem corpo — o serviço não presume payload de resposta', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    await service.start();
    service.finish();

    const req = http.expectOne(TOUR_SEEN_URL);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(session.hasSeenTour()).toBe(true);
    expect(service.active()).toBe(false);
  });

  /**
   * A API devolve **403**, não 401, para requisição sem autenticação: o projeto
   * não registra `authenticationEntryPoint` e o Spring cai no padrão. Vale para
   * todo endpoint protegido, não só este — mas é aqui que não pode estragar o
   * último passo do tour.
   */
  it('403 (padrão do backend para não autenticado) não reabre o tour', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    await service.start();
    service.finish();

    http
      .expectOne(TOUR_SEEN_URL)
      .flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(service.active()).toBe(false);
    expect(session.hasSeenTour()).toBe(true);
  });

  it('404 (frontend adiante do backend) não reabre o tour nem trava a interface', async () => {
    anchor(TOUR_ANCHORS.dashboard);

    await service.start();
    service.finish();

    http
      .expectOne(TOUR_SEEN_URL)
      .flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });

    expect(service.active()).toBe(false);
    expect(session.hasSeenTour()).toBe(true);
  });

  // ---- Papéis ---------------------------------------------------------

  it('filtra o roteiro por papel — MANAGER não vê o passo de Relatórios', async () => {
    session.setItem('selectedRole', 'MANAGER');
    Object.values(TOUR_ANCHORS).forEach((key) => anchor(key));

    await service.start();

    expect(service.total()).toBe(5);
    const keys: string[] = [];
    while (!service.isLast()) {
      keys.push(service.currentStep()!.key);
      await service.next();
    }
    keys.push(service.currentStep()!.key);

    expect(keys).not.toContain(TOUR_ANCHORS.reports);
    expect(keys).toContain(TOUR_ANCHORS.alerts);
  });

  // ---- Mobile ---------------------------------------------------------

  it('no mobile abre o drawer para alcançar um alvo que só existe depois disso', async () => {
    // A sidebar mobile não está no DOM até o drawer abrir — é estrutural.
    configure(makeLayoutStub(() => anchor(TOUR_ANCHORS.dashboard)));
    session.setItem('selectedRole', 'OWNER');
    layout.isMobile.set(true);

    vi.useFakeTimers();
    const started = service.start();
    await vi.advanceTimersByTimeAsync(500);
    await started;

    expect(layout.isMobileOpen()).toBe(true);
    expect(service.active()).toBe(true);
    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.dashboard);
  });

  it('devolve o drawer ao estado em que o encontrou ao terminar', async () => {
    configure(makeLayoutStub(() => anchor(TOUR_ANCHORS.dashboard)));
    session.setItem('selectedRole', 'OWNER');
    layout.isMobile.set(true);

    vi.useFakeTimers();
    const started = service.start();
    await vi.advanceTimersByTimeAsync(500);
    await started;
    vi.useRealTimers();

    service.finish();

    expect(layout.isMobileOpen()).toBe(false);
    http.expectOne(TOUR_SEEN_URL).flush(null);
  });

  it('abre o acordeão fechado quando o alvo é filho dele', async () => {
    anchor(TOUR_ANCHORS.dashboard);
    anchor(TOUR_ANCHORS.rentals);
    const group = anchor(TOUR_ANCHORS.fleetGroup);
    // O filho só entra no DOM quando o grupo é acionado — igual ao acordeão real.
    group.addEventListener('click', () => anchor(TOUR_ANCHORS.vehicles));

    vi.useFakeTimers();
    const started = service.start();
    await vi.advanceTimersByTimeAsync(500);
    await started;
    const advanced = service.next().then(() => service.next());
    await vi.advanceTimersByTimeAsync(500);
    await advanced;

    expect(service.currentStep()?.key).toBe(TOUR_ANCHORS.vehicles);
    expect(document.querySelector(`[data-tour="${TOUR_ANCHORS.vehicles}"]`)).not.toBeNull();
  });
});
