import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LayoutStore, Tenant } from '../core/layouts/layout.store';
import { Sidebar } from './sidebar';

/**
 * MENU NOVO (canvas "Menu novo", 13/11) — o que CADA papel vê, pelo DOM renderizado.
 *
 * O menu foi reagrupado (Frota, Financeiro, Configurações), Alertas saiu (aba Vencimentos do
 * sino), Roadmap virou aba de Novidades e Suporte/Perfil foram para o ⋮ da conta. A regra do
 * dono é que a VISIBILIDADE por papel não mude: este arquivo lista, por papel, a árvore
 * inteira — grupos abertos — e o pé, e compara por IGUALDADE. Um item a mais ou a menos para
 * qualquer papel quebra aqui com o nome do item.
 *
 * Papéis: dono, gerente, motorista, admin da plataforma (com empresa) e a sessão de suporte
 * ("Ver como empresa", token de impersonação sem `role`, papel efetivo OWNER).
 */

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class StubPage {}

function token(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${b64}.signature`;
}

const tenant = (role: string): Tenant => ({ id: `t-${role}`, name: 'Locadora Boa Viagem', role, initial: 'L' });

/** Árvore do menu de empresa para dono e gerente (sem Assinatura para o gerente). */
const FLEET_TREE = (withBilling: boolean): string[] => [
  'Dashboard',
  'Aluguéis',
  'Frota',
  '  Veículos',
  '  Manutenções',
  '  Vistorias',
  '  Multas',
  '  Sinistros',
  'Motoristas',
  'Financeiro',
  '  Gastos',
  '  Ajustes',
  '  Relatórios',
  '  Financiamentos',
  '  Seguros',
  '  IPVA',
  ...(withBilling ? ['Assinatura'] : []),
  'Configurações',
  '  Empresa',
  '  Integrações',
  '  Contratos',
  '  Membros',
];

describe('Sidebar — o que cada papel vê no menu novo', () => {
  let fixture: ComponentFixture<Sidebar>;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });
  afterEach(() => sessionStorage.clear());

  async function render(jwt: string, role: string, name = 'Marina Lopes'): Promise<HTMLElement> {
    sessionStorage.setItem('token', jwt);
    sessionStorage.setItem('name', name);
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([{ path: '**', component: StubPage }]), provideNoopAnimations()],
    }).compileComponents();
    const layout = TestBed.inject(LayoutStore);
    layout.tenants.set([tenant(role)]);
    layout.selectedTenant.set(tenant(role));
    layout.setMobile(false);
    fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    // Abre todo grupo fechado para a árvore inteira estar no DOM.
    for (const button of Array.from(
      host.querySelectorAll<HTMLButtonElement>('nav button[aria-expanded="false"]'),
    )) {
      button.click();
      fixture.detectChanges();
    }
    return host;
  }

  /** Árvore da lista rolável: item de topo, e filhos com dois espaços na frente. */
  function tree(host: HTMLElement): string[] {
    const out: string[] = [];
    const nav = host.querySelector('nav')!;
    for (const el of Array.from(nav.querySelectorAll<HTMLElement>('.nav-link'))) {
      const label = (el.getAttribute('aria-label') ?? '').split(',')[0];
      out.push(el.closest('[data-nav-group]') && el.tagName === 'A' ? `  ${label}` : label);
    }
    return out;
  }

  function foot(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('[data-nav-bottom] a.nav-link')).map(
      (a) => (a.getAttribute('aria-label') ?? '').split(',')[0],
    );
  }

  function accountMenu(host: HTMLElement): string[] {
    const kebab = host.querySelector<HTMLButtonElement>('[data-account-kebab]');
    if (!kebab) return [];
    kebab.click();
    fixture.detectChanges();
    return Array.from(host.querySelectorAll('[role="menu"] [role="menuitem"]')).map((el) =>
      el.textContent!.trim(),
    );
  }

  it('DONO: grupos Frota, Financeiro e Configurações, Assinatura; Novidades no pé', async () => {
    const host = await render(token({ role: 'OWNER' }), 'OWNER');
    expect(tree(host)).toEqual(FLEET_TREE(true));
    expect(foot(host)).toEqual(['Novidades']);
    expect(accountMenu(host)).toEqual(['Perfil', 'Suporte', 'Sair']);
  });

  it('GERENTE: o mesmo menu do dono, sem Assinatura', async () => {
    const host = await render(token({ role: 'MANAGER' }), 'MANAGER');
    expect(tree(host)).toEqual(FLEET_TREE(false));
    expect(foot(host)).toEqual(['Novidades']);
    expect(accountMenu(host)).toEqual(['Perfil', 'Suporte', 'Sair']);
  });

  it('MOTORISTA: o menu dele, com Novidades na lista e o Roadmap como aba', async () => {
    const host = await render(token({ role: 'DRIVER' }), 'DRIVER');
    expect(tree(host)).toEqual([
      'Dashboard',
      'Financeiro',
      '  Ganhos',
      '  Custos',
      '  Metas',
      'Novidades',
      'Veículo',
      '  Meu aluguel',
      '  Vistorias',
    ]);
    expect(foot(host)).toEqual([]);
    expect(accountMenu(host)).toEqual(['Perfil', 'Suporte', 'Sair']);
  });

  it('ADMIN DA PLATAFORMA (com empresa): Administração primeiro, depois o menu do dono', async () => {
    const host = await render(token({ role: 'OWNER', system_role: 'PLATFORM_ADMIN' }), 'OWNER');
    expect(tree(host)).toEqual(['Administração', ...FLEET_TREE(true)]);
    expect(foot(host)).toEqual(['Novidades']);
    expect(accountMenu(host)).toEqual(['Perfil', 'Suporte', 'Sair']);
  });

  it('SUPORTE ("Ver como empresa"): o menu do dono, sem Administração', async () => {
    const host = await render(token({ system_role: 'USER', impersonation: true }), 'OWNER');
    expect(tree(host)).toEqual(FLEET_TREE(true));
    expect(foot(host)).toEqual(['Novidades']);
    expect(accountMenu(host)).toEqual(['Perfil', 'Suporte', 'Sair']);
  });

  it('SEM PAPEL DE EMPRESA: sem Novidades, o Roadmap continua como linha no pé', async () => {
    const host = await render(token({ system_role: 'PLATFORM_ADMIN' }), '');
    expect(tree(host)).toEqual(['Administração']);
    expect(foot(host)).toEqual(['Roadmap']);
    expect(accountMenu(host)).toEqual(['Perfil', 'Sair']);
  });

  it('nenhum papel vê Alertas nem Roadmap como item (Vencimentos no sino, Roadmap em Novidades)', async () => {
    for (const role of ['OWNER', 'MANAGER', 'DRIVER']) {
      TestBed.resetTestingModule();
      sessionStorage.clear();
      const host = await render(token({ role }), role);
      const all = [...tree(host), ...foot(host)].map((l) => l.trim());
      expect(all, role).not.toContain('Alertas');
      expect(all, role).not.toContain('Roadmap');
    }
  });
});

describe('Sidebar — comportamento do menu novo', () => {
  let fixture: ComponentFixture<Sidebar>;
  let layout: LayoutStore;
  let router: Router;

  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    sessionStorage.setItem('token', token({ role: 'OWNER' }));
    sessionStorage.setItem('name', 'Marina Lopes');
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([{ path: '**', component: StubPage }]), provideNoopAnimations()],
    }).compileComponents();
    layout = TestBed.inject(LayoutStore);
    layout.tenants.set([tenant('OWNER')]);
    layout.selectedTenant.set(tenant('OWNER'));
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
  });
  afterEach(() => sessionStorage.clear());

  const host = () => fixture.nativeElement as HTMLElement;
  const group = (label: string) =>
    host().querySelector<HTMLButtonElement>(`nav button[aria-label="${label}"]`)!;
  const goTo = async (url: string) => {
    await router.navigateByUrl(url);
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('tocar no nome do grupo só abre e fecha — a página não muda', async () => {
    await goTo('/dashboard');
    group('Financeiro').click();
    fixture.detectChanges();
    expect(group('Financeiro').getAttribute('aria-expanded')).toBe('true');
    expect(router.url).toBe('/dashboard');
    group('Financeiro').click();
    fixture.detectChanges();
    expect(group('Financeiro').getAttribute('aria-expanded')).toBe('false');
    expect(router.url).toBe('/dashboard');
  });

  it('o grupo da página atual abre sozinho e a página fica no pill laranja de sempre', async () => {
    await goTo('/relatorios');
    expect(group('Financeiro').getAttribute('aria-expanded')).toBe('true');
    const relatorios = host().querySelector('a[aria-label="Relatórios"]')!;
    expect(relatorios.classList.contains('active-link')).toBe(true);
    // Opção A: a página do grupo é só texto (sem ícone), alinhada ao nome do grupo.
    expect(relatorios.querySelector('.nav-icon')).toBeNull();
    expect(relatorios.classList.contains('ml-8')).toBe(true);
    // Grupo aberto com a página dentro: o nome em destaque, sem pintar o grupo inteiro.
    expect(group('Financeiro').classList.contains('nav-group-has')).toBe(true);
    expect(group('Financeiro').classList.contains('active-link')).toBe(false);
  });

  it('grupo FECHADO com a página atual dentro vira o pill (a pessoa vê onde está)', async () => {
    await goTo('/relatorios');
    group('Financeiro').click();
    fixture.detectChanges();
    expect(group('Financeiro').classList.contains('active-link')).toBe(true);
  });

  it('Novidades acende no /roadmap (aba Roadmap de Novidades)', async () => {
    await goTo('/roadmap');
    const novidades = host().querySelector('a.nav-link[href="/novidades"]')!;
    expect(novidades.classList.contains('active-link')).toBe(true);
    await goTo('/dashboard');
    expect(novidades.classList.contains('active-link')).toBe(false);
  });

  it('no celular, tocar numa página fecha a gaveta; tocar no grupo não', async () => {
    layout.setMobile(true);
    layout.openMobile();
    fixture.detectChanges();
    group('Frota').click();
    fixture.detectChanges();
    expect(layout.isMobileOpen()).toBe(true);
    host().querySelector<HTMLAnchorElement>('a[aria-label="Veículos"]')!.click();
    fixture.detectChanges();
    expect(layout.isMobileOpen()).toBe(false);
  });

  it('bloco da empresa: nome e papel em cinza; o plano não aparece', () => {
    const role = host().querySelector('[data-header-role]')!;
    expect(role.textContent!.trim()).toBe('Dono');
    expect(role.classList.contains('text-fg-subtle')).toBe(true);
    expect(role.classList.contains('text-primary-700')).toBe(false);
    expect(host().textContent).not.toMatch(/plano|Starter|Pro\b|Enterprise/i);
  });

  it('bloco do usuário no pé: iniciais e nome; o nome leva ao Perfil', async () => {
    const user = host().querySelector<HTMLButtonElement>('[data-user-name]')!;
    expect(user.textContent).toContain('ML');
    expect(user.textContent).toContain('Marina Lopes');
    user.click();
    await fixture.whenStable();
    expect(router.url).toBe('/perfil');
  });

  it('⋮ da conta: Escape fecha o menu', () => {
    host().querySelector<HTMLButtonElement>('[data-account-kebab]')!.click();
    fixture.detectChanges();
    expect(host().querySelector('[role="menu"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host().querySelector('[role="menu"]')).toBeNull();
  });

  it('Sair: encerra a sessão e vai para o login', async () => {
    host().querySelector<HTMLButtonElement>('[data-account-kebab]')!.click();
    fixture.detectChanges();
    host().querySelector<HTMLButtonElement>('[data-account-logout]')!.click();
    await fixture.whenStable();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(router.url).toBe('/login');
  });

  it('computador recolhido: só ícones e o símbolo; o recolher volta a abrir', async () => {
    layout.setMobile(false);
    layout.isCollapsed.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host().querySelector('nav .nav-link span.truncate')).toBeNull();
    expect(host().querySelector('img[alt="MyCarsHub"]')).not.toBeNull();
    const toggle = host().querySelector<HTMLButtonElement>('[data-collapse-toggle]')!;
    expect(toggle.getAttribute('aria-label')).toBe('Expandir menu');
    toggle.click();
    fixture.detectChanges();
    expect(layout.isCollapsed()).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Recolher menu');
  });

  it('computador recolhido: tocar num grupo abre a coluna e o grupo', () => {
    layout.setMobile(false);
    layout.isCollapsed.set(true);
    fixture.detectChanges();
    group('Frota').click();
    fixture.detectChanges();
    expect(layout.isCollapsed()).toBe(false);
    expect(group('Frota').getAttribute('aria-expanded')).toBe('true');
  });

  it('nenhuma linha divisória no menu (separação só por espaço)', () => {
    const borders = Array.from(host().querySelectorAll('aside *')).filter((el) =>
      /(^|\s)border(-[trbl])?(\s|$)/.test(el.getAttribute('class') ?? ''),
    );
    expect(borders).toEqual([]);
  });
});
