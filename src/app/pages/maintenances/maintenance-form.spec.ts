import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MaintenanceForm } from './maintenance-form';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import type {
  CreateMaintenanceRequest,
  Maintenance,
  UpdateMaintenanceRequest,
} from '../../types/maintenance.types';

interface FormApi {
  patchValue: (value: Record<string, unknown>) => void;
  valid: boolean;
  invalid: boolean;
  controls: {
    hodometerReading: { markAsDirty: () => void; setValue: (v: number | null) => void };
  };
}

interface ExposedForm {
  form: FormApi;
  submit: () => void;
  hodometerRequired: () => boolean;
}

const BASE_VALUES = {
  vehicleId: 'veh-1',
  type: 'PREVENTIVE',
  description: 'Revisão dos 10.000 km',
  serviceDate: '2026-08-10',
  costReais: 350,
};

const DONE_MAINTENANCE: Maintenance = {
  id: 'mnt-1',
  createdDate: '2026-01-01T00:00:00Z',
  modifyDate: null,
  companyId: 'co-1',
  vehicleId: 'veh-1',
  type: 'PREVENTIVE',
  description: 'Troca de óleo',
  serviceDate: '2026-01-01',
  hodometerReading: 45000,
  costCents: 20000,
  provider: null,
  invoiceNumber: null,
  nextServiceDate: null,
  nextServiceHodometer: null,
  status: 'DONE',
  notes: null,
};

function configure(existing: Maintenance | null) {
  const create = vi.fn().mockReturnValue(EMPTY);
  const update = vi.fn().mockReturnValue(EMPTY);
  const getOne = vi.fn().mockReturnValue(existing ? of(existing) : EMPTY);

  const activatedRoute = {
    snapshot: {
      paramMap: { get: (key: string) => (key === 'id' && existing ? existing.id : null) },
    },
  };

  TestBed.configureTestingModule({
    imports: [MaintenanceForm],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: activatedRoute },
      { provide: MaintenancesService, useValue: { getOne, create, update, remove: vi.fn() } },
      {
        provide: VehiclesService,
        useValue: {
          list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 })),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(MaintenanceForm);
  fixture.detectChanges();
  return {
    fixture,
    create,
    update,
    component: fixture.componentInstance as unknown as ExposedForm,
  };
}

describe('MaintenanceForm — hodômetro condicional ao status', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('permite manutenção agendada sem hodômetro e envia status SCHEDULED', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'SCHEDULED' });
    fixture.detectChanges();

    expect(component.hodometerRequired()).toBe(false);
    expect(component.form.valid).toBe(true);

    component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0] as CreateMaintenanceRequest;
    expect(payload.status).toBe('SCHEDULED');
    expect(payload.hodometerReading).toBeNull();
  });

  it('bloqueia manutenção realizada sem hodômetro', () => {
    const { fixture, component, create } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'DONE' });
    fixture.detectChanges();

    expect(component.hodometerRequired()).toBe(true);
    expect(component.form.invalid).toBe(true);

    component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('volta a aceitar null quando o status muda de DONE para CANCELED', () => {
    const { fixture, component } = configure(null);

    component.form.patchValue({ ...BASE_VALUES, status: 'DONE' });
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);

    component.form.patchValue({ status: 'CANCELED' });
    fixture.detectChanges();
    expect(component.hodometerRequired()).toBe(false);
    expect(component.form.valid).toBe(true);
  });

  it('no PUT preserva a leitura já gravada quando o campo não foi tocado', () => {
    const { component, update } = configure(DONE_MAINTENANCE);

    component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][1] as UpdateMaintenanceRequest;
    expect(payload.hodometerReading).toBe(45000);
    expect(payload.status).toBe('DONE');
  });

  it('no PUT envia null quando o usuário limpa o campo de uma manutenção não realizada', () => {
    const scheduled: Maintenance = {
      ...DONE_MAINTENANCE,
      status: 'SCHEDULED',
      hodometerReading: 45000,
    };
    const { fixture, component, update } = configure(scheduled);

    component.form.controls.hodometerReading.setValue(null);
    component.form.controls.hodometerReading.markAsDirty();
    fixture.detectChanges();

    component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][1] as UpdateMaintenanceRequest;
    expect(payload.hodometerReading).toBeNull();
    expect(payload.status).toBe('SCHEDULED');
  });
});
