import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarField } from './calendar-field';
import { addMonthsClamped, monthWeeks } from './calendar-math';

@Component({
  imports: [CalendarField],
  template: `
    <app-calendar-field
      label="Devolve em"
      [required]="true"
      testId="end"
      [(value)]="value"
      [min]="min()"
      [rangeStart]="start()"
      (closed)="closedCount.set(closedCount() + 1)"
      >De 24/11 a <b>{{ value() }}</b></app-calendar-field
    >
    <button type="button" id="outside">fora</button>
  `,
})
class Host {
  readonly value = signal('');
  readonly min = signal<string | null>(null);
  readonly start = signal<string | null>(null);
  readonly closedCount = signal(0);
}

describe('calendar-math', () => {
  it('novembro de 2026 começa num domingo e tem 5 semanas', () => {
    const weeks = monthWeeks('2026-11');
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks).toHaveLength(5);
    expect(weeks[4].filter(Boolean)).toEqual(['2026-11-29', '2026-11-30']);
  });

  it('dezembro de 2026 começa numa terça (duas casas vazias)', () => {
    expect(monthWeeks('2026-12')[0].slice(0, 3)).toEqual([null, null, '2026-12-01']);
  });

  it('um mês depois de 31/01 é o último dia de fevereiro', () => {
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28');
  });
});

describe('CalendarField — campo de data com calendário', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement => el().querySelector('[data-testid="end"]') as HTMLButtonElement;
  const panel = (): HTMLElement | null => el().querySelector('[role="dialog"]');
  const day = (iso: string): HTMLElement => el().querySelector(`[data-day="${iso}"]`) as HTMLElement;

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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T12:00:00-03:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('fechado: "dd/mm/aaaa", aria-haspopup=dialog; com valor, a data no formato do Brasil', async () => {
    await mount();
    expect(trigger().textContent).toContain('dd/mm/aaaa');
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fixture.componentInstance.value.set('2026-12-22');
    await render();
    expect(trigger().textContent).toContain('22/12/2026');
  });

  it('abre no mês de hoje, com hoje marcado e o foco nele; o rodapé é do chamador', async () => {
    await mount();
    trigger().click();
    await render();
    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toContain('Novembro 2026');
    expect(day('2026-11-20').getAttribute('aria-current')).toBe('date');
    expect(document.activeElement).toBe(day('2026-11-20'));
    expect(panel()!.textContent).toContain('De 24/11 a');
  });

  it('tocar num dia escolhe; "Pronto" fecha e devolve o foco ao campo', async () => {
    await mount();
    trigger().click();
    await render();
    day('2026-11-27').click();
    await render();
    expect(fixture.componentInstance.value()).toBe('2026-11-27');
    expect(day('2026-11-27').getAttribute('aria-selected')).toBe('true');
    (el().querySelector('[data-testid="calendar-done"]') as HTMLButtonElement).click();
    await render();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(fixture.componentInstance.closedCount()).toBe(1);
  });

  it('dia antes do mínimo fica apagado e não pode ser escolhido', async () => {
    await mount();
    fixture.componentInstance.min.set('2026-11-25');
    await render();
    trigger().click();
    await render();
    expect(day('2026-11-24').getAttribute('aria-disabled')).toBe('true');
    day('2026-11-24').click();
    await render();
    expect(fixture.componentInstance.value()).toBe('');
  });

  it('pinta o período da retirada até a devolução', async () => {
    await mount();
    fixture.componentInstance.start.set('2026-11-24');
    fixture.componentInstance.value.set('2026-11-28');
    await render();
    trigger().click();
    await render();
    expect(day('2026-11-24').className).toContain('on');
    expect(day('2026-11-26').className).toContain('in');
    expect(day('2026-11-28').className).toContain('on');
    expect(day('2026-11-29').className).not.toContain('in');
  });

  it('teclado: seta move o foco, PageDown troca de mês, Enter escolhe, Esc fecha', async () => {
    await mount();
    trigger().click();
    await render();
    key(day('2026-11-20'), 'ArrowRight');
    await render();
    expect(document.activeElement).toBe(day('2026-11-21'));
    key(day('2026-11-21'), 'ArrowDown');
    await render();
    expect(document.activeElement).toBe(day('2026-11-28'));
    key(day('2026-11-28'), 'PageDown');
    await render();
    expect(panel()!.textContent).toContain('Dezembro 2026');
    expect(document.activeElement).toBe(day('2026-12-28'));
    key(day('2026-12-28'), 'Enter');
    await render();
    expect(fixture.componentInstance.value()).toBe('2026-12-28');
    key(day('2026-12-28'), 'Escape');
    await render();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('um toque fora fecha', async () => {
    await mount();
    trigger().click();
    await render();
    (el().querySelector('#outside') as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await render();
    expect(panel()).toBeNull();
  });
});
