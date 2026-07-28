import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { StatTile, StatTileTone } from './stat-tile';

@Component({
  imports: [StatTile],
  template: `
    <app-stat-tile
      [label]="label"
      [value]="value"
      [hint]="hint"
      [labelNote]="labelNote"
      [tone]="tone"
    >
      <span data-testid="footer">rodapé</span>
    </app-stat-tile>
  `,
})
class HostComponent {
  label = 'Total investido';
  value = 'R$ 1.234,56';
  hint: string | null = 'Compra + manutenções';
  labelNote: string | null = '(sem financiamento)';
  tone: StatTileTone = 'brand';
}

describe('StatTile', () => {
  it('renders label, value, hint, label note and projected footer', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Total investido');
    expect(text).toContain('R$ 1.234,56');
    expect(text).toContain('Compra + manutenções');
    expect(text).toContain('(sem financiamento)');
    expect(fixture.debugElement.query(By.css('[data-testid="footer"]'))).not.toBeNull();
  });

  it('omits the hint paragraph when hint is null', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hint = null;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Compra + manutenções');
  });

  it('keeps the value large + bold so Signal Orange passes AA', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const value = fixture.debugElement.query(By.css('p.tabular-nums')).nativeElement as HTMLElement;
    expect(value.className).toContain('text-xl');
    expect(value.className).toContain('font-bold');
    expect(value.className).toContain('text-primary-500');
  });

  it('maps tone to the matching AA-safe color class', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tone = 'positive';
    fixture.detectChanges();

    const value = fixture.debugElement.query(By.css('p.tabular-nums')).nativeElement as HTMLElement;
    expect(value.className).toContain('text-success-700');
  });
});
