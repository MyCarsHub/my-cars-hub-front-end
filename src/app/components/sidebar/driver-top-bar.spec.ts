import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { LayoutStore } from '../core/layouts/layout.store';
import { DriverTopBar } from './driver-top-bar';

describe('DriverTopBar', () => {
  it('tem 56px de barra e só o ☰ de 44px que abre o drawer — sem o logo', () => {
    TestBed.configureTestingModule({ imports: [DriverTopBar], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(DriverTopBar);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const layout = TestBed.inject(LayoutStore);

    expect(host.querySelector('header')!.className).toContain('h-[calc(3.5rem+env(safe-area-inset-top))]');
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Abrir menu"]')!;
    expect(button.className).toContain('h-11');
    expect(button.className).toContain('w-11');
    // O logo mora só no sidebar/drawer (pedido do dono); a barra não carrega imagem nenhuma.
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('header')!.textContent!.trim()).toBe('');

    button.click();
    fixture.detectChanges();
    expect(layout.isMobileOpen()).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
