import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { StepWelcome, WelcomeDestination } from './step-welcome';

/**
 * FIX-0271 + FEAT-0080 — o passo 4 vira o condutor da ativação: sem emoji,
 * ação principal "Cadastrar meu primeiro veículo" e "Pular por enquanto"
 * discreto. Ambos emitem `finish` com o destino — o container conclui o
 * onboarding no backend ANTES de navegar, nos dois caminhos.
 */
describe('StepWelcome — condutor da ativação', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [StepWelcome] });
  });

  function render() {
    const fixture = TestBed.createComponent(StepWelcome);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const emitted: WelcomeDestination[] = [];
    fixture.componentInstance.finish.subscribe((d) => emitted.push(d));
    return { fixture, host, emitted };
  }

  function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
    return (
      Array.from(host.querySelectorAll('button')).find((b) =>
        b.textContent?.includes(text),
      ) ?? null
    );
  }

  it('sem emoji, com heading focável e as duas ações', () => {
    const { host } = render();

    expect(host.textContent).not.toContain('🎉');
    expect(host.querySelector('h2[tabindex="-1"]')).not.toBeNull();
    expect(buttonByText(host, 'Cadastrar meu primeiro veículo')).not.toBeNull();
    expect(buttonByText(host, 'Pular por enquanto')).not.toBeNull();
    // O bloco de "Próximos passos" morto saiu de cena.
    expect(host.textContent).not.toContain('Próximos passos');
  });

  it('a ação principal emite finish("vehicle")', () => {
    const { host, emitted } = render();
    buttonByText(host, 'Cadastrar meu primeiro veículo')!.click();
    expect(emitted).toEqual(['vehicle']);
  });

  it('"Pular por enquanto" emite finish("dashboard")', () => {
    const { host, emitted } = render();
    buttonByText(host, 'Pular por enquanto')!.click();
    expect(emitted).toEqual(['dashboard']);
  });

  it('loading desabilita as duas ações', () => {
    const fixture = TestBed.createComponent(StepWelcome);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(buttonByText(host, 'Cadastrar meu primeiro veículo')?.disabled).toBe(true);
    expect(buttonByText(host, 'Pular por enquanto')?.disabled).toBe(true);
  });
});
