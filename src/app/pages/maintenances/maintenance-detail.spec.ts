import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MaintenanceDetail } from './maintenance-detail';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import type { Maintenance } from '../../types/maintenance.types';

const SCHEDULED: Maintenance = {
  id: 'mnt-1',
  createdDate: '2026-01-01T00:00:00Z',
  modifyDate: null,
  companyId: 'co-1',
  vehicleId: 'veh-1',
  type: 'PREVENTIVE',
  description: 'Revisão agendada',
  serviceDate: '2026-09-01',
  hodometerReading: null,
  costCents: 0,
  provider: null,
  invoiceNumber: null,
  nextServiceDate: null,
  nextServiceHodometer: null,
  status: 'SCHEDULED',
  notes: null,
};

function render(item: Maintenance) {
  TestBed.configureTestingModule({
    imports: [MaintenanceDetail],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => item.id } } } },
      {
        provide: MaintenancesService,
        useValue: { getOne: vi.fn().mockReturnValue(of(item)), remove: vi.fn() },
      },
      { provide: VehiclesService, useValue: { getOne: vi.fn().mockReturnValue(EMPTY) } },
    ],
  });

  const fixture = TestBed.createComponent(MaintenanceDetail);
  fixture.detectChanges();
  return fixture;
}

describe('MaintenanceDetail — hodômetro nulo', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('mostra "Não informado" quando hodometerReading é null', () => {
    const fixture = render(SCHEDULED);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Não informado');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('null');
  });

  it('formata o valor quando presente', () => {
    const fixture = render({ ...SCHEDULED, hodometerReading: 45000, status: 'DONE' });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('km');
    expect(text).not.toContain('Não informado');
  });
});
