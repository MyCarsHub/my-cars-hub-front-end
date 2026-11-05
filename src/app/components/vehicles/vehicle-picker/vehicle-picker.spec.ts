import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetFinanceService } from '../../../services/fleet-finance.service';
import type { VehiclePickerFilter } from '../../../types/fleet-finance.types';
import type { VehicleListItem } from '../../../types/vehicle.types';
import { PICKER_DEBOUNCE_MS, VehiclePicker } from './vehicle-picker';

function vehicle(id: string, plate: string): VehicleListItem {
  return {
    id,
    plate,
    type: 'CAR',
    brand: 'Fiat',
    model: 'Mobi',
    yearModel: 2024,
    licensingExpiration: null,
    status: 'AVAILABLE',
    createdDate: '2025-01-01',
    sold: false,
  } as VehicleListItem;
}

describe('VehiclePicker', () => {
  const filter: VehiclePickerFilter = { kind: 'withoutActiveInsurance' };
  let pickVehicles: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<VehiclePicker>;

  const el = () => fixture.nativeElement as HTMLElement;

  function render(): void {
    fixture = TestBed.createComponent(VehiclePicker);
    fixture.componentRef.setInput('filter', filter);
    fixture.detectChanges();
  }

  beforeEach(() => {
    pickVehicles = vi.fn();
    TestBed.configureTestingModule({
      imports: [VehiclePicker],
      providers: [{ provide: FleetFinanceService, useValue: { pickVehicles } }],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('asks the server only for the vehicles the filter allows and lists them', () => {
    pickVehicles.mockReturnValue(
      of({ content: [vehicle('v1', 'ABC1D23'), vehicle('v2', 'XYZ9876')], page: 0, size: 50, total: 2 }),
    );
    render();

    expect(pickVehicles).toHaveBeenCalledWith(filter, '');
    const options = el().querySelectorAll('[data-testid="picker-option"]');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toContain('ABC-1D23');
  });

  it('emits the vehicle that was tapped', () => {
    pickVehicles.mockReturnValue(of({ content: [vehicle('v1', 'ABC1D23')], page: 0, size: 50, total: 1 }));
    render();
    const picked = vi.fn();
    fixture.componentInstance.picked.subscribe(picked);

    el().querySelector<HTMLButtonElement>('[data-testid="picker-option"]')!.click();

    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));
  });

  it('searches after the debounce, once per settled term', () => {
    vi.useFakeTimers();
    pickVehicles.mockReturnValue(of({ content: [], page: 0, size: 50, total: 0 }));
    render();

    const input = el().querySelector<HTMLInputElement>('[data-testid="picker-search"]')!;
    input.value = 'AB';
    input.dispatchEvent(new Event('input'));
    input.value = 'ABC';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(PICKER_DEBOUNCE_MS);

    expect(pickVehicles).toHaveBeenCalledTimes(2);
    expect(pickVehicles).toHaveBeenLastCalledWith(filter, 'ABC');
  });

  it('says so when every vehicle already has it', () => {
    pickVehicles.mockReturnValue(of({ content: [], page: 0, size: 50, total: 0 }));
    render();
    fixture.componentRef.setInput('emptyText', 'Todos já têm apólice.');
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="picker-empty"]')?.textContent).toContain(
      'Todos já têm apólice.',
    );
  });

  it('shows the error inline and retries on demand', () => {
    pickVehicles.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Falhou.' } })),
    );
    render();
    expect(el().querySelector('[data-testid="picker-error"]')).not.toBeNull();

    pickVehicles.mockReturnValue(of({ content: [vehicle('v1', 'ABC1D23')], page: 0, size: 50, total: 1 }));
    el().querySelector<HTMLButtonElement>('[data-testid="picker-error"] button')!.click();
    fixture.detectChanges();

    expect(el().querySelectorAll('[data-testid="picker-option"]').length).toBe(1);
  });

  it('tells how many were left out when the page is not the whole answer', () => {
    pickVehicles.mockReturnValue(of({ content: [vehicle('v1', 'ABC1D23')], page: 0, size: 1, total: 7 }));
    render();
    expect(el().querySelector('[data-testid="picker-more"]')?.textContent).toContain('1 de 7');
  });
});
