import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { CardNotes } from './card-notes';

@Component({
  imports: [CardNotes],
  template: `<app-rc-notes [value]="notes()" (valueChange)="notes.set($event)" />`,
})
class Host {
  readonly notes = signal('');
}

describe('CardNotes — card 8 · Observações', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const host = (): Host => fixture.componentInstance;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const box = (): HTMLTextAreaElement => el().querySelector('[data-testid="notes"]') as HTMLTextAreaElement;
  const counter = (): HTMLElement => el().querySelector('[data-testid="notes-counter"]') as HTMLElement;
  const flat = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** A frase da esquerda e o número da direita do contador. */
  const count = (): string => Array.from(counter().children).map((c) => flat(c)).join(' | ');

  async function mount(): Promise<void> {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    await render();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function type(value: string): Promise<void> {
    box().value = value;
    box().dispatchEvent(new Event('input', { bubbles: true }));
    await render();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('vazio: rótulo, exemplo no campo, limite de 1000 e o contador zerado', async () => {
    await mount();
    expect(flat(el().querySelector('label[for="rt-notes"]'))).toBe('Observações');
    expect(box().getAttribute('placeholder')).toBe('Ex.: combinado de entrega, estado do carro, recado para a equipe');
    expect(box().getAttribute('maxlength')).toBe('1000');
    expect(box().getAttribute('aria-describedby')).toBe('rt-notes-cnt');
    expect(count()).toBe('Só para você e sua equipe. | 0 / 1000');
    expect(counter().classList.contains('w')).toBe(false);
  });

  it('o (i) diz que o motorista não vê', async () => {
    await mount();
    (el().querySelector('button[aria-label="O que é observações"]') as HTMLButtonElement).click();
    await render();
    expect(flat(el().querySelector('#rt-tip-notes'))).toBe('Só você e sua equipe veem. O motorista não vê.');
  });

  it('escrevendo: avisa a página e o contador acompanha', async () => {
    await mount();
    await type('Carro sai com arranhão.');
    expect(host().notes()).toBe('Carro sai com arranhão.');
    expect(count()).toBe('Só para você e sua equipe. | 23 / 1000');
  });

  it('perto do limite: contador laranja e quantos faltam', async () => {
    await mount();
    host().notes.set('a'.repeat(988));
    await render();
    expect(counter().classList.contains('w')).toBe(true);
    expect(count()).toBe('Faltam 12 caracteres. | 988 / 1000');
  });

  it('nunca passa de 1000, mesmo colando texto maior', async () => {
    await mount();
    await type('b'.repeat(1200));
    expect(host().notes().length).toBe(1000);
    expect(count()).toBe('Você chegou ao limite. | 1000 / 1000');
  });
});
