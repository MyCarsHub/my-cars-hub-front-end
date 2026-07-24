import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of, EMPTY } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DriverForm } from './driver-form';
import { DriverService } from '../../services/driver.service';
import { CepService } from '../../services/cep.service';
import type { DriverResponse } from '../../types/driver.types';

/**
 * Covers the RG mask behavior:
 *  - typing 9 digits produces "XX.XXX.XXX-X" in the display signal;
 *  - the form control holds ONLY digits;
 *  - loading an existing driver with digits-only RG re-formats for display.
 */
describe('DriverForm — RG mask', () => {
  function configure(driver: DriverResponse | null): {
    createSpy: ReturnType<typeof vi.fn>;
    updateSpy: ReturnType<typeof vi.fn>;
  } {
    const createSpy = vi.fn().mockReturnValue(EMPTY);
    const updateSpy = vi.fn().mockReturnValue(EMPTY);
    const getOne = vi.fn().mockReturnValue(driver ? of(driver) : EMPTY);

    const activatedRoute = {
      snapshot: { paramMap: { get: (key: string) => (key === 'id' && driver ? driver.id : null) } },
    };

    TestBed.configureTestingModule({
      imports: [DriverForm],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: activatedRoute },
        { provide: DriverService, useValue: { getOne, create: createSpy, update: updateSpy } },
        { provide: CepService, useValue: { lookup: vi.fn().mockReturnValue(of(null)) } },
      ],
    });

    return { createSpy, updateSpy };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('formats display as XX.XXX.XXX-X while form control keeps only digits', () => {
    configure(null);
    const fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onRgInput: (e: Event) => void;
      rgDisplay: () => string;
      form: { get: (path: string) => { value: string } | null };
    };

    const input = document.createElement('input');
    input.value = '123456789';
    const evt = { target: input } as unknown as Event;
    component.onRgInput(evt);

    expect(component.rgDisplay()).toBe('12.345.678-9');
    expect(component.form.get('rg')?.value).toBe('123456789');
  });

  it('strips non-digits from pasted input and truncates at 10', () => {
    configure(null);
    const fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onRgInput: (e: Event) => void;
      rgDisplay: () => string;
      form: { get: (path: string) => { value: string } | null };
    };

    const input = document.createElement('input');
    input.value = '12.345.678-9AB99';
    component.onRgInput({ target: input } as unknown as Event);

    expect(component.form.get('rg')?.value).toBe('1234567899');
    expect(component.rgDisplay()).toBe('12.345.678-99');
  });

  it('formats display when loading an existing driver whose rg is digits-only', () => {
    const driver: DriverResponse = {
      id: 'drv-1',
      createdDate: '2025-01-01T00:00:00Z',
      modifyDate: null,
      companyId: 'co-1',
      userId: null,
      name: 'Fulano',
      rg: '123456789',
      document: { type: 'CPF', value: '52998224725' },
      address: {
        street: 'Rua A', number: '10', complement: null,
        district: 'Centro', cep: '01001000', city: 'SP', uf: 'SP',
      },
      contact: { email: 'a@b.com', phone: '11987654321' },
      licenseNumber: 'ABC12345678',
      licenseCategory: 'B',
      licenseExpiry: '2030-01-01',
      status: 'AVAILABLE',
    };
    configure(driver);

    const fixture = TestBed.createComponent(DriverForm);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      rgDisplay: () => string;
      form: { get: (path: string) => { value: string } | null };
    };

    expect(component.rgDisplay()).toBe('12.345.678-9');
    expect(component.form.get('rg')?.value).toBe('123456789');
  });
});
