import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { EMPTY, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';
import { CompanyContactGate } from '../../services/company-contact-gate.service';
import { SessionService } from '../../services/session.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';
import { SERVER_ERROR_KEY } from '../../services/validation-messages';

/**
 * "Bloquear sempre" (dono, 21/11) no formulário antigo: quem tem aluguel em aberto aparece desabilitado
 * na lista, com o motivo; a escolha presa (rascunho) ganha o erro no campo; o 409 do servidor vai ao
 * campo; e na edição o motorista/carro do PRÓPRIO aluguel nunca se bloqueia.
 */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FREE_DRIVER = { id: 'drv-free', name: 'Ana Livre', status: 'AVAILABLE', openRental: null };
const BUSY_DRIVER = {
  id: 'drv-busy',
  name: 'Bruno Ocupado',
  status: 'WORKING',
  openRental: { status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' },
};
const FREE_VEHICLE = { id: 'veh-free', plate: 'AAA1A11', brand: 'Fiat', model: 'Mobi', sold: false, openRental: null };
const BUSY_VEHICLE = {
  id: 'veh-busy',
  plate: 'BBB2B22',
  brand: 'Fiat',
  model: 'Argo',
  sold: false,
  openRental: { status: 'RESERVED', startDate: '2027-01-10', endDate: '2027-02-07' },
};

let store: Map<string, string>;
let getById: () => Observable<unknown>;

function mount(rentalId: string | null = null): { fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>; cmp: Any } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RentalForm],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (k: string) => (k === 'id' ? rentalId : null) } } } },
      {
        provide: SessionService,
        useValue: {
          setItem: (k: string, v: string) => store.set(k, v),
          getItem: (k: string) => store.get(k) ?? null,
          removeItem: (k: string) => store.delete(k),
          getCompanyRoleFromToken: () => 'OWNER',
        },
      },
      { provide: VehiclesService, useValue: { list: () => of({ content: [FREE_VEHICLE, BUSY_VEHICLE], page: 0, size: 500, total: 2 }) } },
      { provide: DriverService, useValue: { list: () => of({ content: [FREE_DRIVER, BUSY_DRIVER], page: 0, size: 500, total: 2 }) } },
      { provide: CompanyContactGate, useValue: { ensureComplete: () => of(true) } },
      { provide: RentalService, useValue: { getById: () => getById(), preflight: () => EMPTY, create: vi.fn() } },
      { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
      { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
    ],
  });
  const fixture = TestBed.createComponent(RentalForm);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance as unknown as Any };
}

function option(fixture: ReturnType<typeof TestBed.createComponent<RentalForm>>, id: string): HTMLOptionElement {
  return (fixture.nativeElement as HTMLElement).querySelector(`option[value="${id}"]`) as HTMLOptionElement;
}

describe('RentalForm — motorista/carro com aluguel em aberto', () => {
  beforeEach(() => {
    store = new Map<string, string>();
    store.set('id', 'user-1');
    store.set('selectedCompanyId', 'company-1');
    getById = () => EMPTY;
  });

  it('na lista, quem está preso aparece desabilitado com o motivo; o livre segue normal', () => {
    const { fixture } = mount();

    const busyDriver = option(fixture, 'drv-busy');
    expect(busyDriver.disabled).toBe(true);
    expect(busyDriver.getAttribute('aria-disabled')).toBe('true');
    expect(busyDriver.textContent).toContain('Em aluguel até 30/11');

    const busyCar = option(fixture, 'veh-busy');
    expect(busyCar.disabled).toBe(true);
    expect(busyCar.textContent).toContain('Reservado de 10/01 a 07/02');

    expect(option(fixture, 'drv-free').disabled).toBe(false);
    expect(option(fixture, 'drv-free').getAttribute('aria-disabled')).toBeNull();
    expect(option(fixture, 'veh-free').disabled).toBe(false);
  });

  it('rascunho com motorista que agora está preso: o campo mostra o erro em vez de seguir quieto', () => {
    store.set(
      'rentalDraft:user-1:company-1',
      JSON.stringify({ v: 1, userId: 'user-1', companyId: 'company-1', value: { driverId: 'drv-busy', vehicleId: 'veh-free' } }),
    );
    const { cmp } = mount();

    expect(cmp['draftRestored']()).toBe(true);
    expect(cmp['form'].controls.driverId.value).toBe('drv-busy');
    const control = cmp['form'].controls.driverId;
    expect(control.errors?.[SERVER_ERROR_KEY]?.message).toBe(
      'Este motorista já está em um aluguel (ativo até 30/11). Conclua ou cancele esse aluguel antes de criar outro.',
    );
    expect(control.touched).toBe(true);
    expect(cmp['form'].invalid).toBe(true);
  });

  it('409 DRIVER_HAS_OPEN_RENTAL ao criar: a mensagem do servidor vai ao campo, sem banner', () => {
    const { cmp } = mount();
    cmp['form'].controls.driverId.setValue('drv-free');
    const err = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Este motorista já tem um aluguel reservado de 10/01 a 07/02. Conclua ou cancele esse aluguel antes de criar outro.',
        code: 'DRIVER_HAS_OPEN_RENTAL',
        fieldErrors: { driverId: 'x' },
      },
    });

    cmp['failCreate'](err, 'Não foi possível criar o aluguel.');

    expect(cmp['form'].controls.driverId.errors?.[SERVER_ERROR_KEY]?.message).toContain('reservado de 10/01 a 07/02');
    expect(cmp['error']()).toBeNull();
  });

  it('409 VEHICLE_HAS_OPEN_RENTAL na edição também vai ao campo do carro', () => {
    const { cmp } = mount();
    const err = new HttpErrorResponse({
      status: 409,
      error: { message: 'Este carro já está reservado de 10/01 a 07/02. Conclua ou cancele esse aluguel antes de criar outro.', code: 'VEHICLE_HAS_OPEN_RENTAL' },
    });

    expect(cmp['claimOpenRentalConflict'](err)).toBe(true);
    expect(cmp['form'].controls.vehicleId.errors?.[SERVER_ERROR_KEY]?.message).toContain('Este carro já está reservado');
    expect(cmp['claimOpenRentalConflict'](new HttpErrorResponse({ status: 409, error: { code: 'OTHER', message: 'x' } }))).toBe(false);
  });

  it('edição: o motorista e o carro do PRÓPRIO aluguel nunca se bloqueiam, mesmo com outro aluguel antigo', () => {
    getById = () =>
      of({
        id: 'rental-1',
        status: 'RESERVED',
        vehicleId: 'veh-busy',
        driverId: 'drv-busy',
        startDate: '2026-12-01',
        endDate: '2026-12-10',
        periodRate: 10000,
        caucaoAmount: 0,
        billingFrequency: 'DAILY',
        lateFineType: 'PERCENT',
        lateFineValue: 0,
        lateInterestPercentPerMonth: 1,
      });
    const { fixture, cmp } = mount('rental-1');
    fixture.detectChanges();

    expect(option(fixture, 'drv-busy').disabled).toBe(false);
    expect(option(fixture, 'veh-busy').disabled).toBe(false);
    expect(cmp['form'].controls.driverId.errors?.[SERVER_ERROR_KEY]).toBeUndefined();
    expect(cmp['form'].controls.vehicleId.errors?.[SERVER_ERROR_KEY]).toBeUndefined();
  });
});
