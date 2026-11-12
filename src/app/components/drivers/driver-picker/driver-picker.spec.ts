import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { DriverPicker, DriverPickerItem, filterDrivers } from './driver-picker';

const DRIVERS: DriverPickerItem[] = [
  { id: 'd1', name: 'João Conceição' },
  { id: 'd2', name: 'Rafael Souza' },
];

describe('filterDrivers', () => {
  it('busca vazia devolve todos', () => {
    expect(filterDrivers(DRIVERS, '  ').map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('ignora acento e caixa', () => {
    expect(filterDrivers(DRIVERS, 'joao conce').map((d) => d.id)).toEqual(['d1']);
    expect(filterDrivers(DRIVERS, 'RAFA').map((d) => d.id)).toEqual(['d2']);
  });
});

describe('DriverPicker', () => {
  function setup(drivers: DriverPickerItem[], selectedId = '') {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(DriverPicker);
    fixture.componentRef.setInput('drivers', drivers);
    fixture.componentRef.setInput('selectedId', selectedId);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('emite o motorista tocado e marca o escolhido', () => {
    const { fixture, el } = setup(DRIVERS, 'd2');
    let picked: DriverPickerItem | null = null;
    fixture.componentInstance.picked.subscribe((d) => (picked = d));
    const options = el.querySelectorAll<HTMLButtonElement>('[data-testid="driver-picker-option"]');
    expect(options[1].getAttribute('aria-current')).toBe('true');
    expect(options[0].getAttribute('aria-current')).toBeNull();
    options[0].click();
    expect(picked).toEqual(DRIVERS[0]);
  });

  it('filtra pela busca e avisa quando nada casa', () => {
    const { fixture, el } = setup(DRIVERS);
    const search = el.querySelector('[data-testid="driver-picker-search"]') as HTMLInputElement;
    expect(search.className).toMatch(/\btext-base\b/);
    search.value = 'xyz';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="driver-picker-option"]').length).toBe(0);
    expect(el.textContent).toContain('Nenhum motorista encontrado');
  });
});
