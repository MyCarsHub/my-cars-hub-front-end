import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { VehicleIcon, type VehicleIconName } from './vehicle-icon';

const NAMES: VehicleIconName[] = [
  'fine', 'money', 'card', 'insurance', 'inspection', 'maintenance', 'key', 'car', 'document',
  'pen', 'pause', 'tag', 'check', 'plus', 'user', 'calendar', 'clock', 'alert', 'wrench', 'shield',
  'camera', 'swap', 'x', 'map-pin',
];

@Component({
  imports: [VehicleIcon],
  template: `<app-vehicle-icon [name]="name()" />`,
})
class Host {
  name = signal<VehicleIconName>('fine');
}

describe('VehicleIcon', () => {
  it('draws something and stays decorative for every name', () => {
    const fixture = TestBed.createComponent(Host);
    for (const name of NAMES) {
      fixture.componentInstance.name.set(name);
      fixture.detectChanges();
      const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
      expect(svg.getAttribute('aria-hidden'), name).toBe('true');
      expect(svg.children.length, name).toBeGreaterThan(0);
    }
  });

  it('gives the board names a drawing (map-pin and clock for the photo lines)', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.name.set('map-pin');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('svg circle').length).toBe(1);
    fixture.componentInstance.name.set('clock');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg path')).not.toBeNull();
  });
});
