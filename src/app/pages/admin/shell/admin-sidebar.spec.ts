import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { Sidebar } from '../../../components/sidebar/sidebar';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../../../components/core/layouts/layout.store';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { AdminSidebar } from './admin-sidebar';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class StubPage {}

/** FIX-0864 — o menu da administração é a `app-sidebar` do app com outro modelo. */
describe('AdminSidebar (FIX-0864: a sidebar do app com o modelo da administração)', () => {
  function render(
    codes: AdminCapabilityCode[],
    opts: { mobile?: boolean; open?: boolean; loaded?: boolean } = {},
  ) {
    const granted = new Set(codes);
    const loaded = opts.loaded ?? true;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminSidebar],
      providers: [
        provideRouter([{ path: '**', component: StubPage }]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AdminCapabilitiesService,
          useValue: {
            can: (c: AdminCapabilityCode) => granted.has(c),
            capabilities: signal(granted),
            self: signal(loaded ? { adminRoleLabel: 'Dono da plataforma' } : null),
            ensureLoaded: () => of(null),
          },
        },
      ],
    });
    const layout = TestBed.inject(LayoutStore);
    layout.setMobile(opts.mobile ?? false);
    if (opts.open) layout.openMobile();
    const fixture = TestBed.createComponent(AdminSidebar);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { el, layout, fixture, router: TestBed.inject(Router) };
  }

  const link = (el: HTMLElement, label: string) =>
    el.querySelector<HTMLElement>(`a[aria-label="${label}"], button[aria-label="${label}"]`);
  const labels = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('nav [aria-label], [data-nav-bottom] [aria-label]')).map((n) =>
      n.getAttribute('aria-label'),
    );

  beforeEach(() => sessionStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('é a MESMA sidebar do app: o componente e as classes de item de empresa', () => {
    const { el } = render(['ver']);
    expect(el.querySelector('app-sidebar')).not.toBeNull();
    expect(el.querySelector('aside.app-sidebar')).not.toBeNull();
    expect(link(el, 'Usuários')!.classList.contains('nav-link')).toBe(true);
    expect(el.querySelector('[data-admin-sidebar]')).toBeNull();
  });

  it('modelo: itens, grupos e rodapé na ordem do protótipo, sem pílula nem rótulo de seção', () => {
    const { el } = render(['ver', 'admins.gerir', 'suporte.atender', 'blog']);
    expect(labels(el)).toEqual([
      'Visão geral',
      'Usuários',
      'Empresas',
      'Administradores',
      'Dinheiro',
      'Operação',
      'Auditoria',
      'Voltar ao app',
      'Perfil',
    ]);
    expect(el.querySelector('button[aria-label="Recolher menu"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Testar templates');
    expect(el.textContent).not.toContain('Ferramentas');
    expect(el.textContent).not.toContain('Ver como');
  });

  it('capacidade: sem admins.gerir/blog/suporte.atender esses itens somem', () => {
    const { el, fixture } = render(['ver']);
    expect(link(el, 'Administradores')).toBeNull();
    link(el, 'Operação')!.click();
    fixture.detectChanges();
    expect(link(el, 'Notificações')).not.toBeNull();
    expect(link(el, 'Blog')).toBeNull();
    expect(link(el, 'Feedback')).toBeNull();
  });

  it('falha fechada: sem resposta de /admin/me nenhum item de administração, só a saída', () => {
    const { el } = render(['ver', 'blog'], { loaded: false });
    expect(labels(el)).toEqual(['Voltar ao app', 'Perfil']);
  });

  it('cartão do topo no lugar do seletor: avatar, nome e papel em laranja', () => {
    const { el } = render(['ver']);
    expect(el.querySelector('app-company-switcher')).toBeNull();
    const avatar = el.querySelector('.bg-primary-500.rounded-xl');
    expect(avatar).not.toBeNull();
    expect(el.querySelector('.text-primary-700')!.textContent).toContain('Dono da plataforma');
  });

  /** Monta a sidebar de EMPRESA (dono) ao lado, no mesmo módulo, para comparar marcação. */
  function companySidebar(): HTMLElement {
    const payload = { role: 'OWNER', exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    sessionStorage.setItem('token', `header.${b64}.signature`);
    const f = TestBed.createComponent(Sidebar);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }
  const cls = (n: Element | null | undefined) =>
    (n?.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && c !== 'active-link' && !c.startsWith('ng-')).sort().join(' ');

  it('paridade: mesma marcação e mesmos tokens da sidebar de empresa (desktop)', () => {
    const { el } = render(['ver']);
    const admin = el;
    const company = companySidebar();
    const a = admin.querySelector('aside')!;
    const c = company.querySelector('aside')!;
    expect(cls(a)).toBe(cls(c));
    // logo, cartão do topo, nav, bloco fixo de baixo e Recolher: filho a filho, mesma classe.
    const kids = (n: Element) => Array.from(n.children).map(cls);
    expect(kids(a)).toEqual(kids(c));
    expect(cls(admin.querySelector('nav'))).toBe(cls(company.querySelector('nav')));
    expect(cls(admin.querySelector('[data-nav-bottom]'))).toBe(cls(company.querySelector('[data-nav-bottom]')));
    expect(cls(admin.querySelector('.bg-primary-500.rounded-xl')!.parentElement)).toBe(
      cls(company.querySelector('.bg-primary-500.rounded-xl')!.parentElement),
    );
    // item simples e grupo: classes idênticas às do item/grupo de empresa.
    expect(cls(link(admin, 'Usuários'))).toBe(cls(company.querySelector('nav a.nav-link')));
    expect(cls(link(admin, 'Dinheiro'))).toBe(cls(company.querySelector('nav button.nav-link')));
    // Menu novo: o Perfil da empresa foi para o ⋮ da conta; a linha do pé de empresa é Novidades.
    expect(cls(link(admin, 'Perfil'))).toBe(cls(company.querySelector('[data-nav-bottom] a.nav-link')));
    // o rótulo do item: mesma escala tipográfica (text-sm font-medium), sem negrito grande.
    const label = (n: HTMLElement) => cls(n.querySelector('span:not([class*="w-5"])'));
    expect(label(link(admin, 'Usuários')!)).toBe(label(company.querySelector<HTMLElement>('nav a.nav-link')!));
  });

  it('paridade: sem pílula ADMIN, sem rótulos de seção em caixa alta, sem rodapé próprio', () => {
    const { el } = render(['ver', 'admins.gerir', 'suporte.atender', 'blog']);
    const text = (el.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).not.toMatch(/ADMIN/);
    for (const section of ['GERAL', 'PESSOAS', 'DINHEIRO', 'OPERAÇÃO', 'SEGURANÇA']) {
      expect(text).not.toContain(section);
    }
    expect(el.querySelector('[class*="tracking-wider"]')).toBeNull();
    expect(el.querySelector('nav [class*="uppercase"]')).toBeNull();
    expect(text).not.toContain('Sair da administração');
    expect(el.querySelector('[data-admin-sidebar], [data-admin-role], [data-admin-exit]')).toBeNull();
    // o papel mora no cartão do topo, não numa linha solta sob o último item.
    expect(el.querySelector('nav')!.textContent).not.toContain('Dono da plataforma');
    // o rodapé fixo (Voltar ao app, Perfil, Recolher) está FORA do nav que rola.
    expect(el.querySelector('nav a[aria-label="Voltar ao app"]')).toBeNull();
    expect(el.querySelector('[data-nav-bottom] a[aria-label="Voltar ao app"]')).not.toBeNull();
    // a rolagem usa a folha de estilo do componente compartilhado (barra fina de 4px).
    expect(el.querySelector('nav')!.classList.contains('overflow-y-auto')).toBe(true);
  });

  it('paridade: gaveta do celular com a mesma casca e o mesmo botão Fechar', () => {
    const { el, layout } = render(['ver'], { mobile: true, open: true });
    const company = companySidebar();
    expect(layout.isMobileOpen()).toBe(true);
    const a = el.querySelector('aside')!;
    const c = company.querySelector('aside')!;
    expect(cls(a)).toBe(cls(c));
    expect(cls(a.querySelector('[data-drawer-close]'))).toBe(cls(c.querySelector('[data-drawer-close]')));
    expect(Array.from(a.children).map(cls)).toEqual(Array.from(c.children).map(cls));
  });

  it('realce: lista e detalhe marcam o mesmo item; Visão geral só na URL exata', async () => {
    const { el, fixture, router } = render(['ver']);
    await router.navigateByUrl('/admin/users');
    fixture.detectChanges();
    expect(link(el, 'Usuários')!.classList.contains('active-link')).toBe(true);
    expect(link(el, 'Visão geral')!.classList.contains('active-link')).toBe(false);

    await router.navigateByUrl('/admin/users/42');
    fixture.detectChanges();
    expect(link(el, 'Usuários')!.classList.contains('active-link')).toBe(true);
    expect(link(el, 'Empresas')!.classList.contains('active-link')).toBe(false);

    await router.navigateByUrl('/admin');
    fixture.detectChanges();
    expect(link(el, 'Visão geral')!.classList.contains('active-link')).toBe(true);
  });

  it('grupo: abre e fecha no toque, e já nasce aberto na tela de um filho', async () => {
    const { el, fixture, router } = render(['ver']);
    const group = link(el, 'Dinheiro')!;
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(link(el, 'Cobranças')).toBeNull();
    group.click();
    fixture.detectChanges();
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(link(el, 'Cobranças')).not.toBeNull();
    group.click();
    fixture.detectChanges();
    expect(group.getAttribute('aria-expanded')).toBe('false');

    // Estado novo (o toque acima fixou "fechado"): a URL de um filho abre o grupo sozinha.
    const fresh = render(['ver']);
    await fresh.router.navigateByUrl('/admin/cobrancas/123');
    fresh.fixture.detectChanges();
    await fresh.fixture.whenStable();
    fresh.fixture.detectChanges();
    const el2 = fresh.el;
    expect(link(el2, 'Operação')!.getAttribute('aria-expanded')).toBe('false');
    expect(link(el2, 'Dinheiro')!.getAttribute('aria-expanded')).toBe('true');
    expect(link(el2, 'Cobranças')!.classList.contains('active-link')).toBe(true);
  });

  it('Recolher: o mesmo botão do app encolhe a coluna', () => {
    const { el, layout, fixture } = render(['ver']);
    const collapse = link(el, 'Recolher menu')!;
    expect(collapse).not.toBeNull();
    collapse.click();
    fixture.detectChanges();
    expect(layout.isCollapsed()).toBe(true);
    expect(link(el, 'Expandir menu')).not.toBeNull();
    layout.isCollapsed.set(false);
  });

  it('celular: fechado não desenha nada; aberto vira diálogo e fecha no Esc e ao navegar', () => {
    const closed = render(['ver'], { mobile: true });
    expect(closed.el.querySelector('aside')).toBeNull();

    const { el, layout, fixture } = render(['ver'], { mobile: true, open: true });
    const drawer = el.querySelector('aside')!;
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.getAttribute('aria-label')).toBe('Menu da administração');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(layout.isMobileOpen()).toBe(false);

    layout.openMobile();
    fixture.detectChanges();
    link(el, 'Usuários')!.click();
    expect(layout.isMobileOpen()).toBe(false);
  });

  it('celular: Tab do último item volta ao Fechar e Shift+Tab do Fechar vai ao último', () => {
    const { el, fixture } = render(['ver'], { mobile: true, open: true });
    document.body.appendChild(el);
    const close = el.querySelector('[data-drawer-close]') as HTMLElement;
    const last = link(el, 'Perfil')!;
    const drawer = el.querySelector('aside') as HTMLElement;
    fixture.detectChanges();

    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    drawer.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    drawer.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    el.remove();
  });

  it('celular: ao abrir o foco vai ao Fechar; ao fechar volta a quem abriu (o ☰)', () => {
    const { layout, fixture, el } = render(['ver'], { mobile: true });
    const host = document.createElement('div');
    host.innerHTML = '<header data-driver-top-bar><button type="button">☰</button></header>';
    document.body.appendChild(host);
    document.body.appendChild(el);
    const burger = host.querySelector('button') as HTMLElement;
    burger.focus();

    layout.openMobile();
    fixture.detectChanges();
    TestBed.tick();
    expect(document.activeElement).toBe(el.querySelector('[data-drawer-close]'));
    layout.closeMobile();
    fixture.detectChanges();
    TestBed.tick();

    expect(document.activeElement).toBe(burger);
    host.remove();
    el.remove();
  });
});
