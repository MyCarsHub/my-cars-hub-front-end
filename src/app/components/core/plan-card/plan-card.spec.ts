import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { PlanCardComponent, PlanCardTone } from './plan-card';

const ALL_TONES: readonly PlanCardTone[] = [
  'plain',
  'accent',
  'accent-success',
  'filled',
  'filled-success',
  'carbon',
  'carbon-success',
];

/** Os quatro degraus de luz declarados em `styles.css` (`.plan-rim--*`). */
const RIM_MODIFIERS = ['plan-rim--tint', 'plan-rim--brand', 'plan-rim--green', 'plan-rim--white'];

@Component({
  imports: [PlanCardComponent],
  template: `
    <app-plan-card
      [tone]="tone()"
      name="Pro"
      price="R$ 149,00"
      cycleSuffix="mês"
      [features]="['Um']"
      ctaLabel="Assinar"
    />
  `,
})
class HostComponent {
  readonly tone = signal<PlanCardTone>('plain');
}

function pointerEvent(type: string, pointerType: string, x: number, y: number): Event {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

describe('PlanCardComponent — luz de aresta', () => {
  it('dá a TODO tom da união fechada exatamente um degrau de luz', () => {
    const fixture = TestBed.createComponent(HostComponent);

    for (const tone of ALL_TONES) {
      fixture.componentInstance.tone.set(tone);
      fixture.detectChanges();

      const article = fixture.debugElement.query(By.css('article')).nativeElement as HTMLElement;
      const present = RIM_MODIFIERS.filter((cls) => article.classList.contains(cls));

      // A base sozinha não pinta nada: `--plan-rim-light` só existe nos
      // modificadores. Um tom com `plan-rim` e sem degrau seria um anel
      // transparente — o mesmo buraco que o `@default` do enum antigo abriu.
      expect(article.classList.contains('plan-rim'), `tom ${tone} sem .plan-rim`).toBe(true);
      expect(present, `tom ${tone} deveria ter 1 degrau, tem ${present.length}`).toHaveLength(1);
    }
  });

  it('alimenta o holofote com a posição do cursor dentro do card', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const article = fixture.debugElement.query(By.css('article')).nativeElement as HTMLElement;
    article.dispatchEvent(pointerEvent('pointermove', 'mouse', 42, 17));

    // O jsdom devolve um rect zerado, então clientX/Y viram as coordenadas locais.
    expect(article.style.getPropertyValue('--spot-x')).toBe('42px');
    expect(article.style.getPropertyValue('--spot-y')).toBe('17px');
  });

  it('ignora o toque — no telefone o CSS já não pinta a luz', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const article = fixture.debugElement.query(By.css('article')).nativeElement as HTMLElement;
    article.dispatchEvent(pointerEvent('pointermove', 'touch', 42, 17));

    expect(article.style.getPropertyValue('--spot-x')).toBe('');
    expect(article.style.getPropertyValue('--spot-y')).toBe('');
  });
});
