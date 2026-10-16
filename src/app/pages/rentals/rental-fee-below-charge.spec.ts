import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, EMPTY, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';
import { SessionService } from '../../services/session.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';

/** FIX-0754: a regra 'multa fixa < cobranca' e do backend; so o codigo do servidor cai no campo. */
describe('RentalForm — encargo em R$ abaixo do valor da cobranca (FIX-0750)', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>;
  let createSpy: ReturnType<typeof vi.fn>;

  type FormLike = {
    form: { patchValue: (v: Record<string, unknown>) => void };
    submit: () => void;
  };

  const FINE_ERR = '#rental-late-fine-value-error';

  function mount(): void {
    TestBed.resetTestingModule();
    createSpy = vi.fn().mockReturnValue(of({ id: 'novo' }));
    const store = new Map<string, string>();
    const emptyPage = { content: [], page: 0, size: 500, total: 0 };
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        {
          provide: SessionService,
          useValue: {
            setItem: (k: string, v: string) => store.set(k, v),
            getItem: (k: string) => store.get(k) ?? null,
            removeItem: (k: string) => store.delete(k),
            getCompanyRoleFromToken: () => 'OWNER',
          },
        },
        { provide: VehiclesService, useValue: { list: () => of(emptyPage) } },
        { provide: DriverService, useValue: { list: () => of(emptyPage) } },
        { provide: RentalService, useValue: { getById: () => EMPTY, preflight: () => EMPTY, create: createSpy } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
  }

  function cmp(): FormLike {
    return fixture.componentInstance as unknown as FormLike;
  }

  function patch(v: Record<string, unknown>): void {
    cmp().form.patchValue(v);
    fixture.detectChanges();
  }

  function el<T extends Element>(sel: string): T | null {
    return fixture.nativeElement.querySelector(sel) as T | null;
  }

  function text(sel: string): string | null {
    return el(sel)?.textContent?.trim() ?? null;
  }

  function submitButton(): HTMLButtonElement {
    return el<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement;
  }

  /** Digita no campo pelo EVENTO de input (o caminho do usuario, com a mascara). */
  function typeInto(id: string, value: string): void {
    const input = el<HTMLInputElement>(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    fixture.detectChanges();
  }

  const VALID = {
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    billingFrequency: 'DAILY',
    caucaoReais: '',
    initialKm: 1,
    pickupDate: '2026-08-01T09:00',
    firstPaymentDate: '2026-08-05',
    periodRateReais: '100,00',
  };

  beforeEach(() => mount());

  it('a regra e do backend: multa fixa maior que a cobranca NAO bloqueia o botao nem o submit', () => {
    patch({ ...VALID, periodRateReais: '10,00', lateFineType: 'FIXED', lateFineValueInput: '' });
    typeInto('#rental-late-fine-value', '50,00');

    expect(text(FINE_ERR)).toBeNull();
    expect(submitButton().disabled).toBe(false);
    cmp().submit();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('erro 400 do servidor cai no MESMO campo com a mensagem do servidor (multa)', () => {
    patch({ ...VALID, lateFineType: 'FIXED', lateFineValueInput: '2,00' });
    const message = 'A multa fixa (R$ 50,00) deve ser menor que o valor da cobrança (R$ 10,00).';
    createSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'LATE_FINE_NOT_BELOW_CHARGE',
              message,
              fieldErrors: { lateFineValue: message },
            },
          }),
      ),
    );
    cmp().submit();
    fixture.detectChanges();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(text(FINE_ERR)).toBe(message);
  });
});
