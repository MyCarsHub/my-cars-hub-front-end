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

@Component({
  imports: [StatusChip],
  template: `<app-status-chip tone="red" size="sm" [wrap]="true">Enviado, entrega não confirmada</app-status-chip>`,
})
class WrapHost {}

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

  it('neutro mantém o fundo de chip no escuro (o cartão e o poço têm a mesma cor)', () => {
    const { chip } = render();
    expect(chip.className).toContain('bg-surface-sunken');
    expect(chip.className).toContain('dark:bg-surface-strong');
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

  it('sem wrap (padrão) continua numa linha só, altura fixa', () => {
    const { chip } = render();
    expect(chip.className).toContain('whitespace-nowrap');
    expect(chip.className).toContain('h-[26px]');
  });

  it('wrap: quebra linha dentro da coluna, sem altura fixa, ainda só texto', () => {
    const fixture = TestBed.createComponent(WrapHost);
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('app-status-chip')!;
    expect(chip.className).toContain('whitespace-normal');
    expect(chip.className).toContain('max-w-full');
    expect(chip.className).toContain('min-h-[22px]');
    expect(chip.className).not.toContain('whitespace-nowrap');
    expect(chip.className).not.toMatch(/(^|\s)h-\[/);
    expect(chip.className).toContain('bg-rose-100');
    expect(chip.children).toHaveLength(0);
  });

  it('respeita movimento reduzido', () => {
    const { chip } = render();
    expect(chip.className).toContain('motion-reduce:transition-none');
  });
});
