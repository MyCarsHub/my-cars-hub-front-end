import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ListChevron, ListGroup, ListRow } from './list-group';

@Component({
  imports: [ListGroup, ListRow, ListChevron],
  template: `
    <app-list-group [heading]="heading()" [flat]="flat()">
      <span groupNote data-note>2 atrasadas</span>
      <a appListRow data-link><span class="t"><b>Editar</b></span><app-list-chevron /></a>
      <button
        appListRow
        type="button"
        data-button
        [locked]="locked()"
        [danger]="danger()"
        [inset]="inset()"
      >
        <span class="t"><b>Excluir</b></span>
      </button>
      <div appListRow data-static><span class="t"><b>Fiat Argo</b></span></div>
    </app-list-group>
  `,
})
class Host {
  readonly heading = signal<string | null>('Ações');
  readonly flat = signal(false);
  readonly locked = signal(false);
  readonly danger = signal(false);
  readonly inset = signal(false);
}

describe('ListGroup e ListRow', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const row = root.querySelector<HTMLElement>('[data-button]')!;
    return { fixture, root, row };
  }

  it('mostra o título e o slot da direita', () => {
    const { root } = render();
    expect(root.querySelector('h2')?.textContent).toContain('Ações');
    expect(root.querySelector('[data-note]')?.textContent).toBe('2 atrasadas');
  });

  it('sem título não sobra um h2 vazio', () => {
    const { fixture, root } = render();
    fixture.componentInstance.heading.set(null);
    fixture.detectChanges();
    expect(root.querySelector('h2')).toBeNull();
  });

  it('funciona em link, botão e div', () => {
    const { root } = render();
    expect(root.querySelector('a[appListRow]')).not.toBeNull();
    expect(root.querySelector('button[appListRow]')).not.toBeNull();
    expect(root.querySelector('div[appListRow]')).not.toBeNull();
  });

  it('locked, danger e inset viram estado na linha', () => {
    const { fixture, row } = render();
    expect(row.className).not.toContain('list-row-locked');

    fixture.componentInstance.locked.set(true);
    fixture.componentInstance.danger.set(true);
    fixture.componentInstance.inset.set(true);
    fixture.detectChanges();

    expect(row.className).toContain('list-row-locked');
    expect(row.className).toContain('list-row-danger');
    expect(row.className).toContain('list-row-inset');
  });

  it('o chevron é decorativo', () => {
    const { root } = render();
    expect(root.querySelector('.chev')?.getAttribute('aria-hidden')).toBe('true');
  });
});
