import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FleetCalendarPage,
  INCOMPLETE_WINDOW_MESSAGE,
  INVERTED_WINDOW_MESSAGE,
  PeriodMode,
  RenderLane,
  WINDOW_TOO_WIDE_MESSAGE,
} from './fleet-calendar-page';
import { FleetCalendarService } from '../../../services/fleet-calendar.service';
import { VehiclesService } from '../../../services/vehicles.service';
import {
  FleetCalendarBlock,
  FleetCalendarQuery,
  FleetCalendarResponse,
  FleetCalendarVehicle,
} from '../../../types/fleet-calendar.types';

/**
 * Cobre `/veiculos/calendario`:
 *  - janela default (mês corrente) e navegação entre períodos;
 *  - filtro por veículo repassado ao backend;
 *  - período sem nenhuma ocupação com estado PRÓPRIO (nem erro, nem frota vazia);
 *  - janela acima de 366 dias barrada ANTES do request, com o limite na mensagem;
 *  - 400 do servidor traduzido para a mesma mensagem, e não "erro de requisição";
 *  - sobreposição e bloco que extravasa a janela chegando à camada de render.
 *
 * O relógio é fixado em 15/08/2026 porque a janela default é o mês corrente.
 */
describe('FleetCalendarPage', () => {
  /** Superfície interna exercitada pelos testes — o template não expõe outra. */
  interface PageInternals {
    mode: () => PeriodMode;
    lanes: () => readonly RenderLane[];
    errorMessage: () => string | null;
    loading: () => boolean;
    hasLanes: () => boolean;
    isPeriodEmpty: () => boolean;
    periodLabel: () => string;
    requestedDays: () => number;
    idleVehicleCount: () => number;
    overlapVehicleCount: () => number;
    todayOffsetPercent: () => number | null;
    setMode: (mode: PeriodMode) => void;
    step: (direction: -1 | 1) => void;
    goToToday: () => void;
    onVehicleChange: (value: string) => void;
    onCustomFromChange: (value: string) => void;
    onCustomToChange: (value: string) => void;
  }

  let calendarSpy: ReturnType<typeof vi.fn>;
  let response: FleetCalendarResponse;
  let fixture: ComponentFixture<FleetCalendarPage>;
  let page: PageInternals;

  function block(partial: Partial<FleetCalendarBlock> = {}): FleetCalendarBlock {
    return {
      kind: 'RENTAL',
      sourceId: 'rental-1',
      status: 'ACTIVE',
      start: '2026-08-05',
      end: '2026-08-09',
      label: 'João Silva',
      ...partial,
    };
  }

  function vehicle(
    blocks: FleetCalendarBlock[],
    partial: Partial<FleetCalendarVehicle> = {},
  ): FleetCalendarVehicle {
    return {
      vehicleId: 'veh-1',
      plate: 'ABC1D23',
      label: 'Fiat Argo · ABC1D23',
      vehicleStatus: 'AVAILABLE',
      blocks,
      ...partial,
    };
  }

  function payload(
    vehicles: FleetCalendarVehicle[],
    from = '2026-08-01',
    to = '2026-08-31',
  ): FleetCalendarResponse {
    return { from, to, timezone: 'America/Sao_Paulo', vehicles };
  }

  /** Últimos parâmetros enviados ao backend. */
  function lastQuery(): FleetCalendarQuery {
    return calendarSpy.mock.calls[calendarSpy.mock.calls.length - 1][0] as FleetCalendarQuery;
  }

  function create(): void {
    fixture = TestBed.createComponent(FleetCalendarPage);
    fixture.detectChanges();
    page = fixture.componentInstance as unknown as PageInternals;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));

    response = payload([vehicle([block()])]);
    calendarSpy = vi.fn().mockImplementation(() => of(response));

    TestBed.configureTestingModule({
      imports: [FleetCalendarPage],
      providers: [
        provideRouter([]),
        { provide: FleetCalendarService, useValue: { calendar: calendarSpy } },
        {
          provide: VehiclesService,
          useValue: {
            list: () =>
              of({
                content: [
                  {
                    id: 'veh-1',
                    plate: 'ABC1D23',
                    brand: 'Fiat',
                    model: 'Argo',
                    type: 'CAR',
                    yearModel: 2024,
                    licensingExpiration: null,
                    status: 'AVAILABLE',
                    createdDate: '2026-01-01',
                  },
                ],
                page: 0,
                size: 500,
                total: 1,
              }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ------------------------------------------------------------- carga inicial

  describe('carga inicial', () => {
    it('abre no mês corrente e pede exatamente essa janela', () => {
      create();
      expect(lastQuery()).toEqual({
        from: '2026-08-01',
        to: '2026-08-31',
        vehicleId: undefined,
      });
      expect(page.requestedDays()).toBe(31);
      expect(page.loading()).toBe(false);
      expect(page.errorMessage()).toBeNull();
    });

    it('monta a faixa do veículo a partir da resposta', () => {
      create();
      const lanes = page.lanes();
      expect(lanes).toHaveLength(1);
      expect(lanes[0].label).toBe('Fiat Argo · ABC1D23');
      expect(lanes[0].blocks).toHaveLength(1);
      expect(page.hasLanes()).toBe(true);
      expect(page.isPeriodEmpty()).toBe(false);
    });

    it('marca a posição de hoje dentro da janela', () => {
      create();
      // 15/08 é o 15º dia de uma janela de 31 → pouco depois da metade.
      expect(page.todayOffsetPercent()).toBeCloseTo((14.5 / 31) * 100, 6);
    });

    it('não marca hoje quando ele cai fora da janela exibida', () => {
      create();
      response = payload([vehicle([])], '2026-11-01', '2026-11-30');
      page.step(1);
      expect(page.todayOffsetPercent()).toBeNull();
    });
  });

  // --------------------------------------------------------------- navegação

  describe('navegação entre períodos', () => {
    it('avança um mês inteiro', () => {
      create();
      page.step(1);
      expect(lastQuery()).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    });

    it('volta um mês inteiro, atravessando a virada de ano sem escorregar', () => {
      create();
      page.step(-1);
      expect(lastQuery()).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
      page.step(-1);
      page.step(-1);
      page.step(-1);
      page.step(-1);
      page.step(-1);
      page.step(-1);
      expect(lastQuery()).toMatchObject({ from: '2026-01-01', to: '2026-01-31' });
      page.step(-1);
      expect(lastQuery()).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    });

    it('semana começa na segunda-feira e cobre 7 dias', () => {
      create();
      page.setMode('WEEK');
      // 15/08/2026 é um sábado; a segunda daquela semana é 10/08.
      expect(lastQuery()).toMatchObject({ from: '2026-08-10', to: '2026-08-16' });
      expect(page.requestedDays()).toBe(7);

      page.step(1);
      expect(lastQuery()).toMatchObject({ from: '2026-08-17', to: '2026-08-23' });
    });

    it('estreitar o período longe de hoje ancora no início da janela vigente', () => {
      create();
      page.step(1);
      page.step(1);
      page.step(1); // novembro, sem hoje dentro
      page.setMode('WEEK');
      // 01/11/2026 cai num domingo: a semana que o contém começa em 26/10.
      expect(lastQuery()).toMatchObject({ from: '2026-10-26', to: '2026-11-01' });
    });

    it('trimestre cobre três meses de calendário', () => {
      create();
      page.setMode('QUARTER');
      expect(lastQuery()).toMatchObject({ from: '2026-08-01', to: '2026-10-31' });
      page.step(1);
      expect(lastQuery()).toMatchObject({ from: '2026-11-01', to: '2027-01-31' });
    });

    it('"ir para hoje" volta ao período que contém a data atual', () => {
      create();
      page.step(1);
      page.step(1);
      page.goToToday();
      expect(lastQuery()).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
    });

    it('trocar para personalizado herda a janela vigente em vez de zerá-la', () => {
      create();
      page.step(1);
      page.setMode('CUSTOM');
      expect(lastQuery()).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    });

    it('resposta atrasada de uma janela antiga não sobrescreve a atual', () => {
      const slow = new Subject<FleetCalendarResponse>();
      calendarSpy.mockImplementationOnce(() => slow as Observable<FleetCalendarResponse>);
      create();

      response = payload([vehicle([], { vehicleId: 'veh-2', label: 'Novo · XYZ' })]);
      page.step(1);
      // A primeira requisição só responde agora, com a janela já ultrapassada.
      slow.next(payload([vehicle([], { vehicleId: 'veh-1', label: 'Antigo · ABC' })]));
      slow.complete();

      expect(page.lanes()[0].label).toBe('Novo · XYZ');
    });
  });

  // ------------------------------------------------------------------ filtro

  describe('filtro por veículo', () => {
    it('repassa o vehicleId ao backend', () => {
      create();
      page.onVehicleChange('veh-1');
      expect(lastQuery()).toMatchObject({ vehicleId: 'veh-1' });
    });

    it('limpar o filtro remove o parâmetro em vez de mandar string vazia', () => {
      create();
      page.onVehicleChange('veh-1');
      page.onVehicleChange('');
      expect(lastQuery().vehicleId).toBeUndefined();
    });

    it('404 de veículo de outra empresa vira mensagem acionável', () => {
      create();
      calendarSpy.mockImplementationOnce(() =>
        throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
      );
      page.onVehicleChange('veh-de-outra-empresa');
      expect(page.errorMessage()).toContain('Limpe o filtro');
      expect(page.lanes()).toEqual([]);
    });
  });

  // --------------------------------------------------------- período vazio

  describe('período sem nenhum dado', () => {
    it('frota livre no período tem estado próprio, distinto de frota vazia', () => {
      response = payload([
        vehicle([], { vehicleId: 'v-1' }),
        vehicle([], { vehicleId: 'v-2', plate: 'XYZ9K88' }),
      ]);
      create();

      expect(page.errorMessage()).toBeNull();
      expect(page.hasLanes()).toBe(true);
      expect(page.isPeriodEmpty()).toBe(true);
      // Todo veículo livre a janela inteira conta como parado.
      expect(page.idleVehicleCount()).toBe(2);
    });

    it('frota sem nenhum veículo não é "período vazio"', () => {
      response = payload([]);
      create();
      expect(page.hasLanes()).toBe(false);
      expect(page.isPeriodEmpty()).toBe(false);
      expect(page.errorMessage()).toBeNull();
    });
  });

  // ------------------------------------------------------------ janela grande

  describe('janela acima do teto', () => {
    it('barra o request ANTES de sair e nomeia o limite de 366 dias', () => {
      create();
      const callsBefore = calendarSpy.mock.calls.length;

      page.setMode('CUSTOM');
      const callsAfterMode = calendarSpy.mock.calls.length;
      page.onCustomFromChange('2026-01-01');
      page.onCustomToChange('2027-01-02'); // 367 dias

      expect(calendarSpy.mock.calls.length).toBeGreaterThan(callsBefore);
      // Nenhuma requisição nova depois que a janela estourou.
      expect(calendarSpy.mock.calls.length).toBe(callsAfterMode + 1);
      expect(page.errorMessage()).toBe(WINDOW_TOO_WIDE_MESSAGE);
      expect(page.errorMessage()).toContain('366');
      expect(page.lanes()).toEqual([]);
    });

    it('366 dias exatos ainda passam e chegam ao backend', () => {
      create();
      page.setMode('CUSTOM');
      page.onCustomFromChange('2026-01-01');
      page.onCustomToChange('2027-01-01'); // 366 dias
      expect(lastQuery()).toMatchObject({ from: '2026-01-01', to: '2027-01-01' });
      expect(page.errorMessage()).toBeNull();
    });

    it('400 que escape do guard cliente também nomeia o limite, sem texto genérico', () => {
      create();
      calendarSpy.mockImplementationOnce(() =>
        throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request' })),
      );
      page.step(1);

      const message = page.errorMessage() ?? '';
      expect(message).toContain('366');
      expect(message).not.toContain('Erro de requisição');
    });

    it('mensagem do backend prevalece sobre o fallback quando ele explica a recusa', () => {
      create();
      calendarSpy.mockImplementationOnce(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              statusText: 'Bad Request',
              error: { message: 'Período máximo de 366 dias.' },
            }),
        ),
      );
      page.step(1);
      expect(page.errorMessage()).toBe('Período máximo de 366 dias.');
    });

    it('janela invertida é recusada localmente, com a mesma leitura do backend', () => {
      create();
      page.setMode('CUSTOM');
      const calls = calendarSpy.mock.calls.length;
      page.onCustomFromChange('2026-08-20');
      page.onCustomToChange('2026-08-10');
      expect(page.errorMessage()).toBe(INVERTED_WINDOW_MESSAGE);
      expect(calendarSpy.mock.calls.length).toBe(calls + 1);
    });

    it('período personalizado incompleto pede as duas datas em vez de falhar', () => {
      create();
      page.setMode('CUSTOM');
      const calls = calendarSpy.mock.calls.length;
      page.onCustomToChange('');
      expect(page.errorMessage()).toBe(INCOMPLETE_WINDOW_MESSAGE);
      expect(calendarSpy.mock.calls.length).toBe(calls);
    });
  });

  // -------------------------------------------------------------- render dos blocos

  describe('render dos blocos', () => {
    it('aluguel e manutenção têm forma, ícone e destino distintos', () => {
      response = payload([
        vehicle([
          block({ sourceId: 'r-1' }),
          block({
            kind: 'MAINTENANCE',
            sourceId: 'm-1',
            status: 'SCHEDULED',
            start: '2026-08-20',
            end: '2026-08-20',
            label: 'Revisão',
          }),
        ]),
      ]);
      create();

      const [rental, maintenance] = page.lanes()[0].blocks;
      expect(rental.routerLink).toEqual(['/alugueis', 'r-1']);
      expect(maintenance.routerLink).toEqual(['/manutencoes', 'm-1']);
      // Pílula × retângulo reto: a distinção sobrevive em escala de cinza.
      expect(rental.classes).toContain('rounded-full');
      expect(maintenance.classes).toContain('rounded-none');
      expect(rental.ariaLabel).toContain('Aluguel');
      expect(maintenance.ariaLabel).toContain('Manutenção');
    });

    it('reservado e ativo se distinguem por traço e padrão, não só por cor', () => {
      response = payload([
        vehicle([
          block({ sourceId: 'a', status: 'ACTIVE' }),
          block({ sourceId: 'r', status: 'RESERVED', start: '2026-08-20', end: '2026-08-25' }),
        ]),
      ]);
      create();

      const [active, reserved] = page.lanes()[0].blocks;
      expect(active.pattern).toBeNull();
      expect(reserved.pattern).toBeTruthy();
      expect(reserved.classes).toContain('border-dashed');
      expect(active.classes).not.toContain('border-dashed');
    });

    it('bloco que extravasa a janela perde o arredondamento e diz a data real', () => {
      response = payload([vehicle([block({ start: '2026-07-20', end: '2026-09-10' })])]);
      create();

      const [bar] = page.lanes()[0].blocks;
      expect(bar.classes).toContain('rounded-l-none');
      expect(bar.classes).toContain('rounded-r-none');
      expect(bar.ariaLabel).toContain('20/07/2026');
      expect(bar.ariaLabel).toContain('10/09/2026');
      expect(bar.ariaLabel).toContain('começou antes do período exibido');
      expect(bar.ariaLabel).toContain('termina depois do período exibido');
    });

    it('sobreposição vira duas sub-faixas empilhadas, com altura maior', () => {
      response = payload([
        vehicle([
          block({ sourceId: 'r-1', status: 'COMPLETED', start: '2026-08-05', end: '2026-08-12' }),
          block({ sourceId: 'r-2', status: 'RESERVED', start: '2026-08-10', end: '2026-08-18' }),
        ]),
      ]);
      create();

      const lane = page.lanes()[0];
      expect(lane.hasOverlap).toBe(true);
      expect(lane.blocks.map((b) => b.topPx)).toEqual([0, 30]);
      expect(lane.heightPx).toBe(56);
      expect(page.overlapVehicleCount()).toBe(1);
    });

    it('veículo parado ganha rótulo com a duração e o intervalo', () => {
      response = payload([vehicle([block({ start: '2026-08-01', end: '2026-08-05' })])]);
      create();
      expect(page.lanes()[0].idleLabel).toBe('Parado 26 dias (06/08 – 31/08)');
    });

    it('veículo ocupado o mês todo não recebe rótulo de parado', () => {
      response = payload([vehicle([block({ start: '2026-08-01', end: '2026-08-31' })])]);
      create();
      expect(page.lanes()[0].idleLabel).toBeNull();
      expect(page.idleVehicleCount()).toBe(0);
    });

    it('bloco estreito esconde o texto mas mantém o nome acessível completo', () => {
      response = payload([
        vehicle([
          block({
            kind: 'MAINTENANCE',
            sourceId: 'm-1',
            status: 'DONE',
            start: '2026-08-20',
            end: '2026-08-20',
            label: 'Troca de óleo',
          }),
        ]),
      ]);
      create();

      const [bar] = page.lanes()[0].blocks;
      expect(bar.showLabel).toBe(false);
      expect(bar.ariaLabel).toContain('Troca de óleo');
      expect(bar.ariaLabel).toContain('abrir manutenção');
    });
  });
});
