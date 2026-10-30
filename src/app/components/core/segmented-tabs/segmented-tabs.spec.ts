import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedTabs, SegmentedTabsOption } from './segmented-tabs';

type Aba = 'veiculo' | 'gerencia';

@Component({
  imports: [SegmentedTabs],
  template: `
    <app-segmented-tabs
      ariaLabel="Seções"
      idPrefix="carro"
      [options]="options()"
      [value]="value()"
      (selected)="onSelected($event)"
    />
  `,
})
class Host {
  readonly value = signal<Aba>('veiculo');
  readonly options = signal<readonly SegmentedTabsOption<Aba>[]>([
    { value: 'veiculo', label: 'Veículo' },
    { value: 'gerencia', label: 'Gerência', count: 7, countLabel: '7 pendências' },
  ]);
  readonly spy = vi.fn();

  onSelected(value: Aba): void {
    this.spy(value);
    this.value.set(value);
  }
}

describe('SegmentedTabs', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = () => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const thumb = () => root.querySelector<HTMLElement>('[data-thumb]')!;
    return { fixture, root, tabs, thumb };
  }

  it('marca o segmento ativo e deixa só ele na ordem de tabulação', () => {
    const { tabs } = render();
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs()[0].getAttribute('tabindex')).toBe('0');
    expect(tabs()[1].getAttribute('tabindex')).toBe('-1');
  });

  it('amarra cada segmento ao seu painel', () => {
    const { tabs } = render();
    expect(tabs()[1].id).toBe('carro-tab-gerencia');
    expect(tabs()[1].getAttribute('aria-controls')).toBe('carro-panel-gerencia');
  });

  it('o polegar desliza por transform, na largura de um segmento', () => {
    const { fixture, tabs, thumb } = render();
    expect(thumb().style.transform).toBe('translateX(0%)');
    expect(thumb().style.width).toContain('100% - 6px');

    tabs()[1].click();
    fixture.detectChanges();

    expect(thumb().style.transform).toBe('translateX(100%)');
  });

  it('o polegar não anima com movimento reduzido', () => {
    const { thumb } = render();
    expect(thumb().className).toContain('motion-reduce:transition-none');
  });

  it('mostra a contagem com rótulo acessível, e zero não mostra nada', () => {
    const { fixture, root } = render();
    const badge = () => root.querySelector('app-count-badge');
    expect(badge()?.textContent).toBe('7');
    expect(badge()?.getAttribute('aria-label')).toBe('7 pendências');

    fixture.componentInstance.options.update((list) =>
      list.map((o) => (o.value === 'gerencia' ? { ...o, count: 0 } : o)),
    );
    fixture.detectChanges();
    expect(badge()).toBeNull();
  });

  it('setas trocam de segmento', () => {
    const { fixture, tabs } = render();
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('gerencia');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
  });

  it('tocar no segmento já ativo não emite de novo', () => {
    const { fixture, tabs } = render();
    tabs()[0].click();
    expect(fixture.componentInstance.spy).not.toHaveBeenCalled();
  });
});
