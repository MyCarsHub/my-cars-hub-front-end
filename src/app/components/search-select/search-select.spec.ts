import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { SearchSelect, SearchSelectOption } from './search-select';

const DRIVERS: SearchSelectOption[] = [
  { id: 'cs', title: 'Carlos Henrique Souza', initials: 'CS' },
  { id: 'ja', title: 'João Pedro Alves', initials: 'JA' },
  { id: 'ml', title: 'Marcos Vinícius Lima', initials: 'ML', busy: true },
  { id: 'rc', title: 'Rafael Andrade Costa', initials: 'RC' },
];

@Component({
  imports: [SearchSelect],
  template: `
    <app-search-select
      label="Motorista"
      [required]="true"
      placeholder="Selecione o motorista"
      searchPlaceholder="Buscar pelo nome"
      [foundWords]="['motorista encontrado', 'motoristas encontrados']"
      testId="driver"
      [options]="options()"
      [(value)]="value"
      [error]="error()"
      (closed)="closedCount.set(closedCount() + 1)"
    />
    <button type="button" id="outside">fora</button>
  `,
})
class Host {
  readonly options = signal<SearchSelectOption[]>(DRIVERS);
  readonly value = signal('');
  readonly error = signal<string | null>(null);
  readonly closedCount = signal(0);
}

describe('SearchSelect — lista com busca', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement => el().querySelector('.ss-f') as HTMLButtonElement;
  const search = (): HTMLInputElement | null => el().querySelector('[role="combobox"]');
  const options = (): HTMLElement[] => Array.from(el().querySelectorAll('[role="option"]'));

  async function mount(): Promise<void> {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function key(target: HTMLElement, k: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }
  function type(text: string): void {
    const input = search()!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  afterEach(() => TestBed.resetTestingModule());

  it('fechado: mostra o rótulo, o texto de escolha e aria-expanded=false', async () => {
    await mount();
    expect(el().textContent).toContain('Motorista');
    expect(trigger().textContent).toContain('Selecione o motorista');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(search()).toBeNull();
  });

  it('aberto: busca com foco, lista com as opções e o ocupado apagado com o motivo (não some)', async () => {
    await mount();
    trigger().click();
    await render();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(search()).not.toBeNull();
    expect(document.activeElement).toBe(search());
    expect(search()!.getAttribute('aria-controls')).toBe(el().querySelector('[role="listbox"]')!.id);
    expect(options()).toHaveLength(4);
    const busy = options()[2];
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.textContent).toContain('Com outro aluguel nessas datas');
    // Sem linha "criar".
    expect(el().textContent).not.toMatch(/criar|cadastrar/i);
  });

  it('a busca filtra sem ligar para acento e diz quantos achou', async () => {
    await mount();
    trigger().click();
    await render();
    type('joao');
    await render();
    expect(options().map((o) => o.textContent?.trim())).toEqual([expect.stringContaining('João Pedro Alves')]);
    expect(el().textContent).toContain('1 motorista encontrado');
  });

  it('clicar numa opção escolhe, fecha, devolve o foco e o campo mostra a escolha com o avatar', async () => {
    await mount();
    trigger().click();
    await render();
    options()[1].click();
    await render();
    expect(fixture.componentInstance.value()).toBe('ja');
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().textContent).toContain('João Pedro Alves');
    expect(trigger().querySelector('.ss-av')?.textContent?.trim()).toBe('JA');
    expect(fixture.componentInstance.closedCount()).toBe(1);
  });

  it('clicar num ocupado não escolhe nada', async () => {
    await mount();
    trigger().click();
    await render();
    options()[2].click();
    await render();
    expect(fixture.componentInstance.value()).toBe('');
    expect(search()).not.toBeNull();
  });

  it('teclado: setas pulam o ocupado (aria-activedescendant), Enter escolhe, Esc fecha', async () => {
    await mount();
    trigger().click();
    await render();
    const active = (): string | null => search()!.getAttribute('aria-activedescendant');
    expect(active()).toBe(options()[0].id);
    key(search()!, 'ArrowDown');
    await render();
    expect(active()).toBe(options()[1].id);
    key(search()!, 'ArrowDown');
    await render();
    expect(active()).toBe(options()[3].id); // pulou o Marcos, ocupado
    key(search()!, 'ArrowUp');
    await render();
    expect(active()).toBe(options()[1].id);
    key(search()!, 'Enter');
    await render();
    expect(fixture.componentInstance.value()).toBe('ja');

    trigger().click();
    await render();
    expect(active()).toBe(options()[1].id); // reabre na escolha
    key(search()!, 'Escape');
    await render();
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('seta para baixo no campo fechado abre a lista', async () => {
    await mount();
    key(trigger(), 'ArrowDown');
    await render();
    expect(search()).not.toBeNull();
  });

  it('um toque fora fecha', async () => {
    await mount();
    trigger().click();
    await render();
    const outside = el().querySelector('#outside') as HTMLElement;
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(search()).toBeNull();
  });

  it('erro: aria-invalid e a mensagem ligada por aria-describedby', async () => {
    await mount();
    fixture.componentInstance.error.set('Escolha quem vai levar o carro.');
    await render();
    expect(trigger().getAttribute('aria-invalid')).toBe('true');
    const msg = el().querySelector('[role="alert"]')!;
    expect(msg.textContent).toContain('Escolha quem vai levar o carro.');
    expect(trigger().getAttribute('aria-describedby')).toBe(msg.id);
  });

  it('sem avatar (carro): o campo mostra "placa · modelo"', async () => {
    await mount();
    fixture.componentInstance.options.set([{ id: 'v1', title: 'RDC-4A21', subtitle: 'Chevrolet Onix 1.0' }]);
    fixture.componentInstance.value.set('v1');
    await render();
    expect(trigger().textContent).toContain('RDC-4A21 · Chevrolet Onix 1.0');
  });
});
