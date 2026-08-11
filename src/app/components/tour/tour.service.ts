import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { BillingAccessService } from '../../services/billing-access.service';
import { SILENT_HTTP_ERRORS } from '../../services/http-errors.context';
import { IMPERSONATION_STATE_KEY } from '../../services/impersonation.context';
import { LoggerService } from '../../services/logger.service';
import { SessionService } from '../../services/session.service';
import { LayoutStore } from '../core/layouts/layout.store';
import { TOUR_STEPS, TourStep } from './tour.types';

/**
 * Espera pela animação `mobileSlide` do drawer (`sidebar.ts`: 300ms) antes de
 * medir. Medir durante a transição devolve um retângulo fora da tela — o
 * holofote apareceria no lugar errado e "andaria" até o lugar certo.
 */
const DRAWER_ANIMATION_MS = 340;

/**
 * Espera pela animação do acordeão. No desktop com a sidebar recolhida,
 * `onParentClick` (`sidebar.ts`) dispara DUAS transições no mesmo tick —
 * `sidebarWidth` (300ms) e `dropdownSlide` (250ms) —, mas elas correm em
 * PARALELO, não em série: o pior caso é 300ms, não 550ms. A folga até 380ms é
 * para o quadro de layout que vem depois, não para uma soma.
 */
const GROUP_ANIMATION_MS = 380;

/**
 * Direção de percurso. Importa quando um passo é pulado por alvo ausente: quem
 * veio do "Próximo" continua para frente, quem veio do "Voltar" continua para
 * trás — pular na direção errada prenderia o usuário num laço.
 */
type Direction = 1 | -1;

