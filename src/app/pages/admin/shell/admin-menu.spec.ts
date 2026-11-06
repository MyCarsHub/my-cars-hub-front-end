import { describe, expect, it } from 'vitest';
import type { Route } from '@angular/router';
import { routes } from '../../../app.routes';
import { AppShell } from '../../../components/core/layouts/app-shell';
import { AdminCapabilityCode } from '../../../types/admin-roles.types';
import {
  ADMIN_MENU,
  adminMenuItemForUrl,
  buildAdminNavItems,
  isAdminAreaUrl,
  visibleAdminMenu,
} from './admin-menu';

/** Acha a rota `admin` e diz se ela está debaixo do AppShell. */
function findAdmin(list: Route[], shellAbove: boolean): { admin: Route; underShell: boolean } | null {
  for (const r of list) {
    const shell = shellAbove || r.component === AppShell;
    if (r.path === 'admin' && r.children) return { admin: r, underShell: shell };
    if (r.children) {
      const found = findAdmin(r.children, shell);
      if (found) return found;
    }
  }
  return null;
}

const found = findAdmin(routes, false)!;
const adminPaths = found.admin.children!.map((c) => c.path ?? '');

describe('Menu da administração — tabela de rotas', () => {
  it('as rotas de /admin ficam debaixo do AppShell (a casca que troca o menu)', () => {
    expect(found.underShell).toBe(true);
    expect(adminPaths.length).toBeGreaterThan(10);
  });

  it('toda rota de /admin tem um item de menu dono, feedback inclusive', () => {
    for (const path of adminPaths) {
      const url = '/admin' + (path ? '/' + path.replace(/:[^/]+/g, 'x') : '');
      expect(isAdminAreaUrl(url), url).toBe(true);
      expect(adminMenuItemForUrl(url), url).not.toBeNull();
    }
    expect(adminMenuItemForUrl('/admin/feedback')?.id).toBe('feedback');
    expect(adminMenuItemForUrl('/admin/users/abc')?.id).toBe('users');
    expect(adminMenuItemForUrl('/admin/companies/converter-testes')?.id).toBe('companies');
    expect(adminMenuItemForUrl('/admin/blog/novo')?.id).toBe('blog');
    expect(adminMenuItemForUrl('/admin')?.id).toBe('home');
  });

  it('todo item de menu aponta para uma rota que existe', () => {
    for (const item of ADMIN_MENU.flatMap((g) => g.items)) {
      expect(adminPaths, item.route).toContain(item.route.replace(/^\/admin\/?/, ''));
    }
  });

  it('os grupos seguem o protótipo', () => {
    expect(ADMIN_MENU.map((g) => g.label)).toEqual([
      'GERAL',
      'PESSOAS',
      'DINHEIRO',
      'OPERAÇÃO',
      'SEGURANÇA',
    ]);
  });

  it('isAdminAreaUrl não confunde prefixos', () => {
    expect(isAdminAreaUrl('/admin?x=1')).toBe(true);
    expect(isAdminAreaUrl('/administrativo')).toBe(false);
    expect(isAdminAreaUrl('/dashboard')).toBe(false);
  });
});

describe('Menu da administração — capacidades', () => {
  const ids = (can: (c: AdminCapabilityCode) => boolean) =>
    visibleAdminMenu(can).flatMap((g) => g.items.map((i) => i.id));

  it('Leitura (só "ver") enxerga apenas itens de leitura', () => {
    const visible = ids((c) => c === 'ver');
    expect(visible).toEqual([
      'home', 'users', 'companies', 'charges', 'billing', 'coupons', 'support', 'notifications', 'audit',
    ]);
    expect(visible).not.toContain('admins');
    expect(visible).not.toContain('blog');
    expect(visible).not.toContain('feedback');
  });

  it('o Dono enxerga tudo e sem resposta do servidor nada aparece', () => {
    expect(ids(() => true)).toHaveLength(ADMIN_MENU.flatMap((g) => g.items).length);
    expect(visibleAdminMenu(() => false)).toEqual([]);
  });

  it('grupo sem item visível some', () => {
    expect(visibleAdminMenu((c) => c === 'blog').map((g) => g.label)).toEqual(['OPERAÇÃO']);
  });
});

describe('Menu da administração — sem páginas de empresa', () => {
  it('todo destino é /admin e nenhum é tela de empresa; "Ver como" não é item', () => {
    const items = ADMIN_MENU.flatMap((g) => g.items);
    for (const i of items) expect(i.route).toMatch(/^\/admin(\/|$)/);
    const tenant = ['/dashboard', '/alugueis', '/veiculos', '/manutencoes', '/billing', '/perfil'];
    for (const t of tenant) expect(items.map((i) => i.route)).not.toContain(t);
    expect(items.map((i) => i.capability)).not.toContain('ver_como');
    expect(items.map((i) => i.label.toLowerCase()).join(' ')).not.toContain('ver como');
  });
});

describe('Menu da administração — modelo da sidebar (FIX-0864)', () => {
  const all = () => visibleAdminMenu(() => true);

  it('Dinheiro e Operação são grupos; o resto sobe solto, na ordem do protótipo', () => {
    const items = buildAdminNavItems(all());
    expect(items.map((i) => i.label)).toEqual([
      'Visão geral',
      'Usuários',
      'Empresas',
      'Administradores',
      'Dinheiro',
      'Operação',
      'Auditoria',
    ]);
    const dinheiro = items.find((i) => i.label === 'Dinheiro')!;
    expect(dinheiro.children!.map((c) => c.label)).toEqual(['Cobranças', 'Billing', 'Cupons']);
    expect(dinheiro.route).toBeUndefined();
    const operacao = items.find((i) => i.label === 'Operação')!;
    expect(operacao.children!.map((c) => c.label)).toEqual([
      'Suporte',
      'Feedback',
      'Notificações',
      'Blog',
    ]);
  });

  it('só Visão geral é exato; ícones no molde de 20px da sidebar de empresa', () => {
    const items = buildAdminNavItems(all());
    expect(items.filter((i) => i.exactMatch).map((i) => i.label)).toEqual(['Visão geral']);
    for (const i of items) expect(i.icon).toContain('width="20"');
  });

  it('capacidade tira o item e o grupo vazio; grupo com um item vira item', () => {
    const only = (...codes: AdminCapabilityCode[]) =>
      buildAdminNavItems(visibleAdminMenu((c) => codes.includes(c)));
    expect(only().length).toBe(0);
    const reader = only('ver');
    expect(reader.find((i) => i.label === 'Administradores')).toBeUndefined();
    expect(reader.find((i) => i.label === 'Operação')!.children!.map((c) => c.label)).toEqual([
      'Suporte',
      'Notificações',
    ]);
    const operacao = ADMIN_MENU.find((g) => g.label === 'OPERAÇÃO')!;
    const single = buildAdminNavItems([{ ...operacao, items: operacao.items.slice(0, 1) }]);
    expect(single.length).toBe(1);
    expect(single[0].children).toBeUndefined();
  });

  it('nenhum item aponta para fora de /admin', () => {
    const flat = buildAdminNavItems(all()).flatMap((i) => i.children ?? [i]);
    for (const i of flat) expect(i.route, i.label).toMatch(/^\/admin(\/|$)/);
  });
});
