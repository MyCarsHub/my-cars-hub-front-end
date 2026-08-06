import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertWindows } from './alert-windows';
import { AlertSettingsService } from '../../../services/alert-settings.service';
import { NotificationService } from '../../../services/notification.service';
import type { AlertSettings } from '../../../types/alert-settings.types';

/**
 * Cobre a seção "Janelas de aviso" de `/alertas` (ex-tela
 * `/configuracoes/alertas`):
 *  - carregar (janelas em vigor + selo padrão × personalizado);
 *  - salvar como SUBSTITUIÇÃO da lista inteira;
 *  - restaurar o padrão em um clique, com os números à vista;
 *  - validação do cliente usando os limites que vieram na resposta
 *    (`minWindowDays` / `maxWindowDays` / `maxWindowCount`), sem constante local;
 *  - o 400 do servidor (`fieldErrors.windows`) chegando à tela.
 */
describe('AlertWindows (seção "Janelas de aviso" de /alertas)', () => {
  const SETTINGS: AlertSettings = {
    windows: [30, 15, 7, 1],
    customized: false,
    defaultWindows: [30, 15, 7, 1],
    minWindowDays: 1,
    maxWindowDays: 365,
    maxWindowCount: 6,
  };

  let settingsSignal: ReturnType<typeof signal<AlertSettings | null>>;
  let loadSpy: ReturnType<typeof vi.fn>;
  let saveSpy: ReturnType<typeof vi.fn>;
  let successSpy: ReturnType<typeof vi.fn>;
  let current: AlertSettings;

  function configure(): void {
    settingsSignal = signal<AlertSettings | null>(null);
    successSpy = vi.fn();

    loadSpy = vi.fn(() => {
      settingsSignal.set(current);
      return of(current);
    });
    saveSpy = vi.fn((windows: number[]) => {
      const saved: AlertSettings = { ...current, windows, customized: true };
      current = saved;
      settingsSignal.set(saved);
      return of(saved);
    });

    TestBed.configureTestingModule({
      imports: [AlertWindows],
      providers: [
        provideRouter([]),
        {
          provide: AlertSettingsService,
          useValue: { settings: settingsSignal, load: loadSpy, save: saveSpy },
        },
        {
          provide: NotificationService,
          useValue: { success: successSpy, error: vi.fn(), push: vi.fn() },
        },
      ],
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    current = { ...SETTINGS };
    configure();
  });

  function render(): ComponentFixture<AlertWindows> {
    const fixture = TestBed.createComponent(AlertWindows);
    fixture.detectChanges();
    return fixture;
  }

  function host(fixture: ComponentFixture<AlertWindows>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function buttonWith(fixture: ComponentFixture<AlertWindows>, text: string): HTMLButtonElement {
    const match = Array.from(host(fixture).querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes(text),
    );
    if (!match) throw new Error(`Botão "${text}" não encontrado.`);
    return match as HTMLButtonElement;
  }

  function typeWindow(fixture: ComponentFixture<AlertWindows>, value: string): void {
    const input = host(fixture).querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('Campo de nova janela não encontrado.');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function chipLabels(fixture: ComponentFixture<AlertWindows>): string[] {
    return Array.from(
      host(fixture).querySelectorAll('[aria-labelledby="alert-windows-draft-label"] li'),
    ).map((item) => (item.textContent ?? '').trim());
  }

  describe('carregar', () => {
    it('busca o estado do servidor e lista as janelas em vigor', () => {
      const fixture = render();

      expect(loadSpy).toHaveBeenCalledTimes(1);
      // `force`: a tela precisa do servidor, não do cache deixado por /alertas.
      expect(loadSpy.mock.calls[0][0]).toBe(true);
      expect(host(fixture).textContent).toContain('30, 15, 7 e 1 dia');
      expect(chipLabels(fixture)).toEqual(['30 dias', '15 dias', '7 dias', '1 dia']);
    });

    /**
     * `customized` distingue "nunca configurou" de "configurou e coincidiu com
     * o padrão". A tela mostra a diferença em vez de escondê-la.
     */
    it('marca "Padrão do sistema" enquanto a empresa nunca configurou', () => {
      const fixture = render();

      expect(host(fixture).textContent).toContain('Padrão do sistema');
      expect(host(fixture).textContent).toContain('Esta empresa ainda não configurou');
    });

    it('marca "Personalizado" quando a empresa já configurou, mesmo igual ao padrão', () => {
      current = { ...SETTINGS, customized: true };
      const fixture = render();

      expect(host(fixture).textContent).toContain('Personalizado');
      expect(host(fixture).textContent).not.toContain('ainda não configurou');
    });

    it('mostra a falha da leitura com opção de tentar de novo', () => {
      loadSpy.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
      );

      const fixture = render();

      expect(host(fixture).textContent).toContain('Não foi possível');
      expect(buttonWith(fixture, 'Tentar de novo')).toBeTruthy();
    });
  });

  describe('salvar', () => {
    it('envia a lista INTEIRA, não só o que foi adicionado', () => {
      const fixture = render();

      typeWindow(fixture, '60');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();

      buttonWith(fixture, 'Substituir janelas').click();
      fixture.detectChanges();

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy.mock.calls[0][0]).toEqual([60, 30, 15, 7, 1]);
      expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('remove uma janela e salva o conjunto restante', () => {
      const fixture = render();

      const remove = host(fixture).querySelector<HTMLButtonElement>(
        'button[aria-label="Remover a janela de 15 dias"]',
      );
      remove?.click();
      fixture.detectChanges();

      expect(chipLabels(fixture)).toEqual(['30 dias', '7 dias', '1 dia']);

      buttonWith(fixture, 'Substituir janelas').click();
      expect(saveSpy.mock.calls[0][0]).toEqual([30, 7, 1]);
    });

    it('anuncia que salvar troca o conjunto inteiro enquanto há alteração pendente', () => {
      const fixture = render();

      typeWindow(fixture, '60');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('dá lugar a');
      expect(host(fixture).textContent).toContain('60, 30, 15, 7 e 1 dia');
    });

    it('mantém o botão de salvar desligado enquanto nada mudou', () => {
      const fixture = render();

      expect(buttonWith(fixture, 'Substituir janelas').disabled).toBe(true);
    });

    it('não deixa salvar uma lista vazia — sem janela a empresa nunca é avisada', () => {
      const fixture = render();

      for (const days of [30, 15, 7, 1]) {
        host(fixture)
          .querySelector<HTMLButtonElement>(
            `button[aria-label="Remover a janela de ${days === 1 ? '1 dia' : days + ' dias'}"]`,
          )
          ?.click();
        fixture.detectChanges();
      }

      expect(chipLabels(fixture)).toEqual([]);
      expect(buttonWith(fixture, 'Substituir janelas').disabled).toBe(true);
      expect(host(fixture).textContent).toContain('Adicione ao menos uma');
    });

    it('desfaz as alterações e volta ao que está salvo', () => {
      const fixture = render();

      typeWindow(fixture, '60');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();
      expect(chipLabels(fixture)).toContain('60 dias');

      buttonWith(fixture, 'Desfazer alterações').click();
      fixture.detectChanges();

      expect(chipLabels(fixture)).toEqual(['30 dias', '15 dias', '7 dias', '1 dia']);
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  describe('restaurar o padrão', () => {
    it('volta ao padrão em um clique, com os números no próprio botão', () => {
      current = { ...SETTINGS, windows: [90, 45], customized: true };
      const fixture = render();

      const restore = buttonWith(fixture, 'Restaurar padrão');
      expect(restore.textContent).toContain('30, 15, 7 e 1 dia');
      expect(restore.disabled).toBe(false);

      restore.click();
      fixture.detectChanges();

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy.mock.calls[0][0]).toEqual([30, 15, 7, 1]);
      expect(chipLabels(fixture)).toEqual(['30 dias', '15 dias', '7 dias', '1 dia']);
    });

    it('desliga o botão quando a empresa já está no padrão e nunca configurou', () => {
      const fixture = render();

      expect(buttonWith(fixture, 'Restaurar padrão').disabled).toBe(true);
    });

    it('mantém o botão ligado para quem configurou algo igual ao padrão', () => {
      current = { ...SETTINGS, customized: true };
      const fixture = render();

      expect(buttonWith(fixture, 'Restaurar padrão').disabled).toBe(false);
    });
  });

  describe('validação', () => {
    /** O limite é o `maxWindowDays` da resposta — a tela não tem cópia dele. */
    it('barra um valor acima do máximo do servidor com a mensagem do limite', () => {
      const fixture = render();

      typeWindow(fixture, '400');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('Valor máximo: 365.');
      expect(chipLabels(fixture)).not.toContain('400 dias');
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('barra o zero — avisar no dia do vencimento não é aviso', () => {
      const fixture = render();

      typeWindow(fixture, '0');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('Valor mínimo: 1.');
      expect(chipLabels(fixture)).toEqual(['30 dias', '15 dias', '7 dias', '1 dia']);
    });

    it('barra duplicata', () => {
      const fixture = render();

      typeWindow(fixture, '15');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('Essa janela já está na lista.');
      expect(chipLabels(fixture)).toEqual(['30 dias', '15 dias', '7 dias', '1 dia']);
    });

    it('impede passar do máximo de janelas declarado pelo servidor', () => {
      current = { ...SETTINGS, windows: [60, 30, 20, 15, 7, 1], customized: true };
      const fixture = render();

      expect(buttonWith(fixture, 'Adicionar').disabled).toBe(true);
      expect(host(fixture).textContent).toContain('Limite de 6 janelas atingido');
    });

    it('mostra o 400 do servidor sobre `windows` sem perder o rascunho', () => {
      const fixture = render();

      typeWindow(fixture, '2');
      buttonWith(fixture, 'Adicionar').click();
      fixture.detectChanges();

      saveSpy.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { fieldErrors: { windows: 'Janela de aviso inválida.' } },
            }),
        ),
      );

      buttonWith(fixture, 'Substituir janelas').click();
      fixture.detectChanges();

      expect(host(fixture).textContent).toContain('Janela de aviso inválida.');
      expect(chipLabels(fixture)).toContain('2 dias');
      expect(successSpy).not.toHaveBeenCalled();
    });
  });
});
