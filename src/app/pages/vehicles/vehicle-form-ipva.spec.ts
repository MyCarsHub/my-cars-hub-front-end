import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VehicleForm } from './vehicle-form';
import { ApiErrorService } from '../../services/api-error.service';
import { FipeService } from '../../services/fipe.service';
import { FleetActivationService } from '../../services/fleet-activation.service';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { VehicleIpvaService } from '../../services/vehicle-ipva.service';
import { VehiclesService } from '../../services/vehicles.service';
import { IpvaInstallment, IpvaYear } from '../../types/vehicle-ipva.types';

/**
 * IPVA em série no formulário do veículo (cadastro e edição): Valor da parcela, Parcelas,
 * Início e Vencimento geram as parcelas; as já existentes só aparecem resumidas.
 */
describe('VehicleForm — IPVA em parcelas', () => {
  const VEHICLE_ID = 'veh-1';

  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let put: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let listYears: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<VehicleForm>>;

  interface FormApi {
    form: { patchValue: (v: unknown) => void };
    toggleIpva: () => void;
    submit: () => void;
  }
  const api = () => fixture.componentInstance as unknown as FormApi;
  const el = () => fixture.nativeElement as HTMLElement;

  function inst(id: string, number: number, dueDate: string, cents: number, paid = false): IpvaInstallment {
    return {
      id,
      vehicleId: VEHICLE_ID,
      year: Number(dueDate.slice(0, 4)),
      number,
      dueDate,
      amountCents: cents,
      paidDate: paid ? dueDate : null,
      paidAmountCents: paid ? cents : null,
      paid,
      status: paid ? 'PAID' : 'PENDING',
    };
  }

  function year(y: number, installments: IpvaInstallment[]): IpvaYear {
    return {
      vehicleId: VEHICLE_ID,
      year: y,
      totalCents: 0,
      paidCents: 0,
      openCents: 0,
      installmentsCount: installments.length,
      paidCount: 0,
      nextDueDate: null,
      status: null,
      installments,
    };
  }

  function vehicle() {
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
      ipvaAmount: 90_000,
      ipvaDueDate: '2026-03-10',
      ipvaStatus: 'PENDING',
      fuel: null,
      activeFinancing: null,
    };
  }

  async function setup(mode: 'create' | 'edit', years: IpvaYear[] = []): Promise<void> {
    create = vi.fn().mockReturnValue(of({ id: VEHICLE_ID }));
    update = vi.fn().mockReturnValue(of({ id: VEHICLE_ID }));
    add = vi.fn().mockImplementation((_v: string, y: number, p: { dueDate: string }) =>
      of(year(y, [inst(`new-${p.dueDate}`, 1, p.dueDate, 1)])),
    );
    put = vi.fn().mockReturnValue(of(year(2026, [])));
    remove = vi.fn().mockReturnValue(of(year(2026, [])));
    listYears = vi.fn().mockReturnValue(of(years));

    await TestBed.configureTestingModule({
      imports: [VehicleForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: VehiclesService,
          useValue: {
            create,
            update,
            getOne: vi.fn().mockReturnValue(of(vehicle())),
            plateLookupUnavailable: signal(false),
          },
        },
        { provide: VehicleIpvaService, useValue: { listYears, add, update: put, remove } },
        { provide: InsurancesService, useValue: { create: vi.fn() } },
        { provide: FleetActivationService, useValue: { markHasVehicles: vi.fn(), skip: vi.fn() } },
        { provide: FipeService, useValue: { brands: () => of([]), models: () => of([]), years: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => (mode === 'edit' ? VEHICLE_ID : null) },
              queryParamMap: { get: () => null },
            },
          },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(VehicleForm);
    fixture.detectChanges();
    if (mode === 'create') {
      api().form.patchValue({
        plate: 'ABC1D23',
        brand: 'Fiat',
        model: 'Mobi',
        yearManufacture: 2022,
        yearModel: 2022,
        hodometer: 1000,
      });
    }
  }

  function type(selector: string, value: string): void {
    const input = el().querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  function fill(amount: string, count: string, start: string, day: string): void {
    api().toggleIpva();
    fixture.detectChanges();
    type('#veiculo-ipva-amount', amount);
    type('#veiculo-ipva-installments', count);
    type('#veiculo-ipva-start', start);
    type('#veiculo-ipva-due-day', day);
  }

  it('o card é um gerador de série: quatro campos, sem Parcela N / Remover / Adicionar parcela, sem type=number', async () => {
    await setup('create');
    api().toggleIpva();
    fixture.detectChanges();
    const labels = Array.from(el().querySelectorAll('app-ipva-installments-fields label')).map(
      (l) => l.textContent?.replace('*', '').trim(),
    );
    expect(labels).toEqual(['Valor da parcela (R$)', 'Parcelas', 'Início', 'Vencimento (dia)']);
    expect(el().querySelector('[data-testid="ipva-add"]')).toBeNull();
    expect(el().textContent).not.toContain('Remover parcela');
    expect(el().textContent).not.toContain('Adicionar parcela');
    expect(el().querySelector('app-ipva-installments-fields input[type="number"]')).toBeNull();
    expect((el().querySelector('#veiculo-ipva-amount') as HTMLInputElement).type).toBe('text');
  });

  it('cadastro: valor + 3 parcelas + início + dia geram 3 POSTs com datas mensais e centavos exatos', async () => {
    await setup('create');
    fill('333,33', '3', '2026-11', '10');
    expect(el().querySelector('[data-testid="ipva-preview"]')?.textContent).toContain('3x de R$ 333,33');

    api().submit();

    expect(create.mock.calls[0][0]).toMatchObject({ ipvaAmount: null, ipvaDueDate: null, ipvaStatus: null });
    expect(add.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [VEHICLE_ID, 2026, { dueDate: '2026-11-10', amountCents: 33_333 }],
      [VEHICLE_ID, 2026, { dueDate: '2026-12-10', amountCents: 33_333 }],
      [VEHICLE_ID, 2027, { dueDate: '2027-01-10', amountCents: 33_333 }],
    ]);
  });

  it('dia 31 vira o último dia do mês curto e não arrasta para os seguintes', async () => {
    await setup('create');
    fill('100,00', '3', '2027-01', '31');
    api().submit();
    expect(add.mock.calls.map((c) => c[2].dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('combinação inválida bloqueia o salvar com o aviso do IPVA', async () => {
    await setup('create');
    fill('100,00', '13', '2026-11', '32');
    api().submit();
    fixture.detectChanges();
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(el().innerHTML).toContain('Verifique os campos do IPVA.');
  });

  it('bloco fechado: salvar não manda parcela nenhuma', async () => {
    await setup('create');
    api().submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it('edição com parcela paga: resumo "1 de 3 pagas" e salvar sem gerar não toca em nada', async () => {
    await setup('edit', [
      year(2026, [
        inst('a', 1, '2026-03-10', 30_000),
        inst('b', 2, '2026-04-10', 30_000),
        inst('c', 3, '2026-05-10', 30_000, true),
      ]),
    ]);
    const summary = el().querySelector('[data-testid="ipva-summary"]')?.textContent ?? '';
    expect(summary).toContain('1 de 3');
    expect(summary).toContain('900,00');
    expect(el().querySelector('app-ipva-installments-fields')).toBeNull();

    api().submit();

    expect(update.mock.calls[0][1]).toMatchObject({
      ipvaAmount: 90_000,
      ipvaDueDate: '2026-03-10',
      ipvaStatus: 'PENDING',
    });
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('edição: gerar uma série só acrescenta; as existentes (pagas inclusive) não recebem PUT nem DELETE', async () => {
    await setup('edit', [year(2026, [inst('c', 1, '2026-03-10', 30_000, true)])]);
    fill('450,00', '2', '2026-06', '15');
    api().submit();
    expect(add.mock.calls.map((c) => c[2])).toEqual([
      { dueDate: '2026-06-15', amountCents: 45_000 },
      { dueDate: '2026-07-15', amountCents: 45_000 },
    ]);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('falha no meio: para na primeira, avisa que o veículo foi salvo e o retry só reenvia o que faltou', async () => {
    await setup('create');
    fill('100,00', '2', '2026-03', '10');
    add.mockImplementationOnce((_v: string, y: number, p: { dueDate: string }) =>
      of(year(y, [inst('n1', 1, p.dueDate, 10_000)])),
    );
    add.mockImplementationOnce(() =>
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Exercício travado.' } })),
    );

    api().submit();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledTimes(2);
    expect(el().innerHTML).toContain('O veículo foi salvo');

    api().submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(3);
    expect(add.mock.calls[2][2]).toMatchObject({ dueDate: '2026-04-10' });
  });
});
