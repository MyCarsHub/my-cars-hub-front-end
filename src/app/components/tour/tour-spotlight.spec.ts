import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TourSpotlight } from './tour-spotlight';
import { TourService } from './tour.service';
import { TOUR_STEPS, TourStep } from './tour.types';

/**
 * Dublê do `TourService` com a superfície EXATA que o template consome. O
 * serviço real resolve alvos no DOM com esperas de animação; aqui o interesse é
 * outro — o que o balão renderiza e o que o teclado dispara.
 */
function makeTourStub(steps: readonly TourStep[]) {
  const index = signal(0);
  const target = signal<HTMLElement | null>(null);
  return {
    index,
    target,
    active: signal(true),
    // `busy` é sinal no serviço real (`tour.service.ts`) e os botões de
    // navegação o leem no template. Um dublê sem ele explode a renderização.
    busy: signal(false),
    total: () => steps.length,
    currentStep: () => steps[index()] ?? null,
    isFirst: () => index() === 0,
    isLast: () => index() === steps.length - 1,
    next: vi.fn(async () => index.set(index() + 1)),
    back: vi.fn(async () => index.set(index() - 1)),
    skip: vi.fn(),
    // Consumidos fora do template: `abandon` no `onDestroy` (limpeza da
    // fixture) e `revalidateTarget` no `resize`.
    abandon: vi.fn(),
    revalidateTarget: vi.fn(async () => undefined),
  };
}

describe('TourSpotlight', () => {
  let fixture: ComponentFixture<TourSpotlight>;
  let tour: ReturnType<typeof makeTourStub>;
  let anchorEl: HTMLElement;

  beforeEach(async () => {
    anchorEl = document.createElement('button');
    anchorEl.textContent = 'Dashboard';
    document.body.appendChild(anchorEl);

    tour = makeTourStub(TOUR_STEPS);

    await TestBed.configureTestingModule({
      imports: [TourSpotlight],
      providers: [{ provide: TourService, useValue: tour }],
    }).compileComponents();

    fixture = TestBed.createComponent(TourSpotlight);
    fixture.detectChanges();
  });

  function dialog(): HTMLElement | null {
    return fixture.debugElement.query(By.css('[role="dialog"]'))?.nativeElement ?? null;
  }

  it('não monta nada enquanto o alvo não foi resolvido', () => {
    expect(dialog()).toBeNull();
  });

  it('monta um diálogo modal rotulado pelo título e descrito pelo corpo do passo', async () => {
    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();

    const panel = dialog();
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-modal')).toBe('true');

    const titleId = panel?.getAttribute('aria-labelledby');
    const bodyId = panel?.getAttribute('aria-describedby');
    expect(document.getElementById(titleId ?? '')?.textContent?.trim()).toBe(TOUR_STEPS[0].title);
    expect(document.getElementById(bodyId ?? '')?.textContent?.trim()).toBe(TOUR_STEPS[0].body);
  });

  it('leva o foco para o balão a cada passo, para o leitor de tela anunciar o texto antes dos botões', async () => {
    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(dialog());
  });

  /**
   * O balão toma o foco a cada passo. Sem devolvê-lo ao fechar, quem chegou
   * pelo teclado é largado no `<body>` e precisa percorrer a página inteira de
   * `Tab` para voltar de onde estava — o overlay some, a orientação também.
   */
  it('devolve o foco a quem o tinha antes, ao fechar', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(dialog());

    // Concluir/Pular/`Esc` desembocam todos aqui: o tour deixa de estar ativo.
    tour.active.set(false);
    fixture.detectChanges();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('esconde "Voltar" no primeiro passo e chama "Concluir" no último', async () => {
    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();

    const labels = () =>
      fixture.debugElement
        .queryAll(By.css('[role="dialog"] button'))
        .map((b) => (b.nativeElement as HTMLElement).textContent?.trim());

    expect(labels()).toEqual(['Pular', 'Próximo']);

    tour.index.set(TOUR_STEPS.length - 1);
    fixture.detectChanges();

    expect(labels()).toEqual(['Pular', 'Voltar', 'Concluir']);
  });

  it('Escape pula o tour', async () => {
    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();

    dialog()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(tour.skip).toHaveBeenCalledOnce();
  });

  /**
   * Uma rotação de celular é UM `resize`, não uma rajada. O evento chega antes
   * da detecção de mudanças, quando o `<aside>` condenado ainda está no DOM: se
   * a re-resolução for pedida nesse instante, ela vê o alvo "vivo", desiste, e
   * ninguém mais pergunta — o holofote fica preso ao nó destruído. No desktop
   * arrastar a janela mascara isso com dezenas de eventos; no celular, não.
   */
  it('re-resolve o alvo DEPOIS da troca do DOM, com um ÚNICO evento de resize', async () => {
    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();

    let connectedAoPerguntar: boolean | null = null;
    tour.revalidateTarget.mockImplementation(async () => {
      connectedAoPerguntar = anchorEl.isConnected;
    });

    window.dispatchEvent(new Event('resize'));
    // A troca do `@if` da barra lateral só acontece na passada de detecção que
    // vem DEPOIS do evento — é exatamente essa a ordem que derruba o alvo.
    anchorEl.remove();
    await fixture.whenStable();

    expect(tour.revalidateTarget).toHaveBeenCalledOnce();
    expect(connectedAoPerguntar).toBe(false);
  });

  it('Tab a partir do último botão volta para o primeiro — o foco não escapa para o fundo', async () => {
    tour.target.set(anchorEl);
    fixture.detectChanges();
    await fixture.whenStable();

    const buttons = fixture.debugElement
      .queryAll(By.css('[role="dialog"] button'))
      .map((b) => b.nativeElement as HTMLElement);

    buttons[buttons.length - 1].focus();
    buttons[buttons.length - 1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );

    expect(document.activeElement).toBe(buttons[0]);
  });
});
