import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DateField, todayInSaoPaulo } from './date-field';

@Component({
  imports: [DateField],
  template: `<app-date-field label="Recebido em" hint="Dica" [max]="max()" [min]="min()" [(value)]="value" />`,
})
class Host {
  readonly max = signal<string | null>('2026-10-29');
  readonly min = signal<string | null>('2026-10-01');
  readonly value = signal('2026-10-28');
  readonly field = viewChild.required(DateField);
}

describe('DateField', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [Host] });
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('input nativo de data, 16px, com min/max e rótulo associado', () => {
    const el: HTMLElement = render().nativeElement;
    const input = el.querySelector('[data-testid="date-field-input"]') as HTMLInputElement;

    expect(input.type).toBe('date');
    expect(input.className).toContain('text-base');
    expect(input.getAttribute('max')).toBe('2026-10-29');
    expect(input.getAttribute('min')).toBe('2026-10-01');
    expect(el.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('Recebido em');
    expect(el.querySelector('[data-testid="date-field-help"]')?.textContent).toContain('Dica');
  });

  it('digitar atualiza o pai; data futura vira erro em texto e valid=false', () => {
    const fixture = render();
    const input = fixture.nativeElement.querySelector('[data-testid="date-field-input"]') as HTMLInputElement;

    input.value = '2026-10-30';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('2026-10-30');
    expect(fixture.componentInstance.field().valid()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="date-field-help"]')?.textContent)
      .toContain('depois de 29/10/2026');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('antes do mínimo e vazio também são inválidos', () => {
    const fixture = render();
    fixture.componentInstance.value.set('2026-09-30');
    fixture.detectChanges();
    expect(fixture.componentInstance.field().valid()).toBe(false);

    fixture.componentInstance.value.set('');
    fixture.detectChanges();
    expect(fixture.componentInstance.field().error()).toBe('Informe a data.');
  });

  it('"hoje" é o dia de São Paulo, não o de UTC', () => {
    // 30/10 02:30 UTC ainda é 29/10 em São Paulo.
    expect(todayInSaoPaulo(new Date('2026-10-30T02:30:00Z'))).toBe('2026-10-29');
  });
});
