import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorService } from '../../services/api-error.service';
import { FipeService } from '../../services/fipe.service';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import { VehicleForm } from './vehicle-form';

/**
 * `?abrir=financiamento|seguro` — vem das folhas "Adicionar …" de Financiamentos e Seguros, onde
 * o carro já foi escolhido. O bloco chega aberto; carro vendido não abre nada, e a decisão só é
 * tomada depois que o GET do veículo diz se ele foi vendido.
 */
describe('VehicleForm — ?abrir= abre o bloco escolhido na lista da frota', () => {
  const VEHICLE_ID = 'veh-1';

  interface OpenApi {
    showFinancing: () => boolean;
    showInsurance: () => boolean;
  }

  function vehicle(sale: unknown) {
    return {
      id: VEHICLE_ID,
      plate: 'ABC1D23',
      type: 'CAR',
      brand: 'Fiat',
      model: 'Mobi',
      yearManufacture: 2022,
      yearModel: 2022,
      chassis: null,
      hodometer: 1000,
      licensingExpiration: null,
      renavam: null,
      color: null,
      purchaseDate: null,
      ipvaAmount: null,
      ipvaDueDate: null,
      ipvaStatus: null,
      fuel: null,
      activeFinancing: null,
      sale,
    };
  }

  async function render(abrir: string | null, sale: unknown = null): Promise<OpenApi> {
    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: {
            getOne: vi.fn().mockReturnValue(of(vehicle(sale))),
            update: vi.fn(),
            create: vi.fn(),
            createFinancing: vi.fn(),
            listDocuments: vi.fn().mockReturnValue(of([])),
            plateLookupUnavailable: signal(false),
          },
        },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        {
          provide: FipeService,
          useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => VEHICLE_ID },
              queryParamMap: { get: (k: string) => (k === 'abrir' ? abrir : null) },
            },
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as OpenApi;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('?abrir=financiamento opens the financing block', async () => {
    const form = await render('financiamento');
    expect(form.showFinancing()).toBe(true);
    expect(form.showInsurance()).toBe(false);
  });

  it('?abrir=seguro opens the insurance block', async () => {
    const form = await render('seguro');
    expect(form.showInsurance()).toBe(true);
    expect(form.showFinancing()).toBe(false);
  });

  it('without the parameter (or with an unknown one) nothing opens', async () => {
    const form = await render('qualquer');
    expect(form.showFinancing()).toBe(false);
    expect(form.showInsurance()).toBe(false);
  });

  it('a sold vehicle never opens a block, whatever the URL asks', async () => {
    const form = await render('financiamento', {
      id: 'sale-1',
      buyerName: 'Maria',
      saleDate: '2026-08-20',
      saleValueCents: 4_500_000,
      createdDate: '2026-08-20T10:00:00',
    });
    expect(form.showFinancing()).toBe(false);
    expect(form.showInsurance()).toBe(false);
  });
});
