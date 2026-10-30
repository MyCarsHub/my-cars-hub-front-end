import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { routes } from '../../app.routes';

@Component({ template: '' })
class Stub {}

function findVeiculos(tree: readonly Route[]): Route | undefined {
  for (const route of tree) {
    if (route.path === 'veiculos') return route;
    const found = route.children ? findVeiculos(route.children) : undefined;
    if (found) return found;
  }
  return undefined;
}

/**
 * Lê a árvore REAL: o que este arquivo trava é a configuração de `app.routes.ts`. Só os
 * guardas e os componentes saem, para a navegação não depender de sessão.
 */
function realVehicleRoutes(): Route[] {
  const children = findVeiculos(routes)?.children ?? [];
  return [
    {
      path: 'veiculos',
      children: children.map(({ path, pathMatch, redirectTo }) =>
        redirectTo ? { path, pathMatch, redirectTo } : { path, pathMatch, component: Stub },
      ),
    },
  ];
}

describe('caminhos antigos da gerência', () => {
  async function go(url: string): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(realVehicleRoutes())] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  }

  it('/veiculos/:id/gerencia vira o segmento Gerência, com o mesmo id', async () => {
    expect(await go('/veiculos/abc/gerencia')).toBe('/veiculos/abc?aba=gerencia');
  });

  it('mantém o resto da query string', async () => {
    expect(await go('/veiculos/abc/gerencia?origem=email')).toBe(
      '/veiculos/abc?origem=email&aba=gerencia',
    );
  });

  it.each(['multas', 'manutencoes', 'financiamentos', 'seguros'])(
    '/veiculos/:id/gerencia/%s continua sendo a própria página',
    async (page) => {
      expect(await go(`/veiculos/abc/gerencia/${page}`)).toBe(`/veiculos/abc/gerencia/${page}`);
    },
  );
});
