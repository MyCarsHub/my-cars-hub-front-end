import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionSchedulesBlock } from './inspection-schedules-block';
import { ApiErrorService } from '../../../services/api-error.service';
import { InspectionScheduleService } from '../../../services/inspection-schedule.service';
import { NotificationService } from '../../../services/notification.service';
import type { InspectionScheduleResponse } from '../../../types/inspection-schedule.types';

/**
 * O agendamento no escopo da EMPRESA. O dono reclamou de tres coisas e nenhuma era o
 * cartao do veiculo: agendar era carro a carro, nao havia visao geral, e tudo ficava
 * escondido dentro do detalhe de um carro.
 *
 * O que estes casos protegem: que FROTA e CARRO sejam distinguiveis, que a precedencia
 * MEDIDA no SQL apareca em portugues, que a regra da frota nao ofereca um botao de
 * desligar que nao existe no backend, e que falha de leitura nao se disfarce de vazio.
 */
describe('InspectionSchedulesBlock — agendamento da empresa', () => {
  const fleet: InspectionScheduleResponse = {
    id: 'sch-fleet',
    vehicleId: null,
    frequency: 'QUARTERLY',
    startDate: '2026-10-01',
    nextDueDate: '2027-01-01',
    reminderIntervalDays: 7,
    active: true,
  };

  const perCar: InspectionScheduleResponse = {
    id: 'sch-car',
    vehicleId: 'veh-1',
    frequency: 'MONTHLY',
    startDate: '2026-10-01',
    nextDueDate: '2026-11-01',
    reminderIntervalDays: 3,
    active: true,
  };

  const VEHICLES = [
    { id: 'veh-1', label: 'ABC1D23 — Onix' },
    { id: 'veh-2', label: 'XYZ9W88 — HB20' },
  ];

  let list: ReturnType<typeof vi.fn>;
  let createForFleet: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let deactivate: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;

  function error(status: number): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message: 'falhou' } });
  }

  function render(
    listImpl: () => Observable<InspectionScheduleResponse[]> = () => of([]),
  ): ComponentFixture<InspectionSchedulesBlock> {
    TestBed.resetTestingModule();
    list = vi.fn(listImpl);
    createForFleet = vi.fn(() => of(fleet));
    create = vi.fn(() => of(fleet));
    deactivate = vi.fn(() => of(undefined));
    success = vi.fn();

    TestBed.configureTestingModule({
      imports: [InspectionSchedulesBlock],
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionScheduleService,
          useValue: { listForCompany: list, createForFleet, create, deactivate },
        },
        {
          provide: NotificationService,
          useValue: { success, error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(InspectionSchedulesBlock);
    fixture.componentRef.setInput('vehicleOptions', VEHICLES);
    fixture.detectChanges();
    return fixture;
  }

  function button(fixture: ComponentFixture<InspectionSchedulesBlock>, text: string) {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').includes(text));
  }

  function rowOf(fixture: ComponentFixture<InspectionSchedulesBlock>, title: string): HTMLElement {
    const row = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('li'),
    ).find((li) => (li.textContent ?? '').includes(title));
    if (!row) throw new Error(`a linha "${title}" nao esta na tela`);
    return row as HTMLElement;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------- O CONVITE QUE OCUPA A TELA
  /**
   * Nada agendado: a tela INTEIRA e um convite, nao uma lista vazia com um botao no canto.
   * E a frase e verdade MEDIDA — a linha de `vehicle_id` nulo vale para os carros
   * cadastrados depois, porque o motor materializa por carro elegivel no vencimento.
   */
  it('sem nada agendado, a tela convida a agendar a FROTA e promete o que o backend cumpre', () => {
    const fixture = render(() => of([]));
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Agende uma vez e vale para todos os carros');
    expect(text).toContain('que você cadastrar depois');
    expect(button(fixture, 'Agendar para toda a frota')).toBeDefined();
  });

  /** Falha de leitura NAO e vazio: convidar a agendar sobre uma regra que talvez exista
   * bateria no 400 de "ja existe uma regra de frota". */
  it('falha ao listar nao se disfarca de vazio e oferece reler', () => {
    const fixture = render(() => throwError(() => error(500)));
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(button(fixture, 'Tentar de novo')).toBeDefined();
    expect(text).not.toContain('Agende uma vez e vale para todos os carros');
    expect(button(fixture, 'Agendar para toda a frota')).toBeUndefined();
  });

  // ------------------------------------------------- FROTA vs CARRO, POR FORMA
  /**
   * Sao coisas diferentes e tem de PARECER diferentes a um olhar: a regra da frota e larga
   * e com faixa lateral laranja; a de carro e recuada e de borda neutra. Uma e REGRA, a
   * outra e EXCECAO.
   */
  it('a linha de FROTA e a de CARRO tem formas distintas, nao so rotulos', () => {
    const fixture = render(() => of([fleet, perCar]));

    const fleetRow = rowOf(fixture, 'Toda a frota');
    const carRow = rowOf(fixture, 'ABC1D23');

    // Faixa lateral laranja identifica a regra da empresa.
    expect(fleetRow.className).toContain('border-l-primary-500');
    // O carro e recuado e NAO tem a faixa.
    expect(carRow.className).not.toContain('border-l-primary-500');
    expect(carRow.className).toContain('ml-6');
  });

  it('a linha de carro é nomeada pela placa, que vem do input e nao da resposta', () => {
    const fixture = render(() => of([perCar]));

    // A lista de agendamentos devolve so o `vehicleId`; a placa vem de `vehicleOptions`.
    expect(rowOf(fixture, 'ABC1D23').textContent).toContain('Onix');
  });

  it('FROTA vem antes dos carros: e a regra que explica as outras', () => {
    const fixture = render(() => of([perCar, fleet]));
    const titulos = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('li'),
    ).map((li) => ((li.textContent ?? '').includes('Toda a frota') ? 'frota' : 'carro'));

    expect(titulos[0]).toBe('frota');
  });

  // ------------------------------------------------------------- PRECEDENCIA
  /**
   * A regra foi MEDIDA no SQL, nao inventada: `findEffectiveSchedule` faz
   * `ORDER BY (s.vehicle_id IS NULL) LIMIT 1`, e em Postgres `false` ordena antes de
   * `true` — a linha que NOMEIA o veiculo vence. A tela diz isso em portugues.
   */
  it('com frota E carro, a linha do carro diz que a regra DELE vence', () => {
    const fixture = render(() => of([fleet, perCar]));

    expect(rowOf(fixture, 'ABC1D23').textContent).toContain('usa a regra dele, não a da frota');
    expect(rowOf(fixture, 'Toda a frota').textContent).toContain(
      'carros que não têm regra própria',
    );
  });

  /**
   * CONTRAPESO: sem regra de frota, explicar a precedencia descreveria um conflito que nao
   * existe. Frase sem conflito e ruido, e ruido ensina a nao ler.
   */
  it('sem regra de frota, a linha do carro NAO fala de precedencia', () => {
    const fixture = render(() => of([perCar]));

    expect(rowOf(fixture, 'ABC1D23').textContent).not.toContain('não a da frota');
  });

  // --------------------------------------------------------------- DESLIGAR
  /**
   * O backend nao tem rota que alcance `vehicle_id` nulo: o unico DELETE e por veiculo e
   * `deactivate` busca por `findActiveByVehicle`. Entao a frota NAO pode ter botao de
   * desligar — seria botao que mente — e a linha EXPLICA por que, porque linha sem acao e
   * sem explicacao e pior que linha sem acao.
   */
  it('a FROTA nao oferece desligar, e diz o motivo', () => {
    const fixture = render(() => of([fleet]));
    const fleetRow = rowOf(fixture, 'Toda a frota');

    expect(
      Array.from(fleetRow.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Desligar'),
      ),
    ).toBeUndefined();
    expect(fleetRow.textContent).toContain('ainda não é possível por aqui');
  });

  /** CONTRAPESO: o CARRO oferece, porque ali o endpoint existe. */
  it('o CARRO oferece desligar, com confirmacao, e chama pelo vehicleId', () => {
    const fixture = render(() => of([perCar]));

    Array.from(rowOf(fixture, 'ABC1D23').querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Desligar'))
      ?.click();
    fixture.detectChanges();
    expect(deactivate).not.toHaveBeenCalled();

    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((b) => (b.textContent ?? '').trim() === 'Desligar')
      ?.click();
    fixture.detectChanges();

    expect(deactivate).toHaveBeenCalledWith('veh-1');
  });

  // ------------------------------------------------------------ AGENDAR FROTA
  it('agendar frota envia o corpo que o backend exige e RELE a lista', () => {
    const fixture = render(() => of([]));
    button(fixture, 'Agendar para toda a frota')?.click();
    fixture.detectChanges();

    const freq = (fixture.nativeElement as HTMLElement).querySelector(
      '#fleet-frequency',
    ) as HTMLSelectElement;
    freq.value = 'SEMIANNUAL';
    freq.dispatchEvent(new Event('change'));
    const start = (fixture.nativeElement as HTMLElement).querySelector(
      '#fleet-start',
    ) as HTMLInputElement;
    start.value = '2026-11-01';
    start.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(createForFleet).toHaveBeenCalledWith({
      frequency: 'SEMIANNUAL',
      startDate: '2026-11-01',
    });
    // A resposta do POST traz so a regra nova; as de carro vem da lista, e a tela precisa
    // das duas para explicar a precedencia.
    expect(list).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledWith(expect.stringContaining('cadastrar depois'));
  });

  it('sem data de inicio NAO chama o servidor', () => {
    const fixture = render(() => of([]));
    button(fixture, 'Agendar para toda a frota')?.click();
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(createForFleet).not.toHaveBeenCalled();
  });

  /**
   * COM REGRA DE FROTA VIGENTE, A ACAO SAI DA TELA — e e isso que este caso afirma, porque
   * foi o que eu consegui provar.
   *
   * O backend admite no maximo uma regra de frota e devolve 400 na segunda. A tela evita
   * esse 400 ANTES dele: sem convite e sem faixa compacta, nao ha como abrir o formulario.
   * Entao o ramo de `fleetCreateMessage` para esse 400 e defesa de CORRIDA (duas abas, duas
   * pessoas) e nao caminho alcancavel daqui — e por isso nao tem caso de UI. Escrevo isto
   * em vez de um teste chamado "a frase do 400" que na verdade so verifica que o formulario
   * nao abre.
   */
  it('com regra de frota vigente, a acao de agendar frota sai da tela', () => {
    const fixture = render(() => of([fleet, perCar]));

    expect(button(fixture, 'Agendar para toda a frota')).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).querySelector('#fleet-start')).toBeNull();
    // A regra continua visivel como LINHA — sai a acao, nao a informacao.
    expect(rowOf(fixture, 'Toda a frota')).toBeDefined();
  });

  it('403 diz quem pode agendar', () => {
    const fixture = render(() => throwError(() => error(403)));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'dono e os gerenciadores podem agendar',
    );
  });
  /**
   * A CAPACIDADE QUE TROCOU DE CASA, e que nao pode se perder na mudanca.
   *
   * Agendar UM carro so existia dentro de Detalhes do Veiculo
   * (`pages/vehicles/inspection-schedule-card`), num formulario identico campo a
   * campo a este. Aquele card foi removido: o agendamento nao mora mais na tela
   * do veiculo. Se este bloco nao soubesse agendar um carro especifico, a
   * remocao teria APAGADO a capacidade em vez de mudar o lugar dela.
   *
   * Por isso os dois caminhos sao testados aqui: frota e carro escolhido, cada
   * um no seu endpoint.
   */
  describe('alvo da regra: frota ou um carro', () => {
    function openWith(fixture: ReturnType<typeof render>, target: 'FLEET' | 'VEHICLE') {
      const host = fixture.nativeElement as HTMLElement;
      button(fixture, 'Agendar para toda a frota')?.click();
      fixture.detectChanges();
      const sel = target === 'VEHICLE' ? '[data-target-vehicle]' : '[data-target-fleet]';
      const radio = host.querySelector<HTMLInputElement>(sel);
      radio?.click();
      fixture.detectChanges();
      return host;
    }

    it('FROTA e o padrao — e a frase que o dono quer dizer', () => {
      const fixture = render();
      const host = fixture.nativeElement as HTMLElement;
      button(fixture, 'Agendar para toda a frota')?.click();
      fixture.detectChanges();

      expect(host.querySelector<HTMLInputElement>('[data-target-fleet]')?.checked).toBe(true);
      // Sem alvo de veiculo escolhido, o seletor de carro nem aparece.
      expect(host.querySelector('[data-schedule-vehicle]')).toBeNull();
    });

    it('escolher UM CARRO revela o seletor de veiculo', () => {
      const fixture = render();
      const host = openWith(fixture, 'VEHICLE');

      expect(host.querySelector('[data-schedule-vehicle]')).not.toBeNull();
    });

    /** O caminho novo: mesmo payload, endpoint do VEICULO. */
    it('salva no endpoint do VEICULO quando o alvo e um carro', () => {
      const fixture = render();
      const host = openWith(fixture, 'VEHICLE');
      const cmp = fixture.componentInstance as unknown as {
        scheduleForm: { patchValue(v: Record<string, unknown>): void };
        save(): void;
      };
      cmp.scheduleForm.patchValue({
        vehicleId: 'veh-1',
        frequency: 'MONTHLY',
        startDate: '2026-11-01',
      });
      fixture.detectChanges();
      cmp.save();
      fixture.detectChanges();

      expect(create).toHaveBeenCalledWith('veh-1', {
        frequency: 'MONTHLY',
        startDate: '2026-11-01',
      });
      expect(createForFleet).not.toHaveBeenCalled();
      expect(host).toBeDefined();
    });

    /**
     * O erro que seria silencioso e caro: alvo VEICULO sem carro escolhido NAO
     * pode cair no endpoint da frota. Seriam TODOS os carros agendados quando se
     * pediu um — e o usuario nao veria diferenca na hora.
     */
    it('alvo VEICULO sem carro escolhido NAO vira regra de frota', () => {
      const fixture = render();
      openWith(fixture, 'VEHICLE');
      const cmp = fixture.componentInstance as unknown as {
        scheduleForm: { patchValue(v: Record<string, unknown>): void };
        save(): void;
      };
      cmp.scheduleForm.patchValue({ frequency: 'MONTHLY', startDate: '2026-11-01' });
      fixture.detectChanges();
      cmp.save();
      fixture.detectChanges();

      expect(createForFleet).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('a frota continua usando o endpoint da frota', () => {
      const fixture = render();
      openWith(fixture, 'FLEET');
      const cmp = fixture.componentInstance as unknown as {
        scheduleForm: { patchValue(v: Record<string, unknown>): void };
        save(): void;
      };
      cmp.scheduleForm.patchValue({ frequency: 'MONTHLY', startDate: '2026-11-01' });
      fixture.detectChanges();
      cmp.save();
      fixture.detectChanges();

      expect(createForFleet).toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
