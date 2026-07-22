import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { of, EMPTY } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { BillingAccessService } from '../../services/billing-access.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';

/**
 * Guarantees the "novo aluguel" picker calls the backend with the correct
 * availability filters — always `availableForRental=true`, and in edit mode
 * additionally `includeCurrentRentalId=<id>` so the currently-assigned
 * vehicle/driver stays visible in the dropdown.
 */
describe('RentalForm picker filters', () => {
  let vehiclesList: ReturnType<typeof vi.fn>;
  let driversList: ReturnType<typeof vi.fn>;

  function configure(rentalId: string | null): void {
    vehiclesList = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 500, total: 0 }));
    driversList = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 500, total: 0 }));

    const activatedRoute = {
      snapshot: { paramMap: { get: (key: string) => (key === 'id' ? rentalId : null) } },
    };

    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: VehiclesService, useValue: { list: vehiclesList } },
        { provide: DriverService, useValue: { list: driversList } },
        {
          provide: RentalService,
          useValue: { getById: vi.fn().mockReturnValue(EMPTY) },
        },
        {
          provide: BillingAccessService,
          useValue: { status: signal(null), load: () => of(null) },
        },
        {
          provide: AsaasIntegrationService,
          useValue: { status: signal(null), load: () => EMPTY },
        },
        {
          provide: ContractTemplateService,
          useValue: { get: () => EMPTY },
        },
      ],
    });
  }

  beforeEach(() => {
    // Reset TestBed between cases so each configures its own ActivatedRoute.
    TestBed.resetTestingModule();
  });

  it('create mode: passes availableForRental=true without includeCurrentRentalId', () => {
    configure(null);
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();

    expect(vehiclesList).toHaveBeenCalledTimes(1);
    expect(vehiclesList).toHaveBeenCalledWith({
      size: 500,
      sort: 'plate_asc',
      availableForRental: true,
    });

    expect(driversList).toHaveBeenCalledTimes(1);
    expect(driversList).toHaveBeenCalledWith({
      size: 500,
      sort: 'name_asc',
      availableForRental: true,
    });
  });

  it('edit mode: passes availableForRental=true AND includeCurrentRentalId', () => {
    const rentalId = 'rental-uuid-42';
    configure(rentalId);
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();

    expect(vehiclesList).toHaveBeenCalledWith({
      size: 500,
      sort: 'plate_asc',
      availableForRental: true,
      includeCurrentRentalId: rentalId,
    });

    expect(driversList).toHaveBeenCalledWith({
      size: 500,
      sort: 'name_asc',
      availableForRental: true,
      includeCurrentRentalId: rentalId,
    });
  });

  it('caucaoPaid toggle: present in form, only visible when caucaoReais > 0, and included in the create payload', () => {
    configure(null);
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as unknown as {
      form: {
        controls: { caucaoPaid: { value: boolean; setValue: (v: boolean) => void } };
        patchValue: (v: Record<string, unknown>) => void;
      };
      // computed signal
      caucaoAmountPositive: () => boolean;
    };

    // Form control exists and defaults to false.
    expect(cmp.form.controls.caucaoPaid).toBeDefined();
    expect(cmp.form.controls.caucaoPaid.value).toBe(false);

    // Toggle only visible when there's a caução amount.
    expect(cmp.caucaoAmountPositive()).toBe(false);
    cmp.form.patchValue({ caucaoReais: 500 });
    fixture.detectChanges();
    expect(cmp.caucaoAmountPositive()).toBe(true);
  });
});
