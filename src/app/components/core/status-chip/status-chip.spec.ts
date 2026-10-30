import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { StatusChip, StatusChipTone } from './status-chip';

@Component({
  imports: [StatusChip],
  template: `<app-status-chip [tone]="tone()" [size]="size()" [colorClass]="color()">Em dia</app-status-chip>`,
})
class Host {
  readonly tone = signal<StatusChipTone>('neutral');
  readonly size = signal<'sm' | 'md'>('md');
  readonly color = signal<string | null>(null);
}

describe('StatusChip', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('app-status-chip')!;
    return { fixture, chip };
  }

  it('é só texto: nenhum elemento filho, logo nenhuma bolinha', () => {
    const { chip } = render();
    expect(chip.children).toHaveLength(0);
    expect(chip.textContent).toBe('Em dia');
  });

  it('cada tom troca as classes do fundo', () => {
    const { fixture, chip } = render();
    fixture.componentInstance.tone.set('amber');
    fixture.detectChanges();
    expect(chip.className).toContain('bg-amber-100');

    fixture.componentInstance.tone.set('orange');
    fixture.detectChanges();
    expect(chip.className).toContain('bg-primary-50');
    expect(chip.className).not.toContain('bg-amber-100');
  });

  it('o tamanho pequeno muda a altura', () => {
    const { fixture, chip } = render();
    expect(chip.className).toContain('h-[26px]');
    fixture.componentInstance.size.set('sm');
    fixture.detectChanges();
    expect(chip.className).toContain('h-[22px]');
  });

  it('colorClass vence o tom: a cor de status continua vindo de status-maps', () => {
    const { fixture, chip } = render();
    fixture.componentInstance.color.set('bg-blue-100 text-blue-700');
    fixture.detectChanges();
    expect(chip.className).toContain('bg-blue-100');
    expect(chip.className).not.toContain('bg-surface-sunken');
  });

  it('respeita movimento reduzido', () => {
    const { chip } = render();
    expect(chip.className).toContain('motion-reduce:transition-none');
  });
});
