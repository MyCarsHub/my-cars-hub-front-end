import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  PaintedAction,
  PaintedCard,
  PaintedRing,
  PaintedStat,
  PaintedStats,
  PaintedTone,
} from './painted-card';

@Component({
  imports: [PaintedCard, PaintedRing, PaintedStats, PaintedAction],
  template: `
    <app-painted-card [tone]="tone()">
      <app-painted-ring
        [tone]="tone()"
        [percent]="percent()"
        value="89%"
        unit="recebido"
        ariaLabel="89% recebido"
      />
      <dl appPaintedStats [stats]="stats()"></dl>
      <a appPaintedAction [tone]="tone()" href="/x">Ver aluguel</a>
    </app-painted-card>
  `,
})
class Host {
  readonly tone = signal<PaintedTone>('orange');
  readonly percent = signal(50);
  readonly stats = signal<readonly PaintedStat[]>([{ label: 'investido', value: 'R$ 1,00' }]);
}

describe('PaintedCard', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      card: root.querySelector<HTMLElement>('app-painted-card')!,
      ring: root.querySelector<HTMLElement>('app-painted-ring')!,
    };
  }

  it('o cartão é pintado com cor sólida, nunca degradê', () => {
    const { fixture, card } = render();
    expect(card.className).toContain('bg-primary-500');
    expect(card.className).toContain('text-white');
    expect(card.className).not.toContain('gradient');

    fixture.componentInstance.tone.set('green');
    fixture.detectChanges();
    expect(card.className).toContain('bg-emerald-700');
    expect(card.className).not.toContain('bg-primary-500');
  });

  it('o miolo do anel acompanha a cor do cartão', () => {
    const { fixture, ring } = render();
    fixture.componentInstance.tone.set('green');
    fixture.detectChanges();
    expect(ring.querySelector('div')?.className).toContain('bg-emerald-700');
  });

  it('o anel desenha a fração em graus e trava fora de 0 a 100', () => {
    const { fixture } = render();
    const api = fixture.debugElement.query((d) => d.name === 'app-painted-ring')
      .componentInstance as unknown as { background: () => string };
    expect(api.background()).toContain('180deg');

    fixture.componentInstance.percent.set(140);
    fixture.detectChanges();
    expect(api.background()).toContain('360deg');

    fixture.componentInstance.percent.set(-5);
    fixture.detectChanges();
    expect(api.background()).toContain(' 0deg');
  });

  it('o anel é uma imagem com nome', () => {
    const { ring } = render();
    expect(ring.getAttribute('role')).toBe('img');
    expect(ring.getAttribute('aria-label')).toBe('89% recebido');
  });

  it('os números ficam num dl de verdade', () => {
    const { root } = render();
    expect(root.querySelector('dl > div > dt')?.textContent).toBe('investido');
    expect(root.querySelector('dl > div > dd')?.textContent).toBe('R$ 1,00');
  });

  it('a entrada e o toque usam as classes que respeitam movimento reduzido', () => {
    const { root, card } = render();
    expect(card.className).toContain('enter-up');
    expect(root.querySelector('a')?.className).toContain('press');
  });
});
