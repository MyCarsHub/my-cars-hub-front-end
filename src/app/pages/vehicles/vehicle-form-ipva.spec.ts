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
 * IPVA em parcelas no formulário do veículo (cadastro e edição): adicionar, editar e remover
 * parcelas, dinheiro pt-BR mascarado, e o legado plano reenviado intacto na edição.
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
    ipvaRows: { length: number; at: (i: number) => { patchValue: (v: unknown) => void } };
    addIpvaRow: () => void;
    removeIpvaRow: (i: number) => void;
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

  it('o card de IPVA não tem mais o valor único: nada de type=number nem Status Automático', async () => {
    await setup('create');
    expect(el().querySelector('#veiculo-ipva-amount')).toBeNull();
    expect(el().querySelector('#veiculo-ipva-status')).toBeNull();
    expect(el().querySelector('[data-testid="ipva-add"]')).not.toBeNull();
    expect(el().querySelector('app-ipva-installments-fields input[type="number"]')).toBeNull();
  });

  it('cadastro: três parcelas viram três POSTs, no exercício do vencimento, em centavos', async () => {
    await setup('create');
    for (let i = 0; i < 3; i++) api().addIpvaRow();
    fixture.detectChanges();
    const due = ['2026-03-10', '2026-04-10', '2027-01-10'];
    const money = ['1.234,56', '1.234,56', '99,90'];
    due.forEach((d, i) => {
      type(`#veiculo-ipva-due-${i}`, d);
      type(`#veiculo-ipva-amount-${i}`, money[i]);
    });

    api().submit();

    expect(create).toHaveBeenCalledTimes(1);
    // Legado plano vai nulo no cadastro: não há o que espelhar.
    expect(create.mock.calls[0][0]).toMatchObject({
      ipvaAmount: null,
      ipvaDueDate: null,
      ipvaStatus: null,
    });
    expect(add.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [VEHICLE_ID, 2026, { dueDate: '2026-03-10', amountCents: 123_456 }],
      [VEHICLE_ID, 2026, { dueDate: '2026-04-10', amountCents: 123_456 }],
      [VEHICLE_ID, 2027, { dueDate: '2027-01-10', amountCents: 9_990 }],
    ]);
  });

  it('o campo de valor aceita 1.234,56 como texto e mascara o milhar ao digitar', async () => {
    await setup('create');
    api().addIpvaRow();
    fixture.detectChanges();
    const input = el().querySelector('#veiculo-ipva-amount-0') as HTMLInputElement;
    expect(input.type).toBe('text');
    type('#veiculo-ipva-amount-0', '1234,56');
    expect(input.value).toBe('1.234,56');
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('linha incompleta bloqueia o salvar com o aviso do IPVA', async () => {
    await setup('create');
    api().addIpvaRow();
    api().submit();
    fixture.detectChanges();
    expect(create).not.toHaveBeenCalled();
    expect(el().innerHTML).toContain('Verifique as parcelas do IPVA.');
  });

  it('edição: carrega as parcelas, edita uma (PUT), remove outra (DELETE), reenvia o legado intacto', async () => {
    await setup('edit', [
      year(2026, [
        inst('a', 1, '2026-03-10', 30_000),
        inst('b', 2, '2026-04-10', 30_000),
        inst('c', 3, '2026-05-10', 30_000, true),
      ]),
    ]);
    expect(api().ipvaRows.length).toBe(3);
    // Parcela paga: sem botão de remover e campos travados.
    expect(el().querySelector('[data-testid="ipva-remove-2"]')).toBeNull();
    expect((el().querySelector('#veiculo-ipva-amount-2') as HTMLInputElement).disabled).toBe(true);

    type('#veiculo-ipva-amount-0', '450,00');
    api().removeIpvaRow(1);
    fixture.detectChanges();
    api().submit();

    expect(update).toHaveBeenCalledTimes(1);
    // Nulos aqui fariam o backend apagar a parcela espelhada do ano: vai o valor carregado.
    expect(update.mock.calls[0][1]).toMatchObject({
      ipvaAmount: 90_000,
      ipvaDueDate: '2026-03-10',
      ipvaStatus: 'PENDING',
    });
    expect(remove).toHaveBeenCalledWith(VEHICLE_ID, 2026, 'b');
    expect(put).toHaveBeenCalledWith(VEHICLE_ID, 2026, 'a', {
      dueDate: '2026-03-10',
      amountCents: 45_000,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('falha no meio: para na primeira, avisa que o veículo foi salvo e o retry só reenvia o que faltou', async () => {
    await setup('create');
    api().addIpvaRow();
    api().addIpvaRow();
    fixture.detectChanges();
    type('#veiculo-ipva-due-0', '2026-03-10');
    type('#veiculo-ipva-amount-0', '100,00');
    type('#veiculo-ipva-due-1', '2026-04-10');
    type('#veiculo-ipva-amount-1', '100,00');
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
    // Segundo envio: PUT do veículo de novo, mas só a parcela 2 volta a ser mandada.
    expect(create).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(3);
    expect(add.mock.calls[2][2]).toMatchObject({ dueDate: '2026-04-10' });
  });
});
