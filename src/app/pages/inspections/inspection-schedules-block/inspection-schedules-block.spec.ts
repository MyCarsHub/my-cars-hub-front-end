import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionSchedulesBlock } from './inspection-schedules-block';
import { ApiErrorService } from '../../../services/api-error.service';
import { InspectionScheduleService } from '../../../services/inspection-schedule.service';
import { NotificationService } from '../../../services/notification.service';
import type { InspectionScheduleResponse } from '../../../types/inspection-schedule.types';

/**
 * O cartao "Vistorias automaticas" e o dialogo que o configura — configurado UMA vez e
 * editado quando precisar, nao uma acao do dia a dia.
 *
 * O que estes casos protegem: o cartao NEUTRO (nada laranja, um botao outline); o dialogo com
 * a validacao do desenho; que salvar sobre a regra da frota seja "desligar e criar" na ordem
 * certa (o backend recusa um segundo POST de frota); que o "Desativar" so exista onde ele
 * vale; e que falha de leitura nao se disfarce de "desligado" — convidar a agendar sobre uma
 * regra que talvez exista criaria a segunda regra de frota que o servidor recusa.
 */
describe('InspectionSchedulesBlock — cartao e dialogo', () => {
  const fleet: InspectionScheduleResponse = {
    id: 'sch-fleet',
    vehicleId: null,
    frequency: 'BIWEEKLY',
    startDate: '2026-10-01',
    nextDueDate: '2026-10-25',
    reminderIntervalDays: 3,
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
    { id: 'veh-1', label: 'ABC-1234 · Fiat Mobi' },
    { id: 'veh-2', label: 'XYZ-9988 · Hyundai HB20' },
  ];

  let list: ReturnType<typeof vi.fn>;
  let createForFleet: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let deactivateFleet: ReturnType<typeof vi.fn>;
  let deactivate: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;

  function httpError(status: number, message?: string): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: message ? { message } : {} });
  }

  function render(
    listImpl: () => Observable<InspectionScheduleResponse[]> = () => of([]),
  ): ComponentFixture<InspectionSchedulesBlock> {
    TestBed.resetTestingModule();
    list = vi.fn(listImpl);
    createForFleet = vi.fn().mockReturnValue(of({ ...fleet, id: 'sch-new' }));
    create = vi.fn().mockReturnValue(of({ ...perCar, id: 'sch-new' }));
    deactivateFleet = vi.fn().mockReturnValue(of(undefined));
    deactivate = vi.fn().mockReturnValue(of(undefined));

    TestBed.configureTestingModule({
      imports: [InspectionSchedulesBlock],
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionScheduleService,
          useValue: { listForCompany: list, createForFleet, create, deactivateFleet, deactivate },
        },
      ],
    });
    success = vi.spyOn(TestBed.inject(NotificationService), 'success') as never;

    const fixture = TestBed.createComponent(InspectionSchedulesBlock);
    fixture.componentRef.setInput('vehicleOptions', VEHICLES);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  const host = (f: ComponentFixture<InspectionSchedulesBlock>) => f.nativeElement as HTMLElement;
  const text = (f: ComponentFixture<InspectionSchedulesBlock>) =>
    (host(f).textContent ?? '').replace(/\s+/g, ' ');
  const q = <T extends Element = HTMLElement>(f: ComponentFixture<InspectionSchedulesBlock>, s: string) =>
    host(f).querySelector<T>(s);
  const dialog = (f: ComponentFixture<InspectionSchedulesBlock>) =>
    host(f).querySelector<HTMLElement>('app-members-sheet [role="dialog"]');

  function openDialog(f: ComponentFixture<InspectionSchedulesBlock>): void {
    q<HTMLButtonElement>(f, '[data-schedule-open]')?.click();
    f.detectChanges();
    f.detectChanges();
  }

  /** Os chips de um grupo (por id do rotulo) e qual esta marcado. */
  function chips(f: ComponentFixture<InspectionSchedulesBlock>, labelId: string) {
    const all = Array.from(
      host(f).querySelectorAll<HTMLButtonElement>(`[aria-labelledby="${labelId}"] [role="radio"]`),
    );
    return {
      labels: all.map((c) => c.textContent?.trim()),
      checked: all.filter((c) => c.getAttribute('aria-checked') === 'true').map((c) => c.textContent?.trim()),
      click: (label: string) => {
        all.find((c) => c.textContent?.trim() === label)?.click();
        f.detectChanges();
      },
    };
  }

  function setDate(f: ComponentFixture<InspectionSchedulesBlock>, value: string): void {
    const input = q<HTMLInputElement>(f, '#sch-date')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function save(f: ComponentFixture<InspectionSchedulesBlock>): void {
    q<HTMLButtonElement>(f, '[data-schedule-save]')?.click();
    f.detectChanges();
    f.detectChanges();
  }

  beforeEach(() => {
    // So o RELOGIO: o resto (timers do Angular) segue real. 12:00 em Brasilia, 2026-10-10.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T15:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================== o cartao

  describe('cartao', () => {
    it('e neutro: branco, com UM botao outline — nada laranja', () => {
      const fixture = render();
      const card = q(fixture, '[data-schedule-card]')!;
      const button = q(fixture, '[data-schedule-open]')!;

      expect(card.className).toContain('bg-white');
      expect(button.className).toContain('border-neutral-200');
      // Nenhum PREENCHIMENTO laranja (o anel de foco e laranja em todo o app e nao conta).
      expect(card.innerHTML).not.toMatch(/bg-primary-/);
      expect(card.querySelectorAll('button').length).toBe(1);
    });

    it('enquanto le, nao mostra botao nem chip (nao sabe se esta ativo)', () => {
      const fixture = render(() => new Subject<InspectionScheduleResponse[]>());

      expect(q(fixture, '[data-schedule-open]')).toBeNull();
      expect(q(fixture, '[data-schedule-chip]')).toBeNull();
      expect(q(fixture, '.animate-pulse')).not.toBeNull();
    });

    it('desligado: chip "Desligado", a explicacao e "Configurar"', () => {
      const fixture = render();

      expect(q(fixture, '[data-schedule-chip]')?.textContent?.trim()).toBe('Desligado');
      expect(q(fixture, '[data-schedule-chip]')?.className).toContain('bg-neutral-100');
      expect(q(fixture, '[data-schedule-text]')?.textContent?.trim()).toBe(
        'Peça as vistorias aos motoristas automaticamente, para todos os veículos, sem precisar lembrar de cada um.',
      );
      expect(q(fixture, '[data-schedule-open]')?.textContent?.trim()).toBe('Configurar');
      expect(q(fixture, 'span[aria-hidden="true"]')?.className).toContain('bg-neutral-100');
    });

    it('ativo: chip "Ativo" verde, a regra em uma frase e "Editar"', () => {
      const fixture = render(() => of([fleet]));

      expect(q(fixture, '[data-schedule-chip]')?.textContent?.trim()).toBe('Ativo');
      expect(q(fixture, '[data-schedule-chip]')?.className).toContain('bg-emerald-100');
      expect(q(fixture, '[data-schedule-text]')?.textContent?.trim()).toBe(
        'Toda a frota, a cada 15 dias. Próxima em 25/10/2026, com aviso 3 dias antes.',
      );
      expect(q(fixture, '[data-schedule-open]')?.textContent?.trim()).toBe('Editar');
      expect(q(fixture, 'span[aria-hidden="true"]')?.className).toContain('bg-emerald-50');
      expect(q(fixture, 'span[aria-hidden="true"]')?.className).toContain('text-emerald-700');
    });

    it('a frequencia entra na frase com o nome que o servidor usa', () => {
      const fixture = render(() => of([{ ...fleet, frequency: 'MONTHLY', reminderIntervalDays: 1 }]));

      expect(q(fixture, '[data-schedule-text]')?.textContent?.trim()).toBe(
        'Toda a frota, todo mês. Próxima em 25/10/2026, com aviso 1 dia antes.',
      );
    });

    it('conta os veiculos com regra propria, no singular e no plural', () => {
      const one = render(() => of([fleet, perCar]));
      expect(q(one, '[data-schedule-text]')?.textContent).toContain(
        ' 1 veículo com regra própria.',
      );

      const two = render(() => of([fleet, perCar, { ...perCar, id: 's2', vehicleId: 'veh-2' }]));
      expect(q(two, '[data-schedule-text]')?.textContent).toContain(
        ' 2 veículos com regra própria.',
      );
    });

    it('regra desativada nao conta', () => {
      const fixture = render(() => of([{ ...fleet, active: false }]));

      expect(q(fixture, '[data-schedule-chip]')?.textContent?.trim()).toBe('Desligado');
    });

    it('falha de leitura NAO vira "Desligado": diz que nao carregou e oferece tentar de novo', () => {
      let failing = true;
      const fixture = render(() =>
        failing ? throwError(() => httpError(500)) : of([fleet]),
      );

      expect(q(fixture, '[data-schedule-load-error]')).not.toBeNull();
      expect(q(fixture, '[data-schedule-chip]')).toBeNull();
      expect(q(fixture, '[data-schedule-open]')).toBeNull();

      failing = false;
      q<HTMLButtonElement>(fixture, '[data-schedule-retry]')?.click();
      fixture.detectChanges();

      expect(list).toHaveBeenCalledTimes(2);
      expect(q(fixture, '[data-schedule-chip]')?.textContent?.trim()).toBe('Ativo');
    });

    it('o botao e de 44px e largura total no celular', () => {
      const fixture = render();
      const button = q(fixture, '[data-schedule-open]')!;

      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('w-full');
      expect(button.className).toContain('@min-[592px]:w-auto');
    });
  });

  // ============================================================== o dialogo

  describe('dialogo', () => {
    it('nasce fechado, abre no botao e traz o titulo e a frase de apoio do desenho', () => {
      const fixture = render();
      expect(dialog(fixture)).toBeNull();

      openDialog(fixture);

      expect(dialog(fixture)).not.toBeNull();
      expect(dialog(fixture)?.querySelector('h2')?.textContent?.trim()).toBe(
        'Ativar vistorias automáticas',
      );
      expect(dialog(fixture)?.textContent).toContain(
        'Você configura uma vez. As vistorias passam a ser pedidas aos motoristas sozinhas, e dá para mudar quando precisar.',
      );
    });

    it('com regra, o titulo vira "Agendamento automático"', () => {
      const fixture = render(() => of([fleet]));
      openDialog(fixture);

      expect(dialog(fixture)?.querySelector('h2')?.textContent?.trim()).toBe(
        'Agendamento automático',
      );
    });

    it('o padrao e toda a frota, a cada 15 dias, avisando 3 dias antes', () => {
      const fixture = render();
      openDialog(fixture);

      expect(chips(fixture, 'sch-scope').checked).toEqual(['Toda a frota']);
      expect(chips(fixture, 'sch-scope').labels).toEqual(['Toda a frota', 'Um veículo']);
      expect(chips(fixture, 'sch-freq').checked).toEqual(['A cada 15 dias']);
      expect(chips(fixture, 'sch-notice').labels).toEqual(['1 dia antes', '3 dias antes', '7 dias antes']);
      expect(chips(fixture, 'sch-notice').checked).toEqual(['3 dias antes']);
      expect(q(fixture, '[data-scope-hint]')?.textContent?.trim()).toBe(
        'Vale também para carros cadastrados depois.',
      );
    });

    it('oferece as frequencias que o BACKEND aceita, sem inventar "60 dias"', () => {
      const fixture = render();
      openDialog(fixture);

      expect(chips(fixture, 'sch-freq').labels).toEqual([
        'Todo dia',
        'Toda semana',
        'A cada 15 dias',
        'Todo mês',
        'A cada 3 meses',
        'A cada 6 meses',
        'Todo ano',
      ]);
    });

    it('"Um veículo" revela o seletor de veiculo e troca a dica', () => {
      const fixture = render();
      openDialog(fixture);
      expect(q(fixture, '#sch-vehicle')).toBeNull();

      chips(fixture, 'sch-scope').click('Um veículo');

      const select = q<HTMLSelectElement>(fixture, '#sch-vehicle')!;
      expect(select).not.toBeNull();
      expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
        'Selecione o veículo',
        'ABC-1234 · Fiat Mobi',
        'XYZ-9988 · Hyundai HB20',
      ]);
      expect(q(fixture, '[data-scope-hint]')?.textContent?.trim()).toBe(
        'Use para um carro que precisa de ritmo diferente do resto da frota.',
      );
    });

    it('a data e obrigatoria, tem minimo "amanha" (Brasilia) e a ajuda do desenho', () => {
      const fixture = render();
      openDialog(fixture);
      const input = q<HTMLInputElement>(fixture, '#sch-date')!;

      expect(input.getAttribute('type')).toBe('date');
      expect(input.getAttribute('min')).toBe('2026-10-11');
      expect(dialog(fixture)?.textContent).toContain(
        'O motorista tira as 14 fotos e informa o hodômetro nessa data.',
      );
    });

    it('os campos sao de 16px no celular e 44px de altura', () => {
      const fixture = render();
      openDialog(fixture);
      chips(fixture, 'sch-scope').click('Um veículo');

      for (const sel of ['#sch-date', '#sch-vehicle']) {
        const el = q(fixture, sel)!;
        expect(el.className, sel).toContain('text-base');
        expect(el.className, sel).toContain('min-h-[44px]');
      }
    });

    it('o resumo acompanha as escolhas', () => {
      const fixture = render();
      openDialog(fixture);
      expect(q(fixture, '[data-schedule-preview]')?.textContent?.trim()).toBe(
        'Vistoria de todos os veículos, a cada 15 dias. Escolha a data da primeira.',
      );

      setDate(fixture, '2026-10-20');
      expect(q(fixture, '[data-schedule-preview]')?.textContent?.trim()).toBe(
        'Vistoria de todos os veículos, a cada 15 dias, a primeira em 20/10/2026. O motorista é avisado 3 dias antes.',
      );

      chips(fixture, 'sch-notice').click('1 dia antes');
      chips(fixture, 'sch-freq').click('Todo mês');
      expect(q(fixture, '[data-schedule-preview]')?.textContent?.trim()).toBe(
        'Vistoria de todos os veículos, todo mês, a primeira em 20/10/2026. O motorista é avisado 1 dia antes.',
      );

      chips(fixture, 'sch-scope').click('Um veículo');
      const select = q<HTMLSelectElement>(fixture, '#sch-vehicle')!;
      select.value = 'veh-2';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(q(fixture, '[data-schedule-preview]')?.textContent).toContain(
        'Vistoria de XYZ-9988, todo mês',
      );
    });

    it('um aviso salvo fora de 1/3/7 aparece como chip, em vez de sumir', () => {
      const fixture = render(() => of([{ ...fleet, reminderIntervalDays: 5 }]));
      openDialog(fixture);

      expect(chips(fixture, 'sch-notice').labels).toEqual([
        '1 dia antes',
        '3 dias antes',
        '5 dias antes',
        '7 dias antes',
      ]);
      expect(chips(fixture, 'sch-notice').checked).toEqual(['5 dias antes']);
    });

    it('fecha no X (44x44), no fundo, no Esc e em Cancelar', () => {
      const fixture = render();
      const reopen = () => openDialog(fixture);

      reopen();
      const close = q<HTMLElement>(fixture, 'app-members-sheet [aria-label="Fechar"]')!;
      expect(close.className).toContain('min-h-[44px]');
      expect(close.className).toContain('min-w-[44px]');
      close.click();
      fixture.detectChanges();
      expect(dialog(fixture)).toBeNull();

      reopen();
      q<HTMLElement>(fixture, 'app-members-sheet [aria-hidden="true"]')?.click();
      fixture.detectChanges();
      expect(dialog(fixture)).toBeNull();

      reopen();
      dialog(fixture)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(dialog(fixture)).toBeNull();

      reopen();
      q<HTMLButtonElement>(fixture, '[data-schedule-cancel]')?.click();
      fixture.detectChanges();
      expect(dialog(fixture)).toBeNull();
    });

    it('no celular os botoes empilham com o primario ACIMA de Cancelar', () => {
      const fixture = render();
      openDialog(fixture);
      const footer = q(fixture, '[data-schedule-save]')!.parentElement!;

      expect(footer.className).toContain('flex-col-reverse');
      expect(footer.className).toContain('sm:flex-row');
      const order = Array.from(footer.querySelectorAll('button')).map((b) => b.textContent?.trim());
      expect(order).toEqual(['Cancelar', 'Ativar']);
      expect(q(fixture, '[data-schedule-save]')?.className).toContain('bg-primary-500');
      expect(q(fixture, '[data-schedule-cancel]')?.className).toContain('border-neutral-200');
    });
  });

  // ============================================================== validacao

  describe('validacao', () => {
    it('sem data: "Informe a data da primeira vistoria." e nada e enviado', () => {
      const fixture = render();
      openDialog(fixture);

      save(fixture);

      expect(dialog(fixture)?.textContent).toContain('Informe a data da primeira vistoria.');
      expect(createForFleet).not.toHaveBeenCalled();
      expect(q(fixture, '#sch-date')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('hoje ou antes: "Escolha uma data a partir de amanhã."', () => {
      const fixture = render();
      openDialog(fixture);

      setDate(fixture, '2026-10-10');
      save(fixture);
      expect(dialog(fixture)?.textContent).toContain('Escolha uma data a partir de amanhã.');

      setDate(fixture, '2026-09-01');
      save(fixture);
      expect(dialog(fixture)?.textContent).toContain('Escolha uma data a partir de amanhã.');
      expect(createForFleet).not.toHaveBeenCalled();
    });

    it('amanha ja vale', () => {
      const fixture = render();
      openDialog(fixture);

      setDate(fixture, '2026-10-11');
      save(fixture);

      expect(createForFleet).toHaveBeenCalledTimes(1);
    });

    it('"Um veículo" sem escolher o veiculo: "Selecione o veículo."', () => {
      const fixture = render();
      openDialog(fixture);
      chips(fixture, 'sch-scope').click('Um veículo');
      setDate(fixture, '2026-10-20');

      save(fixture);

      expect(dialog(fixture)?.textContent).toContain('Selecione o veículo.');
      expect(create).not.toHaveBeenCalled();
      expect(createForFleet).not.toHaveBeenCalled();
    });

    it('voltar para "Toda a frota" nao deixa o veiculo travar o envio', () => {
      const fixture = render();
      openDialog(fixture);
      chips(fixture, 'sch-scope').click('Um veículo');
      chips(fixture, 'sch-scope').click('Toda a frota');
      setDate(fixture, '2026-10-20');

      save(fixture);

      expect(createForFleet).toHaveBeenCalledTimes(1);
    });
  });

  // ================================================================ salvar

  describe('salvar', () => {
    it('frota nova: cria a regra da frota, avisa com a frase do desenho e relê', () => {
      const fixture = render();
      openDialog(fixture);
      setDate(fixture, '2026-10-20');

      save(fixture);

      expect(createForFleet).toHaveBeenCalledWith({
        frequency: 'BIWEEKLY',
        startDate: '2026-10-20',
        reminderIntervalDays: 3,
      });
      expect(deactivateFleet).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith('Agendamento da frota salvo.');
      expect(dialog(fixture)).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('um veiculo: cria a regra DELE e avisa com a placa entre «aspas»', () => {
      const fixture = render();
      openDialog(fixture);
      chips(fixture, 'sch-scope').click('Um veículo');
      const select = q<HTMLSelectElement>(fixture, '#sch-vehicle')!;
      select.value = 'veh-1';
      select.dispatchEvent(new Event('change'));
      chips(fixture, 'sch-freq').click('Toda semana');
      chips(fixture, 'sch-notice').click('7 dias antes');
      setDate(fixture, '2026-11-02');

      save(fixture);

      expect(create).toHaveBeenCalledWith('veh-1', {
        frequency: 'WEEKLY',
        startDate: '2026-11-02',
        reminderIntervalDays: 7,
      });
      expect(createForFleet).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith('Agendamento de «ABC-1234» salvo.');
    });

    it('enquanto salva, o botao avisa e nao envia duas vezes', () => {
      const pending = new Subject<InspectionScheduleResponse>();
      const fixture = render();
      createForFleet.mockReturnValue(pending);
      openDialog(fixture);
      setDate(fixture, '2026-10-20');

      save(fixture);
      expect(q(fixture, '[data-schedule-save]')?.textContent).toContain('Salvando');
      save(fixture);

      expect(createForFleet).toHaveBeenCalledTimes(1);
    });

    it('erro do servidor fica no dialogo, com o que a pessoa digitou', () => {
      const fixture = render();
      createForFleet.mockReturnValue(
        throwError(() => httpError(400, 'A data inicial não pode estar no passado.')),
      );
      openDialog(fixture);
      setDate(fixture, '2026-10-20');

      save(fixture);

      expect(dialog(fixture)?.textContent).toContain('A data inicial não pode estar no passado.');
      expect(success).not.toHaveBeenCalled();
      expect(q<HTMLInputElement>(fixture, '#sch-date')?.value).toBe('2026-10-20');
    });

    it('403 explica quem pode agendar', () => {
      const fixture = render();
      createForFleet.mockReturnValue(throwError(() => httpError(403)));
      openDialog(fixture);
      setDate(fixture, '2026-10-20');

      save(fixture);

      expect(dialog(fixture)?.textContent).toContain('Só o dono e os gerenciadores');
    });
  });

  // ============================================ editar a regra existente

  describe('editar a regra da frota', () => {
    it('abre preenchido com a regra e o botao vira "Salvar alterações"', () => {
      const fixture = render(() => of([{ ...fleet, frequency: 'MONTHLY', reminderIntervalDays: 7 }]));
      openDialog(fixture);

      expect(chips(fixture, 'sch-freq').checked).toEqual(['Todo mês']);
      expect(chips(fixture, 'sch-notice').checked).toEqual(['7 dias antes']);
      expect(q<HTMLInputElement>(fixture, '#sch-date')?.value).toBe('2026-10-25');
      expect(q(fixture, '[data-schedule-save]')?.textContent?.trim()).toBe('Salvar alterações');
    });

    it('avisa que salvar substitui o atual', () => {
      const fixture = render(() => of([fleet]));
      openDialog(fixture);

      expect(q(fixture, '[data-replace-notice]')?.textContent?.trim()).toBe(
        'Já existe um agendamento para toda a frota. Salvar substitui o atual.',
      );
    });

    it('sem regra, nao ha aviso de substituicao', () => {
      const fixture = render();
      openDialog(fixture);

      expect(q(fixture, '[data-replace-notice]')).toBeNull();
    });

    it('para um veiculo que ja tem regra, o aviso nomeia a placa', () => {
      const fixture = render(() => of([fleet, perCar]));
      openDialog(fixture);
      chips(fixture, 'sch-scope').click('Um veículo');
      const select = q<HTMLSelectElement>(fixture, '#sch-vehicle')!;
      select.value = 'veh-1';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(q(fixture, '[data-replace-notice]')?.textContent?.trim()).toBe(
        'Já existe um agendamento para ABC-1234. Salvar substitui o atual.',
      );
    });

    /**
     * O backend responde 400 ao segundo POST de frota: substituir e DESLIGAR e CRIAR, e a
     * ordem e o que o teste prende. Invertida, a criacao seria recusada.
     */
    it('substitui desligando a atual ANTES de criar a nova', () => {
      const calls: string[] = [];
      const fixture = render(() => of([fleet]));
      deactivateFleet.mockImplementation(() => {
        calls.push('deactivate');
        return of(undefined);
      });
      createForFleet.mockImplementation(() => {
        calls.push('create');
        return of({ ...fleet, id: 'sch-new' });
      });
      openDialog(fixture);
      setDate(fixture, '2026-11-05');
      chips(fixture, 'sch-freq').click('A cada 3 meses');

      save(fixture);

      expect(calls).toEqual(['deactivate', 'create']);
      expect(createForFleet).toHaveBeenCalledWith({
        frequency: 'QUARTERLY',
        startDate: '2026-11-05',
        reminderIntervalDays: 3,
      });
      expect(success).toHaveBeenCalledWith('Agendamento da frota salvo.');
    });

    it('se a criacao falha depois do desligamento, DIZ que a anterior foi desativada e relê', () => {
      const fixture = render(() => of([fleet]));
      createForFleet.mockReturnValue(throwError(() => httpError(500)));
      openDialog(fixture);
      setDate(fixture, '2026-11-05');

      save(fixture);

      expect(dialog(fixture)?.textContent).toContain(
        'O agendamento anterior foi desativado, mas não foi possível salvar o novo.',
      );
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('se o DESLIGAMENTO falha, nada foi alterado e a frase nao mente', () => {
      const fixture = render(() => of([fleet]));
      deactivateFleet.mockReturnValue(throwError(() => httpError(500)));
      openDialog(fixture);
      setDate(fixture, '2026-11-05');

      save(fixture);

      expect(createForFleet).not.toHaveBeenCalled();
      expect(dialog(fixture)?.textContent).not.toContain('foi desativado');
      expect(list).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================== Desativar

  describe('Desativar', () => {
    const off = (f: ComponentFixture<InspectionSchedulesBlock>) =>
      q<HTMLButtonElement>(f, '[data-schedule-off]');

    it('so existe quando ha regra da frota ativa', () => {
      const semRegra = render();
      openDialog(semRegra);
      expect(off(semRegra)).toBeNull();

      const comRegra = render(() => of([fleet]));
      openDialog(comRegra);
      expect(off(comRegra)).not.toBeNull();
      expect(off(comRegra)?.textContent?.trim()).toBe('Desativar');
      expect(off(comRegra)?.className).toContain('text-rose-600');
    });

    it('com alvo "Um veículo" sem regra propria, nao ha o que desligar', () => {
      const fixture = render(() => of([fleet]));
      openDialog(fixture);

      chips(fixture, 'sch-scope').click('Um veículo');
      expect(off(fixture)).toBeNull();

      // Escolher um carro SEM regra propria tambem nao oferece.
      const select = q<HTMLSelectElement>(fixture, '#sch-vehicle')!;
      select.value = 'veh-2';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(off(fixture)).toBeNull();
    });

    /**
     * O desenho so traz "Desativar" na frota, mas o bloco anterior era a UNICA tela que
     * desligava a regra de um carro. Sem esta saida o dono criaria uma regra por veiculo e
     * nao teria como tira-la.
     */
    it('o carro que ja tem regra propria pode ser desligado, pelo endpoint DO VEICULO', () => {
      const fixture = render(() => of([fleet, perCar]));
      openDialog(fixture);
      chips(fixture, 'sch-scope').click('Um veículo');
      const select = q<HTMLSelectElement>(fixture, '#sch-vehicle')!;
      select.value = 'veh-1';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(off(fixture)).not.toBeNull();
      off(fixture)?.click();
      fixture.detectChanges();

      const dialogText = host(fixture).querySelector('app-confirm-dialog [role="dialog"]')?.textContent;
      expect(dialogText).toContain('O carro deixa de receber');
      expect(deactivate).not.toHaveBeenCalled();

      Array.from(host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'))
        .find((b) => b.textContent?.trim() === 'Desativar')
        ?.click();
      fixture.detectChanges();

      expect(deactivate).toHaveBeenCalledWith('veh-1');
      expect(deactivateFleet).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith('Agendamento de «ABC-1234» desativado.');
      expect(dialog(fixture)).toBeNull();
    });

    it('pede confirmacao antes de desligar — a regra cancela os pedidos pendentes', () => {
      const fixture = render(() => of([fleet]));
      openDialog(fixture);

      off(fixture)?.click();
      fixture.detectChanges();

      expect(deactivateFleet).not.toHaveBeenCalled();
      const confirm = host(fixture).querySelector('app-confirm-dialog [role="dialog"]');
      expect(confirm?.textContent).toContain('Desativar vistorias automáticas');
      // So UMA camada modal por vez: o dialogo sai enquanto a confirmacao esta na tela.
      expect(dialog(fixture)).toBeNull();
    });

    it('confirmando: desliga, avisa, fecha e relê', () => {
      const fixture = render(() => of([fleet]));
      openDialog(fixture);
      off(fixture)?.click();
      fixture.detectChanges();

      Array.from(host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'))
        .find((b) => b.textContent?.trim() === 'Desativar')
        ?.click();
      fixture.detectChanges();

      expect(deactivateFleet).toHaveBeenCalledTimes(1);
      expect(success).toHaveBeenCalledWith('Agendamento automático desativado.');
      expect(dialog(fixture)).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('"Voltar" na confirmacao nao desliga nada', async () => {
      const fixture = render(() => of([fleet]));
      openDialog(fixture);
      off(fixture)?.click();
      fixture.detectChanges();

      Array.from(host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'))
        .find((b) => b.textContent?.trim() === 'Voltar')
        ?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(deactivateFleet).not.toHaveBeenCalled();
      expect(dialog(fixture)).not.toBeNull();
    });

    it('falha ao desligar fica no dialogo e nao diz que desligou', () => {
      const fixture = render(() => of([fleet]));
      deactivateFleet.mockReturnValue(throwError(() => httpError(404, 'Esta empresa não possui agendamento.')));
      openDialog(fixture);
      off(fixture)?.click();
      fixture.detectChanges();

      Array.from(host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'))
        .find((b) => b.textContent?.trim() === 'Desativar')
        ?.click();
      fixture.detectChanges();

      expect(success).not.toHaveBeenCalled();
      expect(dialog(fixture)?.textContent).toContain('Esta empresa não possui agendamento.');
    });
  });
});
