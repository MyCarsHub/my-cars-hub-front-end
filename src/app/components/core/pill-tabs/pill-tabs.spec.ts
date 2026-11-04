import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PillTabOption, PillTabs } from './pill-tabs';

const OPTIONS: readonly PillTabOption<'a' | 'b' | 'c'>[] = [
  { value: 'a', label: 'Todos', count: 5 },
  { value: 'b', label: 'Esgotados', count: 0 },
  { value: 'c', label: 'Encerrados', shortLabel: 'Enc.', count: 1 },
];

@Component({
  imports: [PillTabs],
  template: `<app-pill-tabs ariaLabel="Situação" [options]="options" [value]="value()" (selected)="value.set($event)" />`,
})
class Host {
  options = OPTIONS;
  value = signal<'a' | 'b' | 'c'>('a');
}

describe('PillTabs', () => {
  const render = () => {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const pills = (): HTMLButtonElement[] => Array.from(el.querySelectorAll('button[role="radio"]'));
    return { fixture, el, pills };
  };

  it('é um radiogroup com a pílula marcada e a contagem, inclusive o zero', () => {
    const { el, pills } = render();
    expect(el.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Situação');
    expect(pills().map((p) => p.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(pills()[1].textContent).toContain('0');
  });

  it('clicar escolhe; a pílula curta mantém o nome completo para leitor de tela', () => {
    const { fixture, pills } = render();
    pills()[2].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('c');
    expect(pills()[2].getAttribute('aria-checked')).toBe('true');
    expect(pills()[2].getAttribute('aria-label')).toBe('Encerrados, 1');
  });

  it('só uma pílula fica na ordem de Tab e as setas movem o foco sem escolher', () => {
    const { fixture, el, pills } = render();
    expect(pills().map((p) => p.tabIndex)).toEqual([0, -1, -1]);
    pills()[0].focus();
    el.querySelector('[role="radiogroup"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('a');
    expect(document.activeElement).toBe(pills()[1]);
  });

  it('tem o polegar que desliza, escondido do leitor de tela', () => {
    const { el } = render();
    const thumb = el.querySelector('[data-thumb]') as HTMLElement;
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    expect(thumb.className).toContain('pill-thumb');
  });
});
