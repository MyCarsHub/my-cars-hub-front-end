import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { InfoTip } from './info-tip';

@Component({
  imports: [InfoTip],
  template: `
    <app-info-tip label="O que é a caução" text="Valor que fica com você e volta no fim." />
    <button type="button" id="outside">fora</button>
  `,
})
class Host {}

describe('InfoTip — botão (i) com explicação', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (): HTMLButtonElement => el().querySelector('app-info-tip button') as HTMLButtonElement;
  const bubble = (): HTMLElement => el().querySelector('[role="note"]') as HTMLElement;

  async function mount(): Promise<void> {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('fechado: nome acessível, aria-expanded=false e o balão escondido', async () => {
    await mount();
    expect(button().getAttribute('aria-label')).toBe('O que é a caução');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().getAttribute('aria-controls')).toBe(bubble().id);
    expect(bubble().hidden).toBe(true);
  });

  it('o toque abre e fecha o balão', async () => {
    await mount();
    button().click();
    await render();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(bubble().hidden).toBe(false);
    expect(bubble().textContent).toContain('volta no fim');
    button().click();
    await render();
    expect(bubble().hidden).toBe(true);
  });

  it('Esc e um toque fora fecham', async () => {
    await mount();
    button().click();
    await render();
    button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(bubble().hidden).toBe(true);
    button().click();
    await render();
    (el().querySelector('#outside') as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(bubble().hidden).toBe(true);
  });
});
