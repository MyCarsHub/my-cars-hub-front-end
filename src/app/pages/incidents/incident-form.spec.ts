import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncidentForm } from './incident-form';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import type { CreateVehicleIncidentRequest } from '../../types/vehicle-incident.types';

/**
 * Registro de um sinistro.
 *
 * O invariante mais importante que este arquivo protege é uma AUSÊNCIA: o
 * formulário não manda status. Um sinistro nasce OPEN / NOT_FILED e só se move
 * pelos endpoints de transição — se um `status` voltasse a viajar no POST,
 * haveria um caminho que pula a máquina de estados inteira.
 */
describe('IncidentForm — registro de sinistro', () => {
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let successToast: ReturnType<typeof vi.fn>;
  let warningToast: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<IncidentForm>;

  interface FormInternals {
    form: {
      patchValue(v: Record<string, unknown>): void;
      controls: Record<string, { value: unknown; disabled: boolean }>;
    };
    submit(): void;
    error(): string | null;
  }

  function api(): FormInternals {
    return fixture.componentInstance as unknown as FormInternals;
  }

  /** Preenche o mínimo que o backend exige para aceitar o registro. */
  function fillRequired(): void {
    api().form.patchValue({
      vehicleId: 'v-1',
      incidentType: 'COLLISION',
      occurredAt: '2026-03-01T09:30',
      description: '  Colisão traseira no semáforo  ',
    });
  }

  function configure(routeId: string | null): void {
    create = vi.fn(() =>
      of({ id: 'inc-9', vehicleTakenOutOfService: null } as unknown as Record<string, unknown>),
    );
    update = vi.fn(() => of({ id: 'inc-9' } as unknown as Record<string, unknown>));
    getOne = vi.fn(() =>
      of({
        id: 'inc-9',
        vehicleId: 'v-1',
        driverId: null,
        incidentType: 'DAMAGE',
        occurredAt: '2026-02-01T08:00:00',
        location: 'Garagem',
        description: 'Risco na lataria',
        atFaultParty: 'UNKNOWN',
        estimatedCostCents: 50000,
        deductibleCents: null,
        thirdPartyName: null,
        thirdPartyDocument: null,
        thirdPartyPhone: null,
        thirdPartyPlate: null,
        notes: null,
      } as unknown as Record<string, unknown>),
    );
    successToast = vi.fn();
    warningToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [IncidentForm],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: VehicleIncidentsService,
          useValue: { create, update, getOne },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn(() =>
              of({ content: [{ id: 'v-1', plate: 'ABC1D23', brand: 'Fiat', model: 'Argo' }] }),
            ),
          },
        },
        { provide: DriverService, useValue: { list: vi.fn(() => of({ content: [] })) } },
        {
          provide: NotificationService,
          useValue: { success: successToast, warning: warningToast, info: vi.fn(), error: vi.fn() },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => routeId } } },
        },
      ],
    });
  }

  beforeEach(() => configure(null));

  it('envia o sinistro com os campos normalizados e SEM status', () => {
    fixture = TestBed.createComponent(IncidentForm);
    fixture.detectChanges();

    fillRequired();
    api().form.patchValue({
      location: ' Av. Paulista ',
      estimatedCostReais: 2500.75,
      thirdPartyPlate: ' xyz9k88 ',
    });
    api().submit();

    expect(create).toHaveBeenCalledTimes(1);
    const [payload] = create.mock.calls[0] as [CreateVehicleIncidentRequest];

    expect(payload.vehicleId).toBe('v-1');
    expect(payload.incidentType).toBe('COLLISION');
    // `datetime-local` entrega minutos; o backend espera LocalDateTime com segundos.
    expect(payload.occurredAt).toBe('2026-03-01T09:30:00');
    expect(payload.description).toBe('Colisão traseira no semáforo');
    expect(payload.location).toBe('Av. Paulista');
    // Valores em CENTAVOS.
    expect(payload.estimatedCostCents).toBe(250075);
    expect(payload.thirdPartyPlate).toBe('XYZ9K88');

    // A ausência é o teste: status não trafega na criação.
    expect(payload).not.toHaveProperty('resolutionStatus');
    expect(payload).not.toHaveProperty('insuranceStatus');
    expect(payload).not.toHaveProperty('status');
  });

  it('não chama a API com o formulário inválido e aponta os campos', () => {
    fixture = TestBed.createComponent(IncidentForm);
    fixture.detectChanges();

    api().submit();

    expect(create).not.toHaveBeenCalled();
    expect(api().error()).toContain('Verifique os campos');
  });

  it('navega para o detalhe do sinistro criado', () => {
    fixture = TestBed.createComponent(IncidentForm);
    fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fillRequired();
    api().submit();

    expect(successToast).toHaveBeenCalledWith('Sinistro registrado.');
    expect(navigate).toHaveBeenCalledWith(['/sinistros', 'inc-9']);
  });

  /**
   * O backend só para o veículo se ele estava AVAILABLE e reporta o resultado
   * em `vehicleTakenOutOfService`. Sem este aviso, quem marcou a opção suporia
   * que o carro saiu de circulação — e ele seguiria alugável.
   */
  it('avisa quando o veículo pedido NÃO pôde ser tirado de circulação', () => {
    create.mockReturnValue(
      of({ id: 'inc-9', vehicleTakenOutOfService: false } as unknown as Record<string, unknown>),
    );
    fixture = TestBed.createComponent(IncidentForm);
    fixture.detectChanges();

    fillRequired();
    api().form.patchValue({ takeVehicleOutOfService: true });
    api().submit();

    expect(warningToast).toHaveBeenCalledOnce();
    expect(warningToast.mock.calls[0][0]).toContain('NÃO foi parado');
  });

  it('não avisa nada quando o veículo foi mesmo parado', () => {
    create.mockReturnValue(
      of({ id: 'inc-9', vehicleTakenOutOfService: true } as unknown as Record<string, unknown>),
    );
    fixture = TestBed.createComponent(IncidentForm);
    fixture.detectChanges();

    fillRequired();
    api().form.patchValue({ takeVehicleOutOfService: true });
    api().submit();

    expect(warningToast).not.toHaveBeenCalled();
  });

  it('erro de campo do backend vira mensagem inline, não toast', () => {
    create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: 'Sinistro não pode ocorrer no futuro.',
              fieldErrors: { occurredAt: 'Sinistro não pode ocorrer no futuro.' },
            },
          }),
      ),
    );
    fixture = TestBed.createComponent(IncidentForm);
    fixture.detectChanges();

    fillRequired();
    api().submit();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Sinistro não pode ocorrer no futuro.');
  });

  describe('modo edição', () => {
    beforeEach(() => configure('inc-9'));

    it('trava o veículo e envia o PUT sem vehicleId nem status', () => {
      fixture = TestBed.createComponent(IncidentForm);
      fixture.detectChanges();

      // Sinistro pertence ao carro em que aconteceu — trocar de veículo é
      // registro errado, que se apaga e refaz.
      expect(api().form.controls['vehicleId'].disabled).toBe(true);

      api().submit();

      expect(update).toHaveBeenCalledTimes(1);
      const [id, payload] = update.mock.calls[0] as [string, Record<string, unknown>];
      expect(id).toBe('inc-9');
      expect(payload).not.toHaveProperty('vehicleId');
      expect(payload).not.toHaveProperty('takeVehicleOutOfService');
      expect(payload).not.toHaveProperty('resolutionStatus');
      expect(payload).not.toHaveProperty('insuranceStatus');
      expect(create).not.toHaveBeenCalled();
    });

    it('preenche o formulário com os centavos convertidos em reais', () => {
      fixture = TestBed.createComponent(IncidentForm);
      fixture.detectChanges();

      expect(api().form.controls['estimatedCostReais'].value).toBe(500);
      expect(api().form.controls['occurredAt'].value).toBe('2026-02-01T08:00');
    });
  });
});
