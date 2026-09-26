import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { routes } from '../../app.routes';
import { SessionService } from '../../services/session.service';
import { isRoleGuard } from '../../services/role.guard';
import { NAV_ITEMS, NavItem } from './sidebar';

/**
 * FIX-0607 · FEAT-0228 — o menu e os guards de rota como UM contrato.
 *
 * O defeito que originou este arquivo: `/relatorios` aparecia no nav com
 * `roles: ['OWNER']` enquanto a rota rodava `roleGuard(['OWNER', 'MANAGER'])`.
 * Nem erro nem 403 — o gerente TINHA a permissao e simplesmente nao via o item.
 * So chegaria digitando a URL, e nada no produto dizia que a tela existia.
 * Divergencia silenciosa nos dois sentidos:
 *
 * - nav mostra / guard nega  → link que bate na cara de quem clica;
 * - nav esconde / guard deixa → funcionalidade paga e invisivel (o caso real).
 *
 * Por isso a asercao e IGUALDADE, nunca "o nav e um subconjunto". Um teste que
 * so proibisse o primeiro sentido teria passado verde sobre o FIX-0607 inteiro.
 *
 * ## Por que executa os guards
 *
 * Comparar `item.roles` com `guard.allowedRoles` por inspecao provaria que dois
 * arrays casam — nao que o COMPORTAMENTO casa. Aqui cada guard roda de verdade,
 * com um JWT real na sessao, exatamente como `app.routes.roles.spec.ts` faz. O
 * metadado `allowedRoles` serve so para LOCALIZAR quais `canActivate` filtram
 * papel: `authGuard`/`onboardingGuard`/`billingAccessGuard` negam por motivos
 * que nada tem a ver com papel e fabricariam divergencia falsa.
 *
 * ## Cobertura de ancestrais
 *
 * A permissao real de `/configuracoes/convites` e a conjuncao dos guards de
 * papel de TODA a cadeia — o do proprio no e o do pai `/configuracoes`. Um pai
 * OWNER-only com filho OWNER+MANAGER nao da acesso ao gerente, e o nav nao pode
 * prometer que da.
 */

/** Todo papel de empresa que o produto emite — o dominio que o teste varre. */
const ROLES = ['OWNER', 'MANAGER', 'DRIVER'] as const;

interface GuardAtPath {
  readonly path: string;
  readonly guard: CanActivateFn;
}

/** Guards de papel da arvore inteira, com o path absoluto acumulado. */
function collectRoleGuards(list: readonly Route[], prefix: string): GuardAtPath[] {
  return list.flatMap((route) => {
    const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
    const own = [...(route.canActivate ?? []), ...(route.canActivateChild ?? [])]
      .filter(isRoleGuard)
      .map((guard) => ({ path: `/${path}`, guard: guard as CanActivateFn }));
    return [...own, ...collectRoleGuards(route.children ?? [], path)];
  });
}

/** Casa por fronteira de segmento: `/billing-x` nao esta sob `/billing`. */
const covers = (guardPath: string, navRoute: string): boolean =>
  guardPath === navRoute || navRoute.startsWith(`${guardPath}/`) || guardPath === '/';

/** Achata o nav (pais + filhos) nos itens que apontam para uma rota. */
function flattenNav(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [
    ...(item.route ? [item] : []),
    ...flattenNav(item.children ?? []),
  ]);
}

describe('paridade nav x guard de rota', () => {
  let roleGuards: GuardAtPath[];

  beforeEach(() => {
    roleGuards = collectRoleGuards(routes, '');
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), SessionService],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  const encodePayload = (payload: Record<string, unknown>): string =>
    btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  /** JWT com o claim `role`, na forma que o backend emite. */
  const tokenWithRole = (role: string): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload({ role })}.sig`;

  /** O nav OFERECE este item a este papel? (mesma regra de `allowedItems`.) */
  const navShows = (item: NavItem, role: string): boolean =>
    !item.roles || item.roles.includes(role);

  /** Os guards da cadeia DEIXAM este papel entrar nesta rota? */
  function guardAllows(navRoute: string, role: string): boolean {
    sessionStorage.setItem('token', tokenWithRole(role));
    const chain = roleGuards.filter(({ path }) => covers(path, navRoute));

    return chain.every(({ guard }) => {
      const result = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as boolean | UrlTree;
      return result === true;
    });
  }

  const navRoutes = flattenNav(NAV_ITEMS).filter((item) => !item.requiresPlatformAdmin);

  it('o nav nao esta vazio (guarda contra um teste que varre zero itens)', () => {
    expect(navRoutes.length).toBeGreaterThan(10);
  });

  /**
   * O coracao do FIX-0607. Falha nos DOIS sentidos, e a mensagem diz qual:
   * quem voltar a mexer em `roles:` sem mexer no `roleGuard` (ou o contrario)
   * quebra aqui, em vez de virar um no de backlog seis meses depois.
   */
  for (const role of ROLES) {
    it(`o que o nav mostra ao ${role} e exatamente o que os guards liberam`, () => {
      const divergences = navRoutes
        .map((item) => ({
          route: item.route as string,
          nav: navShows(item, role),
          guard: guardAllows(item.route as string, role),
        }))
        .filter(({ nav, guard }) => nav !== guard)
        .map(({ route, nav }) =>
          nav
            ? `${route}: o nav MOSTRA mas o guard NEGA (link que bate na cara)`
            : `${route}: o guard LIBERA mas o nav ESCONDE (tela invisivel)`,
        );

      expect(divergences, `divergencias para ${role}:\n${divergences.join('\n')}`).toEqual([]);
    });
  }

  /**
   * FEAT-0228 — a decisao do dono, prendida como teste: gerente e dono MENOS
   * billing. Redundante com a paridade acima de proposito: a paridade prova que
   * nav e guard concordam, esta prova que eles concordam no VALOR CERTO. Alinhar
   * os dois em `['OWNER']` passaria na paridade e mataria a feature.
   */
  describe('FEAT-0228 — o MANAGER ve tudo menos billing', () => {
    const MANAGER_DENIED = ['/billing'];

    it('nenhuma rota do nav fica fora do MANAGER, exceto billing', () => {
      const hidden = navRoutes
        .filter((item) => !navShows(item, 'MANAGER'))
        .map((item) => item.route as string);

      expect(hidden).toEqual(MANAGER_DENIED);
    });

    it('os guards negam billing ao MANAGER e liberam o resto do nav', () => {
      const denied = navRoutes
        .map((item) => item.route as string)
        .filter((route) => !guardAllows(route, 'MANAGER'));

      expect(denied).toEqual(MANAGER_DENIED);
    });

    it('/billing continua exclusivo do OWNER', () => {
      expect(guardAllows('/billing', 'OWNER')).toBe(true);
      expect(guardAllows('/billing', 'MANAGER')).toBe(false);
      expect(guardAllows('/billing', 'DRIVER')).toBe(false);
    });

    it('configuracoes e convites voltaram para o MANAGER', () => {
      for (const route of [
        '/configuracoes',
        '/configuracoes/integracoes',
        '/configuracoes/contratos',
        '/configuracoes/convites',
      ]) {
        expect(guardAllows(route, 'MANAGER'), `guard barrou o MANAGER em ${route}`).toBe(true);
      }
    });
  });
});
