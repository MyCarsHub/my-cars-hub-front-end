import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../../services/notification.service';
import type { OverdueSettings, OverdueSettingsUpdate } from '../../../types/overdue.types';
import { OverdueFee } from './overdue-fee';
import { OverdueSettingsService } from './overdue-settings.service';

/**
 * Cobre Configurações → Devolução com atraso:
 *  - carregar a regra em vigor + selo padrão × personalizado;
 *  - salvar como SUBSTITUIÇÃO (multiplicador em "x" convertido para bps);
 *  - restaurar o padrão em um clique, com os números à vista;
 *  - validação usando os limites que vieram na resposta, sem constante local;
 *  - o erro do servidor (400 fora de faixa / 403 de papel) chegando à tela.
 */
describe('OverdueFee (Configurações → Devolução com atraso)', () => {
  const SETTINGS: OverdueSettings = {
    multiplierBps: 15_000,
    graceHours: 3,
    customized: false,
    defaultMultiplierBps: 15_000,
    defaultGraceHours: 3,
    minMultiplierBps: 10_000,
    maxMultiplierBps: 50_000,
    minGraceHours: 0,
    maxGraceHours: 72,
  };

  let settingsSignal: ReturnType<typeof signal<OverdueSettings | null>>;
  let loadSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let successSpy: ReturnType<typeof vi.fn>;
  let current: OverdueSettings;

  function configure(): void {
    settingsSignal = signal<OverdueSettings | null>(null);
    successSpy = vi.fn();

    loadSpy = vi.fn(() => {
      settingsSignal.set(current);
      return of(current);
    });
    saveSpy = vi.fn((update: OverdueSettingsUpdate) => {
      const saved: OverdueSettings = { ...current, ...update, customized: true };
      current = saved;
      settingsSignal.set(saved);
      return of(saved);
    });

    TestBed.configureTestingModule({
      imports: [OverdueFee],
      providers: [
        provideRouter([]),
        {
          provide: OverdueSettingsService,
          useValue: { settings: settingsSignal, loading: signal(false), load: loadSpy, save: saveSpy },
        },
        {
          provide: NotificationService,
          useValue: { success: successSpy, error: vi.fn(), push: vi.fn() },
        },
      ],
    });
  }

  function create(): ComponentFixture<OverdueFee> {
    const fixture = TestBed.createComponent(OverdueFee);
    fixture.detectChanges();
    return fixture;
  }

  function host(fixture: ComponentFixture<OverdueFee>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function inputs(fixture: ComponentFixture<OverdueFee>): HTMLInputElement[] {
    return Array.from(host(fixture).querySelectorAll('input[type="number"]'));
  }

  function type(fixture: ComponentFixture<OverdueFee>, index: number, value: string): void {
    const el = inputs(fixture)[index];
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function buttonByText(fixture: ComponentFixture<OverdueFee>, text: string): HTMLButtonElement {
    const found = Array.from(host(fixture).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(text),
    );
    if (!found) throw new Error(`Botão "${text}" não encontrado.`);
    return found as HTMLButtonElement;
  }

  beforeEach(() => {
    current = { ...SETTINGS };
    TestBed.resetTestingModule();
    configure();
  });

  it('carrega a regra em vigor e mostra o selo "Padrão do sistema"', () => {
    const fixture = create();
    const text = host(fixture).textContent ?? '';

    expect(loadSpy).toHaveBeenCalledWith(true);
    expect(text).toContain('Padrão do sistema');
    expect(text).toContain('1,5x');
    expect(text).toContain('3 horas');
    expect(inputs(fixture)[0].value).toBe('1.5');
    expect(inputs(fixture)[1].value).toBe('3');
  });

  it('explica a regra do prazo sem mentir sobre a fronteira', () => {
    const fixture = create();
    const text = host(fixture).textContent ?? '';

    expect(text).toContain('meia-noite que abre o dia seguinte');
    expect(text).toContain('estritamente depois');
    expect(text).toContain('dias de calendário');
  });

  it('salva convertendo o multiplicador de "x" para basis-points', () => {
    const fixture = create();

    type(fixture, 0, '2');
    type(fixture, 1, '6');
    buttonByText(fixture, 'Salvar regra').click();
    fixture.detectChanges();

    expect(saveSpy).toHaveBeenCalledWith({ multiplierBps: 20_000, graceHours: 6 });
    expect(successSpy).toHaveBeenCalled();
    expect(host(fixture).textContent).toContain('Personalizado');
  });

  it('mantém "Salvar" travado enquanto o multiplicador está fora da faixa', () => {
    const fixture = create();

    type(fixture, 0, '9');
    fixture.detectChanges();

    expect(buttonByText(fixture, 'Salvar regra').disabled).toBe(true);
    expect(host(fixture).textContent).toContain('fora da faixa');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('restaura o padrão em um clique, com os números no rótulo do botão', () => {
    current = { ...SETTINGS, multiplierBps: 30_000, graceHours: 12, customized: true };
    const fixture = create();

    const restore = buttonByText(fixture, 'Restaurar padrão');
    expect(restore.textContent).toContain('1,5x');
    expect(restore.textContent).toContain('3 horas');

    restore.click();
    fixture.detectChanges();

    expect(saveSpy).toHaveBeenCalledWith({ multiplierBps: 15_000, graceHours: 3 });
  });

  it('desfaz alterações voltando ao que está salvo', () => {
    const fixture = create();

    type(fixture, 0, '4');
    expect(buttonByText(fixture, 'Desfazer alterações').disabled).toBe(false);

    buttonByText(fixture, 'Desfazer alterações').click();
    fixture.detectChanges();

    expect(inputs(fixture)[0].value).toBe('1.5');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('mostra o erro do servidor quando o PUT é recusado', () => {
    const fixture = create();
    saveSpy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { message: 'Apenas OWNER ou MANAGER pode alterar esta configuração.' },
          }),
      ),
    );

    type(fixture, 0, '2');
    buttonByText(fixture, 'Salvar regra').click();
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('OWNER ou MANAGER');
  });

  it('mostra o banner de erro e o retry quando o GET falha', () => {
    loadSpy.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const fixture = create();

    expect(buttonByText(fixture, 'Tentar de novo')).toBeTruthy();
  });

  /**
   * **O DEGRAU.** A tolerância decide SE cobra, mas não é descontada da contagem
   * de dias. Com 72 horas de tolerância e fim em 20/07, devolver 23/07 às 23h59
   * custa zero e devolver 24/07 às 00h01 custa quatro diárias. Quem sobe a
   * tolerância achando que está sendo brando está, na verdade, aumentando a
   * primeira cobrança — e a tela tem de dizer isso.
   */
  describe('exemplo do degrau da tolerância', () => {
    /** Sem NBSP, `toContain('R$ 600,00')` passaria por engano. */
    function text(fixture: ComponentFixture<OverdueFee>): string {
      return (host(fixture).textContent ?? '').replace(/ /g, ' ');
    }

    it('o exemplo aparece já no primeiro render, com a regra carregada', () => {
      const fixture = create();

      expect(text(fixture)).toContain('R$ 100,00');
    });

    /**
     * Em produção o GET é ASSÍNCRONO: o primeiro render acontece com os campos
     * ainda vazios. Um `computed` sem dependência de signal nenhuma avalia uma
     * vez e nunca mais — era o caso do exemplo antigo, que lia apenas
     * `this.multiplier.value` (um `FormControl`, não um signal) e portanto
     * ficava congelado no vazio: o bloco não aparecia nunca na tela real.
     */
    it('aparece mesmo quando a regra chega DEPOIS do primeiro render', async () => {
      const late = new Subject<OverdueSettings>();
      loadSpy.mockReturnValue(late);
      const fixture = create();

      expect(text(fixture)).not.toContain('R$ 100,00');

      settingsSignal.set(current);
      late.next(current);
      late.complete();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(text(fixture)).toContain('R$ 100,00');
      expect(text(fixture)).toContain('1 diária');
    });

    it('reflete a tolerância configurada no prazo e na primeira cobrança', () => {
      current = { ...SETTINGS, graceHours: 72, multiplierBps: 15_000 };
      const fixture = create();
      const rendered = text(fixture);

      // Prazo = 20/07 + 1 dia 00:00 + 72h.
      expect(rendered).toContain('24/07/2026 às 00:00');
      // E a primeira devolução cobrável já são QUATRO diárias, não uma.
      expect(rendered).toContain('4 diárias');
      expect(rendered).toContain('R$ 600,00');
    });

    it('acompanha o valor em EDIÇÃO, antes de salvar', () => {
      const fixture = create();

      type(fixture, 1, '72');
      const rendered = text(fixture);

      expect(rendered).toContain('24/07/2026 às 00:00');
      expect(rendered).toContain('4 diárias');
    });

    it('sem tolerância, o prazo é a meia-noite e a primeira multa é de 1 diária', () => {
      current = { ...SETTINGS, graceHours: 0 };
      const fixture = create();
      const rendered = text(fixture);

      expect(rendered).toContain('21/07/2026 às 00:00');
      expect(rendered).toContain('1 diária');
      expect(rendered).toContain('R$ 150,00');
    });

    it('diz em palavras que aumentar a tolerância aumenta a primeira multa', () => {
      const rendered = text(create());

      expect(rendered).toContain('não é descontada');
      expect(rendered).toContain('somam uma diária');
    });

    it('mostra que devolver dentro do prazo custa zero', () => {
      const rendered = text(create());

      expect(rendered).toContain('sem multa');
    });
  });

  /**
   * O campo não pode ser mais estrito que o servidor: `UpdateOverdueSettingsRequestDto`
   * aceita QUALQUER inteiro de basis-points entre 10000 e 50000. Um 1,05x salvo
   * por outro caminho voltava do servidor e carregava o campo já inválido.
   */
  describe('faixa do multiplicador', () => {
    // `<input type="number">` normaliza o separador para ponto — é o valor que
    // o control enxerga. O `pattern` aceita os dois para o round-trip com o
    // servidor não depender de locale.
    it('aceita duas casas decimais e salva os basis-points exatos', () => {
      const fixture = create();

      type(fixture, 0, '1.05');

      expect(buttonByText(fixture, 'Salvar regra').disabled).toBe(false);
      buttonByText(fixture, 'Salvar regra').click();
      fixture.detectChanges();

      expect(saveSpy).toHaveBeenCalledWith({ multiplierBps: 10_500, graceHours: 3 });
    });

    it('carrega um multiplicador de duas casas sem marcar o campo como inválido', () => {
      current = { ...SETTINGS, multiplierBps: 10_500, customized: true };
      const fixture = create();

      expect(inputs(fixture)[0].value).toBe('1.05');
      expect(host(fixture).textContent).not.toContain('casa decimal');
      expect(host(fixture).textContent).toContain('1,05x');
    });

    /**
     * Recusar o inválido é metade do trabalho; a outra é DESTRAVAR quando o
     * usuário corrige. `FormControl.valid` não é signal, então "Salvar" ficava
     * desabilitado depois da correção — o erro sumia da tela e o botão seguia
     * morto, sem nada explicando por quê.
     */
    it('recusa o que sai da faixa e volta a permitir salvar quando corrigido', () => {
      const fixture = create();

      type(fixture, 0, '9');
      expect(buttonByText(fixture, 'Salvar regra').disabled).toBe(true);
      expect(host(fixture).textContent).toContain('fora da faixa');

      // Volta para dentro da faixa (e diferente do salvo, senão não há mudança).
      type(fixture, 0, '1.05');

      expect(host(fixture).textContent).not.toContain('fora da faixa');
      expect(buttonByText(fixture, 'Salvar regra').disabled).toBe(false);
    });
  });
});
