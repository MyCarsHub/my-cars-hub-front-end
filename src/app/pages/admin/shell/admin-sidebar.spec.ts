import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
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

  it('modelo: pílula Administração, itens, grupos e rodapé na ordem do protótipo', () => {
    const { el } = render(['ver', 'admins.gerir', 'suporte.atender', 'blog']);
    expect(labels(el)).toEqual([
      'Administração',
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
    expect(el.textContent).toContain('Recolher');
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
    expect(labels(el)).toEqual(['Administração', 'Voltar ao app', 'Perfil']);
  });

  it('cartão do topo no lugar do seletor: avatar, nome e papel em laranja', () => {
    const { el } = render(['ver']);
    expect(el.querySelector('app-company-switcher')).toBeNull();
    const avatar = el.querySelector('.bg-primary-500.rounded-full');
    expect(avatar).not.toBeNull();
    expect(el.querySelector('.text-primary-700')!.textContent).toContain('Dono da plataforma');
  });

  it('pílula Administração é cinza e não recebe o realce laranja', async () => {
    const { el, fixture, router } = render(['ver']);
    await router.navigateByUrl('/admin/users');
    fixture.detectChanges();
    const pill = link(el, 'Administração')!;
    expect(pill.classList.contains('bg-gray-100')).toBe(true);
    expect(pill.classList.contains('active-link')).toBe(false);
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
    const collapse = link(el, 'Recolher sidebar')!;
    expect(collapse).not.toBeNull();
    collapse.click();
    fixture.detectChanges();
    expect(layout.isCollapsed()).toBe(true);
    expect(link(el, 'Expandir sidebar')).not.toBeNull();
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
