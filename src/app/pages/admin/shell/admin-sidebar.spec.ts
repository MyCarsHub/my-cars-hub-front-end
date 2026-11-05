import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { LayoutStore } from '../../../components/core/layouts/layout.store';
import { AdminCapabilitiesService } from '../../../services/admin-capabilities.service';
import { AdminCapabilityCode } from '../../../types/admin-roles.types';
import { AdminSidebar } from './admin-sidebar';

describe('AdminSidebar', () => {
  function render(codes: AdminCapabilityCode[], mobile = false, open = false) {
    const granted = new Set(codes);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminSidebar],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AdminCapabilitiesService,
          useValue: {
            can: (c: AdminCapabilityCode) => granted.has(c),
            capabilities: signal(granted),
            self: signal({ adminRoleLabel: 'Leitura' }),
            ensureLoaded: () => of(null),
          },
        },
      ],
    });
    const layout = TestBed.inject(LayoutStore);
    layout.setMobile(mobile);
    if (open) layout.openMobile();
    const fixture = TestBed.createComponent(AdminSidebar);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, layout, fixture };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('desktop: coluna fixa com os grupos e só os itens da capacidade', () => {
    const { el } = render(['ver']);
    expect(el.querySelector('[data-admin-sidebar]')).not.toBeNull();
    expect(el.querySelector('[data-admin-item="users"]')).not.toBeNull();
    expect(el.querySelector('[data-admin-item="admins"]')).toBeNull();
    expect(el.querySelector('[data-admin-item="blog"]')).toBeNull();
    expect(el.textContent).toContain('DINHEIRO');
    expect(el.textContent).not.toContain('Testar templates');
    expect(el.textContent).not.toContain('Ferramentas');
  });

  it('celular: fechado não desenha nada; aberto vira diálogo e fecha no Esc e ao navegar', () => {
    const closed = render(['ver'], true, false);
    expect(closed.el.querySelector('aside')).toBeNull();

    const { el, layout, fixture } = render(['ver'], true, true);
    const drawer = el.querySelector('[data-admin-drawer]')!;
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(layout.isMobileOpen()).toBe(false);

    layout.openMobile();
    fixture.detectChanges();
    (el.querySelector('[data-admin-item="users"]') as HTMLElement).click();
    expect(layout.isMobileOpen()).toBe(false);
  });

  it('celular: Tab do último item volta ao Fechar e Shift+Tab do Fechar vai ao último', () => {
    const { el, fixture } = render(['ver'], true, true);
    // O foco só funciona com o elemento no documento.
    document.body.appendChild(el);
    const close = el.querySelector('[data-drawer-close]') as HTMLElement;
    const last = el.querySelector('[data-admin-exit]') as HTMLElement;
    const drawer = el.querySelector('[data-admin-drawer]') as HTMLElement;
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

  it('celular: ao fechar, o foco volta ao ☰ da barra de topo', () => {
    const { layout, fixture } = render(['ver'], true, false);
    const host = document.createElement('div');
    host.innerHTML = '<header data-driver-top-bar><button type="button">☰</button></header>';
    document.body.appendChild(host);
    const burger = host.querySelector('button') as HTMLElement;

    layout.openMobile();
    fixture.detectChanges();
    TestBed.tick();
    layout.closeMobile();
    fixture.detectChanges();
    TestBed.tick();

    expect(document.activeElement).toBe(burger);
    host.remove();
  });
});