/**
 * Tour ancorado das funcionalidades principais.
 *
 * Nome deliberado: **tour**, nunca "onboarding". `onboarding` já é o wizard
 * obrigatório de cadastro (`pages/onboarding/`, rota `/onboarding`, coluna
 * `onboardings.is_completed`) — outra coisa, com outro ciclo de vida.
 *
 * O serviço é dono do índice, do roteiro filtrado por papel e da persistência.
 * Ele também resolve o ALVO (e não o componente) porque resolver é mais do que
 * um `querySelector`: pode exigir abrir o drawer no mobile e expandir um
 * acordeão, esperando as animações entre uma coisa e outra. Concentrar isso
 * aqui deixa o componente de holofote com uma única responsabilidade — medir e
 * desenhar — e torna a regra "alvo ausente pula o passo" testável sem montar
 * componente nenhum.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly session = inject(SessionService);
  private readonly layout = inject(LayoutStore);
  private readonly access = inject(BillingAccessService);
  private readonly http = inject(HttpClient);
  private readonly logger = inject(LoggerService);

  private readonly _steps = signal<readonly TourStep[]>([]);
  private readonly _index = signal(0);
  private readonly _active = signal(false);
  private readonly _target = signal<HTMLElement | null>(null);
  private readonly _busy = signal(false);

  readonly active = this._active.asReadonly();
  /** Elemento destacado no passo corrente. `null` enquanto o tour resolve o alvo. */
  readonly target = this._target.asReadonly();
  readonly index = this._index.asReadonly();
  /**
   * Há um passo sendo resolvido — pode envolver abrir o drawer e esperar
   * animação. O balão desabilita a navegação enquanto isso: sem essa trava, um
   * segundo toque em "Próximo" durante a espera iniciaria um percurso paralelo
   * que clicaria no acordeão de novo, FECHANDO o grupo que o primeiro abriu.
   */
  readonly busy = this._busy.asReadonly();
  readonly total = computed(() => this._steps().length);
  readonly currentStep = computed<TourStep | null>(() => this._steps()[this._index()] ?? null);
  readonly isFirst = computed(() => this._index() === 0);
  readonly isLast = computed(() => this._index() >= this._steps().length - 1);

  /**
   * O disparo automático é uma vez por vida da aba, e não uma vez por navegação
   * para `/dashboard`: o efeito que chama `maybeAutoStart()` reavalia a cada
   * troca de rota, e sem esta trava o tour renasceria toda vez que o usuário
   * voltasse ao dashboard depois de pular.
   */
  private autoStartAttempted = false;

  /**
   * Estado do drawer ANTES do tour abri-lo. Se o tour abriu, o tour fecha; se o
   * usuário já estava com o menu aberto, deixamos como estava.
   */
  private drawerWasOpen = false;

  /**
   * Algum passo chegou a ser EXIBIDO nesta execução. É o que separa "o usuário
   * viu o tour" de "o tour não conseguiu se montar" — só o primeiro merece
   * gravar `tourSeen`. Ver `settle()`.
   */
  private shownAnyStep = false;

  /**
   * Geração do percurso em voo. Cada `settle()` reserva a sua e desiste assim
   * que outra assume, para dois laços concorrentes não disputarem o índice.
   */
  private settleGeneration = 0;

  /**
   * Um `resize` chegou enquanto um percurso estava em voo.
   *
   * Descartar e esquecer não serve: o alvo é guardado DEPOIS da consulta ao DOM
   * (`resolve()` ainda espera um quadro no meio), então a troca de barra lateral
   * que acontece nessa fresta faz `_target` nascer já morto. O pedido descartado
   * era justamente o único aviso de que isso aconteceu — sem reconsiderá-lo ao
   * fim do percurso, o holofote fica ancorado num nó órfão até o próximo evento,
   * que no celular pode nunca vir (uma rotação = UM `resize`).
   */
  private revalidationPending = false;

  /**
   * Chamado a cada navegação para `/dashboard` pelo `AppShell`.
   *
   * `PLATFORM_ADMIN` fica de fora de propósito, pelo mesmo motivo que já o tira
   * do onboarding (`onboarding.guard.ts`): ele opera acima do modelo de tenant e
   * o roteiro fala de frota, motoristas e aluguéis de UMA empresa. Também não
   * gravamos o flag para ele — se um dia quiser ver, o atalho no Perfil continua
   * valendo.
   *
   * As duas primeiras guardas leem SINAIS e o método é chamado de dentro de um
   * `effect` (`app-shell.ts`): isso é o mecanismo, não um acidente. Enquanto o
   * status de cobrança não chegou, não decidimos nada e não gastamos a
   * tentativa — quando ele chegar, o efeito reavalia e caímos aqui de novo já
   * sabendo a resposta.
   */
  maybeAutoStart(): void {
    if (!this.isBrowser) return;
    if (this.autoStartAttempted) return;

    // Ainda não sabemos se a assinatura está em dia: esperar é obrigatório, e
    // não uma otimização. O paywall de bloqueio duro (`z-[70]`) fica ABAIXO do
    // holofote (`z-[100]`), então um tour disparado antes da resposta cobriria
    // o "Ver planos" por seis passos — justamente as telas que o bloqueio veda.
    if (!this.access.loaded()) return;
    if (this.access.isBlocked()) return;

    this.autoStartAttempted = true;

    // Sessão de impersonação: quem está diante da tela é o admin, mas a
    // credencial ativa é a do CLIENTE. `isPlatformAdmin()` lê o token e devolve
    // `false` — a guarda logo abaixo não enxerga nada de errado —, então o tour
    // dispararia sobre a conta observada e, no "Pular"/"Concluir", gravaria
    // `tourSeen` e chamaria o backend COM O TOKEN DO CLIENTE: ele perderia,
    // para sempre e em silêncio, um tour que nunca viu.
    if (this.isImpersonating()) return;

    // Só sessão ACCESS. O token TEMPORALLY (antes de `/auth/select-company`)
    // vale apenas em `/v1/auth/*`, `/v1/onboarding*` e no fluxo de convite
    // (`JwtAuthFilter` no backend) — `POST /users/me/tour-seen` responde 401
    // para ele, enquanto `GET /auth/me` devolve `hasSeenTour` normalmente. O
    // claim `companyId` existe só no token de empresa: é o que separa os dois.
    if (!this.isAccessSession()) return;

    if (this.session.isPlatformAdmin()) return;
    if (this.session.hasSeenTour()) return;

    void this.start();
  }

  /** Reabre o tour sob demanda (atalho no Perfil), mesmo para quem já viu. */
  restart(): void {
    this.autoStartAttempted = true;
    void this.start();
  }

  async start(): Promise<void> {
    if (!this.isBrowser) return;

    const steps = this.stepsForCurrentRole();
    if (steps.length === 0) return;

    this._steps.set(steps);
    this._index.set(0);
    this._target.set(null);
    this._active.set(true);
    this.shownAnyStep = false;
    this.drawerWasOpen = this.layout.isMobileOpen();

    // Sai da passada de detecção de mudanças ANTES de consultar o DOM.
    //
    // Quem chama é o `effect` do `AppShell`, e um efeito de componente roda
    // DENTRO da detecção de mudanças, antes de a própria view ser atualizada e
    // muito antes de a `app-sidebar` filha renderizar. O `billingAccessGuard`
    // já resolveu `access.loaded()` durante a ativação da rota, então na
    // PRIMEIRA passada o efeito passa direto pelas guardas e `settle()` chega
    // ao `querySelector` de forma síncrona — com a barra lateral ainda vazia.
    // O primeiro passo era pulado por "alvo ausente"; o `await` seguinte
    // deixava a passada terminar, o menu aparecia, e o segundo passo achava a
    // âncora: o tour abria em "2 de 6".
    //
    // Um quadro é o bastante: a passada é síncrona, e o `requestAnimationFrame`
    // pedido lá de dentro só corre depois que ela termina e o DOM está pintado.
    await this.nextFrame();
    if (!this._active()) return;

    await this.settle(0, 1);
  }

  async next(): Promise<void> {
    if (!this._active() || this._busy()) return;
    if (this.isLast()) {
      this.finish();
      return;
    }
    await this.settle(this._index() + 1, 1);
  }

  async back(): Promise<void> {
    if (!this._active() || this._busy() || this.isFirst()) return;
    await this.settle(this._index() - 1, -1);
  }

  /**
   * Confere se o alvo destacado ainda é o elemento vivo, e re-resolve o passo
   * quando não é. Chamado pelo holofote no `resize`.
   *
   * Cruzar os 1024px não redimensiona a barra lateral: o `@if` de
   * `sidebar.html` DESTRÓI um `<aside>` e constrói o outro. A referência
   * guardada vira um nó órfão, cujo `getBoundingClientRect()` devolve tudo
   * zero — um buraco de 12×12px no canto da tela e o balão estacionado ao lado
   * dele. Só reposicionar não resolve; é preciso procurar o alvo de novo.
   *
   * Esta re-resolução NUNCA grava `tourSeen`, mesmo esgotando o roteiro: quem
   * girou o aparelho ou cruzou os 1024px no meio do passo 2 não concluiu coisa
   * alguma. O percurso anda para frente (é a direção natural de leitura), mas
   * o fim da lista aqui significa "a barra lateral ainda não remontou", não
   * "acabou" — daí `persistOnExhaustion: false`.
   */
  async revalidateTarget(): Promise<void> {
    if (!this._active()) return;
    // Percurso em voo: não dá para conferir agora (o alvo definitivo ainda nem
    // foi guardado), mas ESQUECER seria pior — ver `revalidationPending`. Fica
    // anotado e o próprio `settle()` reconsidera ao terminar.
    if (this._busy()) {
      this.revalidationPending = true;
      return;
    }
    if (this._target()?.isConnected) return;
    await this.settle(this._index(), 1, false);
  }

  /**
   * O shell autenticado foi destruído (logout, ou saída para uma rota pública)
   * com o tour ainda aberto.
   *
   * O serviço é `providedIn: 'root'` e sobrevive ao componente: sem isto,
   * `_active`/`_target` ficariam apontando para um DOM que não existe mais e a
   * trava de disparo continuaria gasta — o PRÓXIMO usuário a entrar nesta mesma
   * aba nunca veria o tour. Fecha sem gravar nada: quem não viu não deve ser
   * marcado como quem viu.
   */
  abandon(): void {
    this.settleGeneration++;
    this._busy.set(false);
    this.revalidationPending = false;
    this.close();
    this.autoStartAttempted = false;
  }

  /** "Pular" e "Concluir" têm o MESMO efeito colateral: o usuário não vê de novo. */
  skip(): void {
    this.complete();
  }

  finish(): void {
    this.complete();
  }

  // ---- Internals -------------------------------------------------------

  private stepsForCurrentRole(): readonly TourStep[] {
    const role = this.session.getItem('selectedRole');
    return TOUR_STEPS.filter((step) => !step.roles || (!!role && step.roles.includes(role)));
  }

  /**
   * Avança até um passo cujo alvo exista de fato, andando na direção do
   * percurso. Um item de menu pode não existir por papel (`sidebar.ts` filtra
   * `NAV_ITEMS`), por rota ainda não liberada ou por um `data-tour` renomeado —
   * em todos os casos o tour PULA, nunca quebra nem aponta para o vazio.
   *
   * Esgotar o roteiro tem TRÊS desfechos diferentes, e confundi-los custa caro:
   *
   * - para trás: fica onde está. "Voltar" que não achou nada não é motivo para
   *   encerrar coisa alguma — o passo atual continua perfeitamente válido.
   * - para frente, com algum passo já exibido: o tour acabou de verdade,
   *   grava. Deixar o overlay ativo apontando para `null` é a única falha que o
   *   usuário não conseguiria contornar.
   * - para frente, sem NENHUM passo exibido: fecha SEM gravar. Um aparelho
   *   lento cujo dashboard ainda não pintou faz todos os alvos faltarem; gravar
   *   ali tiraria do usuário, para sempre e em silêncio, um tour que ele nunca
   *   chegou a ver.
   *
   * `persistOnExhaustion: false` derruba o segundo desfecho para o terceiro. É
   * o que a re-resolução do `resize` pede: ali o esgotamento não é um tour que
   * terminou, é uma barra lateral que ainda não voltou ao DOM.
   */
  private async settle(
    from: number,
    direction: Direction,
    persistOnExhaustion = true,
  ): Promise<void> {
    const generation = ++this.settleGeneration;
    const steps = this._steps();
    this._busy.set(true);
    try {
      for (let i = from; i >= 0 && i < steps.length; i += direction) {
        const element = await this.resolve(steps[i]);
        // Usuário pulou durante uma espera de animação, ou um percurso mais
        // novo assumiu (rotação de tela, toque duplo) e este ficou obsoleto.
        if (!this._active() || generation !== this.settleGeneration) return;
        if (element) {
          this._index.set(i);
          this._target.set(element);
          this.shownAnyStep = true;
          return;
        }
        this.logger.warn('[tour] alvo ausente; passo pulado', { key: steps[i].key });
      }

      if (direction === -1) return;
      if (persistOnExhaustion && this.shownAnyStep) {
        this.complete();
        return;
      }
      this.logger.warn('[tour] nenhum alvo alcançável; fechando sem marcar como visto');
      this.close();
    } finally {
      if (generation === this.settleGeneration) {
        this._busy.set(false);
        await this.flushPendingRevalidation();
      }
    }
  }

  /**
   * Atende o `resize` que chegou com o percurso ocupado. A bandeira é baixada
   * ANTES da nova re-resolução: o `settle()` que ela dispara passa por este
   * mesmo `finally`, e reconsiderar um pedido já atendido faria laço.
   */
  private async flushPendingRevalidation(): Promise<void> {
    if (!this.revalidationPending) return;
    this.revalidationPending = false;
    await this.revalidateTarget();
  }

  private async resolve(step: TourStep): Promise<HTMLElement | null> {
    if (!this.isBrowser || !this._active()) return null;

    // No mobile a barra lateral não está no DOM — é estrutural, não CSS. Sem
    // abrir o drawer, TODO passo ancorado no menu seria pulado.
    if (step.inSidebar && this.layout.isMobile() && !this.layout.isMobileOpen()) {
      this.layout.openMobile();
      await this.wait(DRAWER_ANIMATION_MS);
      if (!this._active()) return null;
    }

    let element = this.query(step.key);

    // Só clicamos no grupo quando o filho REALMENTE não está no DOM: o botão do
    // acordeão alterna, então clicar num grupo já aberto o fecharia. E só
    // esperamos a animação quando houve clique — sem o botão (papel que não vê
    // o grupo) não há transição alguma para aguardar.
    //
    // A checagem de `_active` antes do clique não é zelo: quem tocou "Pular"
    // durante a espera do drawer não espera ver o acordeão "Frota" abrir
    // sozinho no menu depois que o balão já sumiu.
    if (!element && step.expandGroup) {
      const group = this.query(step.expandGroup);
      if (group) {
        group.click();
        await this.wait(GROUP_ANIMATION_MS);
        if (!this._active()) return null;
        element = this.query(step.key);
      }
    }

    if (!element) return null;

    this.centre(element);
    await this.nextFrame();
    return this._active() ? element : null;
  }

  /**
   * Traz o alvo para dentro da área visível ANTES de medir.
   *
   * O `<nav>` da barra lateral é scroller próprio (`sidebar.html`: `flex-1
   * min-h-0 overflow-y-auto`), e `getBoundingClientRect()` devolve a posição
   * geométrica mesmo de um item recortado pelo `overflow`. Num celular de 640px
   * de altura os itens de baixo — Alertas, Relatórios — já nascem fora da
   * vista, e o acordeão "Frota" aberto no passo 3 empurra mais 240px. Sem esta
   * rolagem o anel é desenhado fora da tela e o balão fica clampado contra a
   * borda apontando para o nada; e como o overlay engole todo toque, o usuário
   * não consegue rolar o menu para procurar — fica preso até "Pular".
   *
   * `behavior: 'instant'` é obrigatório: um scroll suave ainda estaria em
   * movimento no quadro seguinte, que é exatamente quando medimos.
   * `scrollIntoView` não existe no jsdom nem em navegadores móveis antigos —
   * mesma guarda de `company-settings.ts`.
   */
  private centre(element: HTMLElement): void {
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
  }

  private query(key: string): HTMLElement | null {
    return this.document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Um quadro de layout, para a medição pegar a posição JÁ rolada. */
  private nextFrame(): Promise<void> {
    const view = this.document.defaultView;
    if (!view?.requestAnimationFrame) return this.wait(0);
    return new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
  }

  private complete(): void {
    this.close();
    if (!this.canPersistSeen()) return;
    this.session.setTourSeen(true);
    this.markSeenRemote();
  }

  /**
   * Fechar pode ou não gravar — e as duas condições são sobre a CREDENCIAL, não
   * sobre o usuário na frente da tela.
   *
   * Durante a impersonação o balão pode até ser reaberto pelo atalho do Perfil
   * (ver o produto é o ponto da sessão de suporte), mas o token é o do cliente:
   * gravar marcaria a conta DELE como quem já viu, tanto em `sessionStorage`
   * (que a saída restaura, por `IMPERSONATION_FROZEN_KEYS`) quanto no banco,
   * onde não haveria volta. E o token TEMPORALLY não alcança a rota — ver
   * `maybeAutoStart()`.
   */
  private canPersistSeen(): boolean {
    return !this.isImpersonating() && this.isAccessSession();
  }

  /**
   * Mesma leitura de `LayoutStore.isImpersonating()`: a chave de sessão, não o
   * `ImpersonationService`. Injetá-lo aqui traria o serviço inteiro (Router,
   * caches, toasts) para dentro do tour; `impersonation.context` é folha, e a
   * chave só existe enquanto a sessão existe.
   */
  private isImpersonating(): boolean {
    return this.session.getItem(IMPERSONATION_STATE_KEY) !== null;
  }

  /** Token de empresa (ACCESS), o único que alcança `/users/me/tour-seen`. */
  private isAccessSession(): boolean {
    return this.session.getCompanyIdFromToken() !== null;
  }

  private close(): void {
    this._active.set(false);
    this._target.set(null);
    if (this.layout.isMobile() && !this.drawerWasOpen) {
      this.layout.closeMobile();
    }
  }

  /**
   * Único ponto de contato com o backend — trocar o contrato mexe só aqui.
   *
   * A gravação local já aconteceu ANTES desta chamada, e é ela que decide se o
   * tour reabre. A rede falhando não pode travar a interface nem devolver o
   * balão à cara de quem acabou de fechá-lo, então o erro é engolido com log.
   *
   * `SILENT_HTTP_ERRORS` é obrigatório, e reivindicar o erro no
   * `ApiErrorService` não bastava: aquilo desarma só a rede de segurança de
   * 4xx. Status 0 e 5xx o `errorInterceptor` toasta ele mesmo, sem consultar
   * ninguém — quem tocasse "Concluir" no metrô veria o balão fechar e subir
   * "Sem conexão com o servidor.", acusado de um erro numa chamada que ele nem
   * pediu. A marca tira a requisição inteira da política genérica; o log aqui
   * é o único tratamento que ela precisa.
   */
  private markSeenRemote(): void {
    if (!this.isBrowser) return;
    this.http
      .post<void>(
        `${environment.apiUrl}/users/me/tour-seen`,
        {},
        { context: new HttpContext().set(SILENT_HTTP_ERRORS, true) },
      )
      .subscribe({
        error: (error: unknown) => {
          this.logger.warn('[tour] não foi possível registrar tour-seen no backend', { error });
        },
      });
  }
}
