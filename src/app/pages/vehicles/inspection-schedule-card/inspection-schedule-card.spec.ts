import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionScheduleCard } from './inspection-schedule-card';
import { ApiErrorService } from '../../../services/api-error.service';
import { InspectionScheduleService } from '../../../services/inspection-schedule.service';
import { NotificationService } from '../../../services/notification.service';
import type { InspectionScheduleResponse } from '../../../types/inspection-schedule.types';

/**
 * O agendamento era a porta que nunca existiu: o backend tem a tabela, a consulta e o motor
 * de notificacao, e a medicao que originou este trabalho foi **ZERO agendamentos em
 * producao** — ligar o motor sem esta tela e ligar um motor em ponto morto.
 *
 * O que estes casos protegem: que o 404 seja lido como "nao tem" e nao como falha, que a
 * frequencia apareca em portugues, que o corpo enviado seja o que o backend exige, e que
 * DESLIGAR exista — agendamento que nao da para desligar e armadilha.
 */
describe('InspectionScheduleCard — vistoria periodica de um veiculo', () => {
  const VEHICLE = 'veh-1';

  const existing: InspectionScheduleResponse = {
    id: 'sched-1',
    vehicleId: VEHICLE,
    frequency: 'QUARTERLY',
    startDate: '2026-10-01',
    nextDueDate: '2027-01-01',
    reminderIntervalDays: 7,
    active: true,
  };

  let get: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let deactivate: ReturnType<typeof vi.fn>;
  let success: ReturnType<typeof vi.fn>;

  function error(status: number): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { message: 'falhou' } });
  }

  function render(
    getImpl: () => Observable<InspectionScheduleResponse> = () => of(existing),
  ): ComponentFixture<InspectionScheduleCard> {
    TestBed.resetTestingModule();
    get = vi.fn(getImpl);
    create = vi.fn(() => of({ ...existing, frequency: 'MONTHLY' as const }));
    deactivate = vi.fn(() => of(undefined));
    success = vi.fn();

    TestBed.configureTestingModule({
      imports: [InspectionScheduleCard],
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionScheduleService,
          useValue: { get, create, deactivate },
        },
        {
          provide: NotificationService,
          useValue: { success, error: vi.fn(), warning: vi.fn(), info: vi.fn(), push: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(InspectionScheduleCard);
    fixture.componentRef.setInput('vehicleId', VEHICLE);
    fixture.detectChanges();
    return fixture;
  }

  function button(fixture: ComponentFixture<InspectionScheduleCard>, text: string) {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').includes(text));
  }

  function field<T extends HTMLElement>(
    fixture: ComponentFixture<InspectionScheduleCard>,
    id: string,
  ): T {
    const el = (fixture.nativeElement as HTMLElement).querySelector(`#${id}`);
    if (!el) throw new Error(`campo ${id} nao esta na tela`);
    return el as T;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------------- O ESTADO VAZIO
  /**
   * 404 e a resposta NORMAL para "este veiculo nao tem agendamento", e hoje e o caso de
   * praticamente todos os carros. Pintar isso como erro faria a tela parecer quebrada
   * justamente no estado que ela existe para resolver.
   */
  it('404 no GET e o estado VAZIO, com convite para agendar — nao e erro', () => {
    const fixture = render(() => throwError(() => error(404)));
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('não tem vistoria periódica');
    expect(button(fixture, 'Agendar vistoria periódica')).toBeDefined();
    // Nenhuma faixa de erro: `app-alert-banner` de erro nao pode estar na tela.
    expect((fixture.nativeElement as HTMLElement).querySelector('app-alert-banner')).toBeNull();
  });

  /**
   * CONTRAPESO, e ele achou um defeito de verdade: um 500 E erro e nao e ausencia.
   *
   * Sem este caso a tela dizia "este veiculo nao tem vistoria periodica" depois de uma falha
   * de leitura — afirmando o que nao sabe — e oferecia agendar, que sobre um agendamento
   * existente seria sobrescrever as cegas. Falha agora tem saida propria: tentar de novo.
   */
  it('500 no GET e FALHA, nao ausencia: nao afirma nada e oferece tentar de novo', () => {
    const fixture = render(() => throwError(() => error(500)));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-alert-banner')).not.toBeNull();
    expect(button(fixture, 'Tentar de novo')).toBeDefined();
    // Nao pode afirmar ausencia nem oferecer agendar sobre o que talvez exista.
    expect(host.textContent).not.toContain('não tem vistoria periódica');
    expect(button(fixture, 'Agendar vistoria periódica')).toBeUndefined();
  });

  it('tentar de novo refaz a leitura', () => {
    const fixture = render(() => throwError(() => error(500)));
    expect(get).toHaveBeenCalledTimes(1);

    button(fixture, 'Tentar de novo')?.click();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('agendamento DESLIGADO (active false) conta como nao ter', () => {
    const fixture = render(() => of({ ...existing, active: false }));

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'não tem vistoria periódica',
    );
  });

  // -------------------------------------------------- LINGUAGEM DE GENTE
  /**
   * O enum do banco NAO aparece na tela. QUARTERLY e o que a coluna guarda; "A cada 3 meses"
   * e o que o dono de locadora diz.
   */
  it('mostra a frequencia em portugues, nunca o nome do enum', () => {
    const fixture = render();
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('A cada 3 meses');
    expect(text).not.toContain('QUARTERLY');
  });

  it('o seletor oferece os SETE valores do backend, todos traduzidos', () => {
    const fixture = render(() => throwError(() => error(404)));
    button(fixture, 'Agendar vistoria periódica')?.click();
    fixture.detectChanges();

    const options = Array.from(
      field<HTMLSelectElement>(fixture, 'sched-frequency').querySelectorAll('option'),
    );
    expect(options).toHaveLength(7);
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Todo dia',
      'Toda semana',
      'A cada 15 dias',
      'Todo mês',
      'A cada 3 meses',
      'A cada 6 meses',
      'Todo ano',
    ]);
    // Nenhum rotulo pode ser o nome cru do enum.
    expect(options.every((o) => (o.textContent ?? '').trim() !== (o.getAttribute('value') ?? ''))).toBe(
      true,
    );
  });

  it('a proxima data vem do SERVIDOR e e exibida como esta', () => {
    const fixture = render();

    // 01/01/2027 e o `nextDueDate` da resposta — a tela nao recalcula nada.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('01/01/2027');
  });

  // ------------------------------------------------------------ CRIAR
  it('salvar envia frequencia e data de inicio no corpo que o backend exige', () => {
    const fixture = render(() => throwError(() => error(404)));
    button(fixture, 'Agendar vistoria periódica')?.click();
    fixture.detectChanges();

    const freq = field<HTMLSelectElement>(fixture, 'sched-frequency');
    freq.value = 'SEMIANNUAL';
    freq.dispatchEvent(new Event('change'));
    const start = field<HTMLInputElement>(fixture, 'sched-start');
    start.value = '2026-11-01';
    start.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(create).toHaveBeenCalledWith(VEHICLE, {
      frequency: 'SEMIANNUAL',
      startDate: '2026-11-01',
    });
    expect(success).toHaveBeenCalled();
  });

  /**
   * Dias de aviso em branco sai AUSENTE do corpo, nao nulo: sem valor, o backend mantem o
   * padrao DELE em vez de a tela inventar um numero.
   */
  it('aviso em branco nao vai no corpo; preenchido vai como numero', () => {
    const fixture = render(() => throwError(() => error(404)));
    button(fixture, 'Agendar vistoria periódica')?.click();
    fixture.detectChanges();

    const start = field<HTMLInputElement>(fixture, 'sched-start');
    start.value = '2026-11-01';
    start.dispatchEvent(new Event('input'));
    const reminder = field<HTMLInputElement>(fixture, 'sched-reminder');
    reminder.value = '15';
    reminder.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(create).toHaveBeenCalledWith(VEHICLE, {
      frequency: 'MONTHLY',
      startDate: '2026-11-01',
      reminderIntervalDays: 15,
    });
  });

  it('sem data de inicio NAO chama o servidor', () => {
    const fixture = render(() => throwError(() => error(404)));
    button(fixture, 'Agendar vistoria periódica')?.click();
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(create).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------- DESLIGAR
  /** Agendamento que nao da para desligar e armadilha. */
  it('desligar pede confirmacao antes de chamar o servidor', () => {
    const fixture = render();

    button(fixture, 'Desligar')?.click();
    fixture.detectChanges();

    expect(deactivate).not.toHaveBeenCalled();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('deixa de gerar vistorias automáticas');

    Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((b) => (b.textContent ?? '').trim() === 'Desligar')
      ?.click();
    fixture.detectChanges();

    expect(deactivate).toHaveBeenCalledWith(VEHICLE);
    // Volta ao estado vazio, com o convite para agendar de novo.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'não tem vistoria periódica',
    );
  });

  it('403 numa alteracao diz que falta permissao, sem erro cru', () => {
    const fixture = render();
    deactivate.mockReturnValue(throwError(() => error(403)));

    button(fixture, 'Desligar')?.click();
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((b) => (b.textContent ?? '').trim() === 'Desligar')
      ?.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'não tem permissão para alterar',
    );
  });
});
