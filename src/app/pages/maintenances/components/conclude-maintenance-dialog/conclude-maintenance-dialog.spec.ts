import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConcludeMaintenanceDialog, isInputRejection } from './conclude-maintenance-dialog';

/**
 * A lógica mais arriscada do diálogo:
 *  - a trava `touched`: o hodômetro do veículo é buscado DEPOIS da abertura, e
 *    uma sugestão que chega atrasada não pode sobrescrever o que foi digitado;
 *  - o campo é `type="text"` (não `number`) justamente para que entrada inválida
 *    sobreviva até `parsed()` e o erro inline apareça em vez de apagar o campo;
 *  - a recusa do backend é renderizada DENTRO do diálogo.
 */
describe('ConcludeMaintenanceDialog', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [ConcludeMaintenanceDialog],
      providers: [provideNoopAnimations()],
    });
    const fixture = TestBed.createComponent(ConcludeMaintenanceDialog);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Último nó: a animação `:leave` do diálogo deixa o campo antigo no DOM até o
   * flush do engine, então o primeiro `querySelector` pode devolver o descartado.
   */
  function field(fixture: { nativeElement: unknown }): HTMLInputElement {
    const all = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      '#conclude-maint-hodometer',
    );
    return all[all.length - 1];
  }

  function type(fixture: { nativeElement: unknown; detectChanges: () => void }, text: string): void {
    const input = field(fixture);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('adota uma sugestão que chega depois da abertura enquanto o campo está intocado', () => {
    const fixture = render();
    expect(field(fixture).value).toBe('');

    fixture.componentRef.setInput('defaultValue', 78000);
    fixture.detectChanges();

    expect(field(fixture).value).toBe('78000');
  });

  it('preserva o valor digitado quando a sugestão chega atrasada (trava touched)', () => {
    const fixture = render();

    type(fixture, '52000');
    fixture.componentRef.setInput('defaultValue', 78000);
    fixture.detectChanges();

    expect(field(fixture).value).toBe('52000');
  });

  it('reabrir volta a aceitar a sugestão (a trava é liberada ao fechar)', () => {
    const fixture = render();
    type(fixture, '52000');

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('defaultValue', 78000);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(field(fixture).value).toBe('78000');
  });

  it('mantém a entrada não numérica no campo e mostra o erro inline', () => {
    const fixture = render();

    type(fixture, 'abc');

    const host = fixture.nativeElement as HTMLElement;
    expect(field(fixture).value).toBe('abc');
    expect(host.querySelector('#conclude-maint-error')).not.toBeNull();
    expect(field(fixture).getAttribute('aria-invalid')).toBe('true');
    expect(
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Concluir manutenção',
      )?.disabled,
    ).toBe(true);
  });

  it('rejeita separador de milhar em vez de enviar um número truncado', () => {
    const fixture = render();

    type(fixture, '51.000');

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#conclude-maint-error'),
    ).not.toBeNull();
  });

  it('renderiza a mensagem do backend dentro do diálogo e a associa ao campo', () => {
    const fixture = render();
    type(fixture, '40000');

    fixture.componentRef.setInput(
      'errorMessage',
      'Hodômetro (40000 km) menor que o atual do veículo (51000 km).',
    );
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const serverError = host.querySelector('#conclude-maint-server-error');
    expect(serverError?.getAttribute('role')).toBe('alert');
    expect(serverError?.textContent).toContain('menor que o atual do veículo');
    expect(field(fixture).getAttribute('aria-describedby')).toContain(
      'conclude-maint-server-error',
    );
    // O valor recusado continua no campo para ser corrigido.
    expect(field(fixture).value).toBe('40000');
  });

  it('pede a leitura explicitamente quando o hodômetro do veículo não pôde ser carregado', () => {
    const fixture = render();
    fixture.componentRef.setInput('vehicleLookupFailed', true);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#conclude-maint-hint')?.textContent,
    ).toContain('Digite a leitura atual');
  });
});

describe('isInputRejection', () => {
  it.each([400, 422])('trata %i como recusa corrigível no campo', (status) => {
    expect(isInputRejection(new HttpErrorResponse({ status }))).toBe(true);
  });

  it.each([404, 409, 500])('trata %i como erro de banner', (status) => {
    expect(isInputRejection(new HttpErrorResponse({ status }))).toBe(false);
  });

  it('ignora valores que não são HttpErrorResponse', () => {
    expect(isInputRejection(new Error('boom'))).toBe(false);
  });
});
