import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyContactGate } from '../../services/company-contact-gate.service';
import { DriverService } from '../../services/driver.service';
import { SessionService } from '../../services/session.service';
import { VehiclesService } from '../../services/vehicles.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';
import { RentalForm } from './rental-form';
import { RentalService } from './rental.service';

/**
 * FEAT-0563 — a criação de aluguel passa pela porta do contato da locadora: o aviso abre ANTES do
 * create, o formulário fica intacto atrás dele, e depois de completar o MESMO aluguel segue.
 */
describe('RentalForm — contato da locadora (FEAT-0563)', () => {
  const VEHICLE = { id: 'veh-1', plate: 'AAA1A11', type: 'CAR', brand: 'Fiat', model: 'Mobi', yearModel: 2022,
    licensingExpiration: null, status: 'AVAILABLE', createdDate: '2026-01-01' };
  const DRIVER = { id: 'drv-1', name: 'Ana', email: null, phone: null, licenseNumber: '1', licenseCategory: 'B',
    licenseExpiry: '2030-01-01', status: 'AVAILABLE' };
  const VALID = {
    vehicleId: 'veh-1', driverId: 'drv-1', startDate: '2026-08-01', endDate: '2026-08-31',
    billingFrequency: 'MONTHLY', periodRateReais: '2.500,00', caucaoReais: '800,00', notes: 'n',
    initialKm: 42000, pickupDate: '2026-08-01T09:00', firstPaymentDate: '2026-08-05',
    lateInterestPercent: '1,50', lateFineType: 'PERCENT', lateFineValueInput: 2,
  };

  type FormLike = { form: { patchValue: (v: Record<string, unknown>) => void; getRawValue: () => Record<string, unknown> }; submit: () => void };

  let create: ReturnType<typeof vi.fn>;
  let ensureComplete: ReturnType<typeof vi.fn>;

  function visit() {
    TestBed.resetTestingModule();
    const store = new Map<string, string>([['id', 'u1'], ['selectedCompanyId', 'c1']]);
    TestBed.configureTestingModule({
      imports: [RentalForm],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: SessionService, useValue: {
          setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null,
          removeItem: (k: string) => store.delete(k), getCompanyRoleFromToken: () => 'OWNER' } },
        { provide: VehiclesService, useValue: { list: () => of({ content: [VEHICLE], page: 0, size: 500, total: 1 }) } },
        { provide: DriverService, useValue: { list: () => of({ content: [DRIVER], page: 0, size: 500, total: 1 }) } },
        { provide: CompanyContactGate, useValue: { ensureComplete } },
        { provide: RentalService, useValue: { getById: () => EMPTY, preflight: () => EMPTY, create } },
        { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => EMPTY } },
        { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(RentalForm);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as unknown as FormLike;
    cmp.form.patchValue(VALID);
    fixture.detectChanges();
    return { fixture, cmp };
  }

  beforeEach(() => {
    create = vi.fn().mockReturnValue(of({ id: 'rental-novo' }));
    ensureComplete = vi.fn().mockReturnValue(of(true));
  });

  it('com o contato completo, cria como antes (a porta só pergunta)', () => {
    const { cmp } = visit();
    cmp.submit();
    expect(ensureComplete).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('com o contato incompleto, NÃO cria enquanto o aviso está aberto e mantém o formulário intacto', () => {
    const answer = new Subject<boolean>();
    ensureComplete.mockReturnValue(answer);
    const { cmp, fixture } = visit();
    cmp.submit();
    fixture.detectChanges();
    expect(create).not.toHaveBeenCalled();
    expect(cmp.form.getRawValue()).toMatchObject({ vehicleId: 'veh-1', driverId: 'drv-1', periodRateReais: '2.500,00' });
  });

  it('depois de completar no aviso, o MESMO aluguel segue com o mesmo corpo', () => {
    const answer = new Subject<boolean>();
    ensureComplete.mockReturnValue(answer);
    const { cmp } = visit();
    cmp.submit();
    answer.next(true);
    answer.complete();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ vehicleId: 'veh-1', driverId: 'drv-1', startDate: '2026-08-01' });
  });

  it('se o usuário sai do aviso sem preencher, nada é criado', () => {
    ensureComplete.mockReturnValue(of(false));
    const { cmp } = visit();
    cmp.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('fallback: o 400 COMPANY_CONTACT_INCOMPLETE do servidor abre o aviso e, ao completar, repete o create', () => {
    create
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({
        status: 400, error: { code: 'COMPANY_CONTACT_INCOMPLETE', message: 'faltam dados' } })))
      .mockReturnValueOnce(of({ id: 'rental-novo' }));
    // 1ª chamada: a pré-checagem passa (ex.: falhou aberta); 2ª: o servidor recusou e o aviso resolve.
    ensureComplete.mockReturnValueOnce(of(true)).mockReturnValueOnce(of(true)).mockReturnValue(of(true));
    const { cmp } = visit();
    cmp.submit();
    expect(ensureComplete).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
