import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { PaidByField } from './paid-by-field';
import { PaidByBadge } from './paid-by-badge';
import { ExpensePaidBy } from '../../types/expense-paid-by.types';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaidByField, PaidByBadge],
  template: `
    <app-paid-by-field [control]="control" />
    <app-paid-by-badge [paidBy]="badgeValue()" />
  `,
})
class Host {
  readonly control = new FormControl<ExpensePaidBy>('COMPANY', { nonNullable: true });
  readonly badgeValue = signal<ExpensePaidBy | null | undefined>(undefined);
}

describe('PaidByField / PaidByBadge (V123 — Quem pagou?)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  const radios = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const checked = () => radios().find((r) => r.getAttribute('aria-checked') === 'true');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows the pt-BR question and the three options, Locadora first and selected by default', () => {
    expect(el.textContent).toContain('Quem pagou?');
    expect(radios().map((r) => r.textContent?.trim())).toEqual(['Locadora', 'Motorista', 'Dono']);
    expect(checked()?.textContent?.trim()).toBe('Locadora');
  });

  it('labels the radiogroup with the visible question', () => {
    const group = el.querySelector('[role="radiogroup"]')!;
    const labelId = group.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(el.querySelector(`#${labelId}`)?.textContent).toContain('Quem pagou?');
  });

  it('writes DRIVER into the form control on click and marks it dirty', async () => {
    radios()[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.control.value).toBe('DRIVER');
    expect(host.control.dirty).toBe(true);
    expect(checked()?.textContent?.trim()).toBe('Motorista');
    expect(el.textContent).toContain('não é descontado do faturamento');
  });

  it('writes OWNER on click of Dono, with the owner hint', async () => {
    radios()[2].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.control.value).toBe('OWNER');
    expect(checked()?.textContent?.trim()).toBe('Dono');
    expect(el.textContent).toContain('Pago pelo dono do veículo');
  });

  it('reflects a value patched from outside (edit mode loading the stored marking)', async () => {
    host.control.setValue('DRIVER');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(checked()?.textContent?.trim()).toBe('Motorista');
  });

  it('uses a 16px (text-base) option font so iOS does not zoom on focus', () => {
    for (const r of radios()) {
      expect(r.className).toContain('text-base');
      expect(r.className).not.toContain('text-sm');
    }
  });

  it('badge renders only for DRIVER and OWNER, with the matching copy', async () => {
    expect(el.textContent).not.toContain('Pago pelo motorista');

    host.badgeValue.set('COMPANY');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Pago pelo motorista');

    host.badgeValue.set('DRIVER');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.textContent).toContain('Pago pelo motorista');

    host.badgeValue.set('OWNER');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.textContent).toContain('Pago pelo dono');
    expect(el.textContent).not.toContain('Pago pelo motorista');
  });
});
