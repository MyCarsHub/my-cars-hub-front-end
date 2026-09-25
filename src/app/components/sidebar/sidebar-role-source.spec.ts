import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  RouterStateSnapshot,
  Routes,
  provideRouter,
} from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Sidebar } from './sidebar';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { routes as APP_ROUTES } from '../../app.routes';

/**
 * FIX-0456 — o menu e o `roleGuard` precisam decidir pelo MESMO papel.
 *
 * >>> ESTE ARQUIVO TESTA IGUALDADE, NÃO VALOR. <<<
 *
 * "o menu mostra Aluguéis para OWNER" passa mesmo com as duas fontes
 * divergindo, porque no uso normal elas coincidem — e é exatamente por isso
 * que o defeito sobreviveu ao FIX-0363, que moveu o guard para o token e
 * deixou o menu no espelho do `sessionStorage`.
 *
 * Então aqui as duas fontes são postas para DISCORDAR de propósito — espelho
 * diz uma coisa, token diz outra — e a afirmação é sobre as DUAS PONTAS: toda
 * rota que o menu oferece tem de ser aceita pelo guard de verdade, lido de
 * `app.routes.ts`. Enquanto as fontes concordam, esta igualdade é invisível.
 * Quando divergem, é a única coisa que fala.
 */
describe('Sidebar — o papel do menu vem da MESMA fonte do roleGuard', () => {
  @Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
  class StubPage {}

  /** Um JWT de mentira: só o payload importa, nada verifica a assinatura aqui. */
  function fakeToken(role: string): string {
    const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${b64}.signature`;
  }

  const tenant = (role: string): Tenant => ({
    id: 't-1',
    name: 'Locadora Alpha',
    role,
    initial: 'L',
  });

  /**
   * Caminho completo -> `canActivate` da própria rota, lido da árvore real.
   *
   * Só o `canActivate` da rota, e não o `canActivateChild` herdado do pai: para
   * toda rota que o menu oferece a um não-PLATFORM_ADMIN, o `canActivate`
   * próprio é exatamente o `roleGuard` (ou nada). Os herdados
   * (`onboardingGuard`, `billingAccessGuard`, `firstVehicleGuard`) são outra
   * pergunta e não é a que este arquivo faz.
   */
  function collectGuards(
    list: Routes,
    prefix: string,
    into: Map<string, CanActivateFn[]>,
  ): Map<string, CanActivateFn[]> {
    for (const route of list as Route[]) {
      const segment = route.path ?? '';
      const full = segment ? `${prefix}/${segment}` : prefix;
      if (segment || route.canActivate) {
        into.set(full === '' ? '/' : full, (route.canActivate ?? []) as CanActivateFn[]);
      }
      if (route.children) collectGuards(route.children, full, into);
    }
    return into;
  }

  const GUARDS_BY_PATH = collectGuards(APP_ROUTES, '', new Map());

  /** Roda os guards reais da rota no contexto de injeção do TestBed. */
  function guardAdmits(path: string): boolean {
    const guards = GUARDS_BY_PATH.get(path);
    // Rota sem guard próprio: aberta a todo membro autenticado.
    if (!guards || guards.length === 0) return true;
    return TestBed.runInInjectionContext(() =>
      guards.every((guard) => {
        const result = guard(
          {} as unknown as ActivatedRouteSnapshot,
          {} as unknown as RouterStateSnapshot,
        );
        return result === true;
      }),
    );
  }

  /** Rotas que o menu efetivamente oferece, grupos achatados. */
  interface MenuItemView {
    route?: string;
    children?: MenuItemView[];
  }

  function menuOf(fixture: { componentInstance: unknown }): {
    navItems: () => MenuItemView[];
    bottomNavItems: () => MenuItemView[];
  } {
    return fixture.componentInstance as {
      navItems: () => MenuItemView[];
      bottomNavItems: () => MenuItemView[];
    };
  }

  function offeredRoutes(): string[] {
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    const menu = menuOf(fixture);
    return [...menu.navItems(), ...menu.bottomNavItems()].flatMap((item: MenuItemView) => [
      ...(item.route ? [item.route] : []),
      ...(item.children ?? [])
        .map((child: MenuItemView) => child.route)
        .filter((route): route is string => !!route),
    ]);
  }

  /**
   * Espelho e token DISCORDAM de propósito. O espelho recebe sempre o papel
   * mais poderoso, porque é a direção que causa dano: menu generoso, guard
   * severo, pessoa que toca e cai no dashboard sem explicação.
   */
  function seedDivergentSession(tokenRole: string, mirrorRole = 'OWNER'): void {
    sessionStorage.setItem('token', fakeToken(tokenRole));
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideRouter([{ path: '**', component: StubPage }]),
        provideNoopAnimations(),
      ],
    });
    const layout = TestBed.inject(LayoutStore);
    layout.tenants.set([tenant(mirrorRole)]);
    layout.selectedTenant.set(tenant(mirrorRole));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  // ------------------------------------------------- a leitura da árvore real
  it('leu a árvore de rotas de verdade (senão todo o resto passaria a vazio)', () => {
    // Sem esta âncora, um `collectGuards` que devolvesse um mapa vazio faria
    // `guardAdmits` responder `true` para tudo e os testes abaixo passariam
    // sem verificar nada. Colheita vazia que PASSA é o defeito que este
    // arquivo inteiro existe para não repetir.
    expect(GUARDS_BY_PATH.get('/alugueis')?.length).toBe(1);
    expect(GUARDS_BY_PATH.get('/billing')?.length).toBe(1);
    expect(GUARDS_BY_PATH.get('/veiculos')?.length).toBe(1);
    expect(GUARDS_BY_PATH.has('/dashboard')).toBe(true);
  });

  // ----------------------------------------------------- IGUALDADE DAS PONTAS
  /**
   * O espelho recebe SEMPRE um papel diferente do token, e nas duas direções:
   * mais poderoso (menu generoso demais → rebote) e menos poderoso (menu
   * mesquinho demais → poder que a pessoa tem e não encontra). Um caso em que
   * as duas fontes coincidissem não afirmaria nada sobre qual delas decide.
   *
   * `mustOffer` fecha a segunda direção: sem ele, um menu que tratasse todo
   * mundo como motorista passaria — ele nunca oferece rota recusada.
   */
  /*
   * FEAT-0108, 2026-09-25 — a sonda mudou, o invariante NAO. O que se afirma
   * aqui continua sendo "TOKEN VENCE ESPELHO".
   *
   * `/dashboard` era a sonda de "o menu nao encolheu" porque era o unico item
   * SEM trava de papel: aparecia para todos, inclusive para o papel do espelho.
   * A casca do motorista poe `roles` nele, entao ele deixou de discriminar
   * qualquer coisa. Sonda que nao discrimina nao defende invariante.
   *
   * `mustNotOffer` e a metade que faz a sonda FALHAR se o espelho vencer: com
   * token DRIVER e espelho OWNER, um menu lido do espelho ofereceria `/billing`.
   * Sem essa metade, um menu generoso demais passaria.
   */
  const CASES = [
    { tokenRole: 'DRIVER', mirrorRole: 'OWNER', mustOffer: '/alugueis', mustNotOffer: '/billing' },
    { tokenRole: 'MANAGER', mirrorRole: 'DRIVER', mustOffer: '/veiculos', mustNotOffer: '/billing' },
    { tokenRole: 'OWNER', mirrorRole: 'DRIVER', mustOffer: '/billing', mustNotOffer: null },
  ] as const;

  it.each(CASES)(
    'IGUALDADE: token $tokenRole + espelho $mirrorRole — nenhuma rota do menu é recusada pelo guard, oferece $mustOffer e não oferece $mustNotOffer',
    ({ tokenRole, mirrorRole, mustOffer, mustNotOffer }) => {
      seedDivergentSession(tokenRole, mirrorRole);

      const offered = offeredRoutes();
      const bounced = offered.filter((route) => !guardAdmits(route));

      // Ponta 1 — nada do que o menu oferece quica no guard.
      expect(bounced).toEqual([]);
      // Ponta 2 — e o menu não encolheu: o papel do TOKEN manda nas duas vias.
      expect(offered).toContain(mustOffer);
      // Ponta 3 — e não CRESCEU para o papel do espelho. É esta que fica
      // vermelha se alguém voltar a ler `selectedTenant().role`.
      if (mustNotOffer) {
        expect(offered).not.toContain(mustNotOffer);
      }
    },
  );

  /**
   * A direção contrária — toda rota que o guard aceita aparece no menu — NÃO é
   * afirmada aqui de propósito. Ela falharia hoje em `/relatorios`, que o menu
   * restringe a OWNER enquanto a rota aceita OWNER e MANAGER. Um dos dois está
   * errado e só o dono decide qual; a direção é inofensiva (não há rebote).
   */

  // --------------------------------------------- o espelho perde para o token
  it('o espelho NÃO decide: token DRIVER + espelho OWNER dá o menu de motorista', () => {
    seedDivergentSession('DRIVER');

    const offered = offeredRoutes();

    // Se o menu voltar a ler `selectedTenant().role`, estas invertem.
    // FEAT-0108, 2026-09-25 — o menu do motorista passou a ter forma PROPRIA:
    // `/alugueis` entrou (e a casa dele) e `/dashboard` saiu (a API responde 403
    // para esse papel). Antes desta data o motorista nao tinha portal nenhum, e
    // a ausencia de `/alugueis` descrevia essa ausencia, nao uma regra.
    expect(offered).toContain('/alugueis');
    expect(offered).not.toContain('/veiculos');
    expect(offered).not.toContain('/dashboard');
    expect(offered).toContain('/perfil');
  });

  it('token ausente não vira permissão por omissão — mesmo com o espelho em OWNER', () => {
    // Mesma regra do guard (`role.guard.ts`): papel desconhecido NEGA.
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideRouter([{ path: '**', component: StubPage }]),
        provideNoopAnimations(),
      ],
    });
    const layout = TestBed.inject(LayoutStore);
    layout.selectedTenant.set(tenant('OWNER'));

    const offered = offeredRoutes();

    // FEAT-0108, 2026-09-25 — INVERSAO DELIBERADA, e o nome do teste sempre quis
    // dizer isto. A assercao antiga afirmava que a shell SEM TOKEN ainda oferecia
    // `/dashboard`, o unico item que nao tinha trava de papel. Mas menu oferecido
    // sem token e menu cujos itens levam todos a 403 ou ao redirect de login:
    // mostra-lo revela a ESTRUTURA do produto a quem nao autenticou e promete
    // navegacao que nao existe. Ausencia de papel virava permissao na forma mais
    // benigna possivel — um item de menu —, e foi por isso que passou batido.
    // NAO "restaure" o comportamento antigo achando que conserta regressao.
    expect(offered).not.toContain('/alugueis');
    expect(offered).not.toContain('/billing');
    expect(offered).not.toContain('/dashboard');
  });

  // ------------------------------------------------ a troca de empresa reavalia
  it('trocar de empresa reavalia o menu — o sinal do tenant é o gatilho', () => {
    seedDivergentSession('DRIVER');
    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    const menu = menuOf(fixture);
    // A sonda saiu de `/alugueis` para `/dashboard`: o motorista passou a TER
    // `/alugueis`, entao ele nao distingue mais os dois papeis, enquanto
    // `/dashboard` passou a distinguir exatamente por ter ganhado trava de papel.
    // (`/veiculos` nao serve aqui: e filho de grupo, e este teste le so os itens
    // de primeiro nivel.) O mecanismo sob teste — o menu reavalia quando o sinal
    // do tenant muda — e o mesmo de antes.
    expect(menu.navItems().map((item) => item.route)).not.toContain('/dashboard');

    // É a ordem real do `layout.store.ts`: o token novo chega ANTES de o
    // tenant ser gravado. Um menu que só olhasse o token, sem depender do
    // sinal, ficaria congelado no papel anterior.
    sessionStorage.setItem('token', fakeToken('OWNER'));
    TestBed.inject(LayoutStore).selectedTenant.set({ ...tenant('OWNER'), id: 't-2' });
    fixture.detectChanges();

    expect(menu.navItems().map((item) => item.route)).toContain('/dashboard');
  });

  it('a sessão de verdade não diverge: espelho e token concordando dão o mesmo menu', () => {
    seedDivergentSession('MANAGER', 'MANAGER');

    const offered = offeredRoutes();
    const bounced = offered.filter((route) => !guardAdmits(route));

    expect(bounced).toEqual([]);
    expect(offered).toContain('/alugueis');
    expect(offered).not.toContain('/billing');
  });
});
