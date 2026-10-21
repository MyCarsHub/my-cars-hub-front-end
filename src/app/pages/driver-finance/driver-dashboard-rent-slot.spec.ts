import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverRentalChargesService } from '../../services/driver-rental-charges.service';
import { DriverDashboard } from './driver-dashboard';
import { DRIVER_FINANCE_TODAY, DriverFinanceSource } from './driver-finance.source';
import { FakeFinanceSource, TODAY } from './driver-finance.testing';

/**
 * The «Aluguel da semana» slot of the Dashboard is the production card of Meu aluguel
 * (`app-driver-next-charge`), fed by the active rental's id; without a rental there is no card.
 */
describe('DriverDashboard — «Aluguel da semana»', () => {
  let source: FakeFinanceSource;
  const charges = { list: vi.fn(() => of([])) };

  function mount() {
    TestBed.configureTestingModule({
      imports: [DriverDashboard],
      providers: [
        provideRouter([]),
        { provide: DriverFinanceSource, useValue: source },
        { provide: DRIVER_FINANCE_TODAY, useValue: () => TODAY },
        { provide: DriverRentalChargesService, useValue: charges },
      ],
    });
    const fixture = TestBed.createComponent(DriverDashboard);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    source = new FakeFinanceSource();
    charges.list.mockClear();
    document.body.innerHTML = '';
  });

  it('com aluguel ativo, mostra o card de produção e lê as cobranças daquele aluguel', () => {
    source.contextValue = {
      firstName: 'Carlos',
      licenseExpiry: null,
      rental: {
        rentalId: 'rental-1',
        vehicleLabel: 'Mobi',
        plate: null,
        periodAmount: 70000,
        periodDays: 7,
        startDate: '2026-10-01',
        nextCharge: null,
        charges: [],
      },
    };
    const host = mount();
    expect(host.querySelector('app-driver-next-charge[data-cover]')).not.toBeNull();
    expect(host.querySelector('app-driver-rent-cover-card')).toBeNull();
    expect(charges.list).toHaveBeenCalledWith('rental-1');
  });

  it('sem aluguel, não há card', () => {
    const host = mount();
    expect(host.querySelector('app-driver-next-charge')).toBeNull();
    expect(charges.list).not.toHaveBeenCalled();
  });
});
