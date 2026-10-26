import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Sidebar } from './sidebar';
import { LayoutStore, Tenant } from '../core/layouts/layout.store';

/**
 * AUDIT 2026-10-25 F2 — o item "Administração" segue o TOKEN em toda troca de contexto.
 *
 * O dono da plataforma também é DONO de uma empresa, e o papel da sessão "Ver como empresa"
 * também é OWNER. O menu só se recalculava quando o PAPEL mudava; OWNER → OWNER não muda, e o
 * item ficava congelado: aparecia durante a sessão (o token dela não alcança /admin) e sumia
 * ao sair (o admin voltava sem caminho para a própria área até dar F5).
 */
describe('Sidebar — item Administração acompanha a troca de credencial', () => {
  @Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
  class StubPage {}

  function token(payload: Record<string, unknown>): string {
    const b64 = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `header.${b64}.signature`;
  }

  const ADMIN_TOKEN = token({ system_role: 'PLATFORM_ADMIN', role: 'OWNER' });
  /** Formato real do token de impersonação: sem `role`, `system_role` rebaixado. */
  const IMPERSONATION_TOKEN = token({ system_role: 'USER', impersonation: true });

  const tenant = (id: string, name: string): Tenant => ({ id, name, role: 'OWNER', initial: name[0] });

  function offered(fixture: { componentInstance: unknown }): string[] {
    const menu = fixture.componentInstance as {
      navItems: () => Array<{ route?: string }>;
      bottomNavItems: () => Array<{ route?: string }>;
    };
    return [...menu.navItems(), ...menu.bottomNavItems()]
      .map((item) => item.route)
      .filter((route): route is string => !!route);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  afterEach(() => sessionStorage.clear());

  it('some ao entrar na sessão e volta ao sair, sem recarregar a página', () => {
    sessionStorage.setItem('token', ADMIN_TOKEN);
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([{ path: '**', component: StubPage }]), provideNoopAnimations()],
    });
    const layout = TestBed.inject(LayoutStore);
    const own = tenant('admin-co', 'Mycarshub');
    layout.tenants.set([own]);
    layout.selectedTenant.set(own);

    const fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    expect(offered(fixture)).toContain('/admin');

    // Entrar: o serviço troca o token e o shell reconcilia o tenant (refreshTenants).
    sessionStorage.setItem('token', IMPERSONATION_TOKEN);
    const observed = tenant('co-1', 'Locadora Demo');
    layout.tenants.set([observed]);
    layout.selectedTenant.set(observed);
    fixture.detectChanges();
    expect(offered(fixture)).not.toContain('/admin');

    // Sair: o token do admin volta e o tenant dele também.
    sessionStorage.setItem('token', ADMIN_TOKEN);
    layout.tenants.set([own]);
    layout.selectedTenant.set(own);
    fixture.detectChanges();
    expect(offered(fixture)).toContain('/admin');
  });
});
