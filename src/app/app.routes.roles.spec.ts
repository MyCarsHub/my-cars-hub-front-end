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
import { describe, it, expect, beforeEach } from 'vitest';

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
  let currentRole: string;

  beforeEach(() => {
    const settings = findRoute(routes, 'configuracoes');
    expect(settings, 'a rota `configuracoes` sumiu da árvore').toBeDefined();
    guards = collectGuards(settings as Route, '');

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SessionService,
          useValue: { getItem: (key: string) => (key === 'selectedRole' ? currentRole : null) },
        },
      ],
    });
  });

  /** Roda um guard com o papel informado na sessão. */
  function runGuard(guard: CanActivateFn, role: string): boolean | UrlTree {
    currentRole = role;

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
});
