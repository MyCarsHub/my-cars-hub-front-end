import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EMPTY, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalNew } from './rental-new';
import { RentalService } from './rental.service';
import { CompanyContactGate } from '../../services/company-contact-gate.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { AsaasIntegrationService } from '../company-settings/integrations/asaas-integration.service';
import { ContractTemplateService } from '../company-settings/contract-template/contract-template-service';

/**
 * O portão em `/alugueis/novo`: sem a chave, o formulário de hoje; com `CHARGES_FLEX`, o Novo
 * aluguel em uma página (no lugar do passo a passo, que fica no código até a liberação).
 */
function providers(): unknown[] {
  return [
    provideRouter([{ path: '**', children: [] }]),
    provideNoopAnimations(),
    {
      provide: ActivatedRoute,
      useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } },
    },
    { provide: VehiclesService, useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) } },
    { provide: DriverService, useValue: { list: () => of({ content: [], page: 0, size: 500, total: 0 }) } },
    { provide: CompanyContactGate, useValue: { ensureComplete: () => of(true), promptAfterServerRefusal: () => of(false) } },
    {
      provide: RentalService,
      useValue: {
        getById: () => EMPTY,
        preflight: () => of({ ok: true, issues: [], warnings: [], limits: null }),
        chargePreview: () => EMPTY,
        create: vi.fn(),
        update: vi.fn(),
      },
    },
    { provide: AsaasIntegrationService, useValue: { status: signal(null), load: () => of(null) } },
    { provide: ContractTemplateService, useValue: { get: () => EMPTY } },
  ];
}

describe('RentalNew — portão CHARGES_FLEX', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  async function mountGate(features: string[] | null): Promise<HTMLElement> {
    if (features) sessionStorage.setItem('features', JSON.stringify(features));
    TestBed.configureTestingModule({ imports: [RentalNew], providers: providers() });
    await TestBed.compileComponents();
    const f = TestBed.createComponent(RentalNew);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('sem a chave: o formulário de hoje, e nem a página nova nem o passo a passo', async () => {
    const el = await mountGate(null);
    expect(el.querySelector('app-rental-form')).not.toBeNull();
    expect(el.querySelector('app-rental-create')).toBeNull();
    expect(el.querySelector('app-rental-wizard')).toBeNull();
  });

  it('com outra chave qualquer: continua o formulário de hoje', async () => {
    const el = await mountGate(['OTHER_FEATURE']);
    expect(el.querySelector('app-rental-form')).not.toBeNull();
    expect(el.querySelector('app-rental-create')).toBeNull();
  });

  it('com CHARGES_FLEX: a página nova no lugar do passo a passo, e não o formulário de hoje', async () => {
    const el = await mountGate(['CHARGES_FLEX']);
    expect(el.querySelector('app-rental-create')).not.toBeNull();
    expect(el.querySelector('app-rental-wizard')).toBeNull();
    expect(el.querySelector('app-rental-form')).toBeNull();
  });
});
