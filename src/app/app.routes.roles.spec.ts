import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Route,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { routes } from './app.routes';
import { SessionService } from './services/session.service';

/**
 * Guards the access boundary of `/configuracoes`, which is OWNER-only.
 *
 * MANAGER perdeu o acesso quando a regra de multa por atraso — o único motivo
 * para ele entrar aqui — saiu do produto. Estes testes executam os guards de
 * verdade, em vez de conferir o array `canActivate` por inspeção: um
 * `roleGuard(['OWNER', 'MANAGER'])` que reapareça em qualquer filho falha aqui.
 *
 * Vale só para navegação. Quem de fato barra escrita é o backend.
 *
 * FIX-0363 — este spec usa o SessionService REAL e um JWT de verdade, em vez de
 * um dublê com `getItem`. O dublê antigo devolvia `selectedRole` do
 * armazenamento, e isso deixou de ser a fonte do papel quando o `roleGuard`
 * passou a ler do token: o teste quebrou no `getCompanyRoleFromToken` que o
 * dublê não tinha.
 *
 * Acrescentar o método ao dublê faria o vermelho sumir e o arquivo continuaria
 * afirmando que o papel vem do espelho — a premissa morta seguiria codificada,
 * pronta para mentir de novo na próxima troca de fonte. Um dublê não pode
 * divergir de uma implementação que ele não dubla: por isso aqui não há dublê.
 * O papel entra pelo mesmo lugar por onde entra em produção, o token.
 */

interface GuardedPath {
  readonly path: string;
  readonly guard: CanActivateFn;
}

/** Localiza um nó pelo `path` em qualquer profundidade da árvore. */
function findRoute(list: readonly Route[], target: string): Route | undefined {
  for (const route of list) {
    if (route.path === target) {
      return route;
    }
    const nested = route.children ? findRoute(route.children, target) : undefined;
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

/** Todo `canActivate` do nó e de seus descendentes, com o path acumulado. */
function collectGuards(route: Route, prefix: string): GuardedPath[] {
  const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
  const own = (route.canActivate ?? []).map((guard) => ({
    path: `/${path}`,
    guard: guard as CanActivateFn,
  }));
  const nested = (route.children ?? []).flatMap((child) => collectGuards(child, path));
  return [...own, ...nested];
}

describe('/configuracoes é OWNER-only', () => {
  let guards: GuardedPath[];

  beforeEach(() => {
    const settings = findRoute(routes, 'configuracoes');
    expect(settings, 'a rota `configuracoes` sumiu da árvore').toBeDefined();
    guards = collectGuards(settings as Route, '');

    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), SessionService],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  const encodePayload = (payload: Record<string, unknown>): string => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  /** JWT com o claim `role`, na forma que o backend emite. */
  const tokenWithRole = (role: string): string =>
    `${encodePayload({ alg: 'HS256', typ: 'JWT' })}.${encodePayload({ role })}.sig`;

  /** Roda um guard com o papel que o TOKEN da sessão carrega. */
  function runGuard(guard: CanActivateFn, role: string): boolean | UrlTree {
    sessionStorage.setItem('token', tokenWithRole(role));

    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  it('cobre o pai e todos os filhos declarados', () => {
    expect(guards.map((g) => g.path)).toEqual([
      '/configuracoes',
      '/configuracoes',
      '/configuracoes/integracoes',
      '/configuracoes/integracoes/asaas',
      '/configuracoes/contato',
      '/configuracoes/contratos',
      '/configuracoes/convites',
    ]);
  });

  it('deixa o OWNER entrar em toda a área', () => {
    for (const { path, guard } of guards) {
      expect(runGuard(guard, 'OWNER'), `OWNER foi barrado em ${path}`).toBe(true);
    }
  });

  it('manda o MANAGER para o dashboard em toda a área', () => {
    for (const { path, guard } of guards) {
      const result = runGuard(guard, 'MANAGER');

      expect(result, `MANAGER ainda entra em ${path}`).not.toBe(true);
      const router = TestBed.inject(Router);
      expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    }
  });

  /**
   * FIX-0363 — a fonte, prendida no lugar onde o dublê antigo a escondia: o
   * espelho editável não abre a área, e a ausência de token também não.
   */
  it('não deixa o selectedRole do armazenamento abrir a área', () => {
    for (const { path, guard } of guards) {
      sessionStorage.setItem('token', tokenWithRole('MANAGER'));
      sessionStorage.setItem('selectedRole', 'OWNER');

      const result = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as boolean | UrlTree;

      expect(result, `espelho adulterado abriu ${path}`).not.toBe(true);
    }
  });

  it('nega a área inteira quando não há token', () => {
    for (const { path, guard } of guards) {
      sessionStorage.clear();

      const result = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      ) as boolean | UrlTree;

      expect(result, `sem token ainda entrou em ${path}`).not.toBe(true);
    }
  });
});
