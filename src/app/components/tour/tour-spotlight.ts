import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { TourService } from './tour.service';

/** Folga entre o retângulo do alvo e a borda do recorte iluminado. */
const HOLE_PADDING = 6;
/** Respiro entre o recorte e o balão. */
const BALLOON_GAP = 12;
/** Margem mínima até qualquer borda da viewport. */
const EDGE_MARGIN = 12;
/** Largura desejada do balão; encolhe quando a viewport é mais estreita. */
const BALLOON_WIDTH = 320;
/** Metade do lado do quadrado rotacionado que forma a seta. */
const ARROW_HALF = 6;

type Placement = 'right' | 'left' | 'bottom' | 'top';

interface Hole {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Balloon {
  top: number;
  left: number;
  width: number;
  placement: Placement;
  /** Posição da seta RELATIVA ao balão. */
  arrowTop: number;
  arrowLeft: number;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const EMPTY_HOLE: Hole = { top: 0, left: 0, width: 0, height: 0 };
const EMPTY_BALLOON: Balloon = {
  top: 0,
  left: 0,
  width: BALLOON_WIDTH,
  placement: 'bottom',
  arrowTop: 0,
  arrowLeft: 0,
};

/**
 * Holofote ancorado do tour do produto.
 *
 * <h4>Como o escurecimento funciona</h4>
 * Não há recorte de verdade (nem `clip-path`, nem SVG mask): o recorte é um
 * `div` do tamanho do alvo com uma `box-shadow` de espalhamento gigante. A
 * sombra pinta a tela inteira de escuro, e o próprio retângulo fica
 * transparente — o elemento real embaixo aparece iluminado, sem ser clonado.
 * Como é só pintura, funciona igual sobre o drawer do mobile (z-50) e sobre o
 * conteúdo da página.
 *
 * <h4>Cliques</h4>
 * O buraco NÃO é clicável: um container `inset-0` engole todos os cliques,
 * inclusive os de dentro do recorte. Isso é deliberado — deixar passar clique
 * no item de menu destacado dispararia o `onNavClick()` da sidebar, que fecha o
 * drawer no mobile e derrubaria o alvo do passo seguinte no meio do tour. O
 * avanço acontece só pelos botões do balão.
 *
 * <h4>Rolagem</h4>
 * O tour NÃO trava a rolagem do body. Além de o `AppShell` já a travar enquanto
 * o shell está montado, a trava do `DetailDialog` guarda o estado anterior num
 * campo de instância e não é reentrante — empilhar outra por cima seria pedir
 * para uma restaurar o valor que a outra gravou. Em vez disso o holofote se
 * reposiciona em `scroll`/`resize`.
 *
 * Posicionamento herda a mesma receita do `ActionsMenu`: retângulo do alvo →
 * coordenadas `fixed`, clampadas à viewport, invertendo de lado quando não cabe.
 */
@Component({
  selector: 'app-tour-spotlight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tour-spotlight.html',
})
export class TourSpotlight {
  private static instanceCounter = 0;

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly tour = inject(TourService);

  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly titleId = `tour-step-title-${++TourSpotlight.instanceCounter}`;
  protected readonly bodyId = `${this.titleId}-body`;

  protected readonly hole = signal<Hole>(EMPTY_HOLE);
  protected readonly balloon = signal<Balloon>(EMPTY_BALLOON);

  /** Só revela o overlay depois de medido, para não piscar na posição errada. */
  protected readonly positioned = signal(false);

  /** Overlay montado: precisa de tour ativo E de um alvo já resolvido. */
  protected readonly mounted = computed(() => this.tour.active() && this.tour.target() !== null);

  protected readonly stepLabel = computed(() => `${this.tour.index() + 1} de ${this.tour.total()}`);

  protected readonly dots = computed(() =>
    Array.from({ length: this.tour.total() }, (_, i) => i),
  );

  protected readonly nextLabel = computed(() => (this.tour.isLast() ? 'Concluir' : 'Próximo'));

  /**
   * Quem tinha o foco antes do overlay montar. O balão toma o foco a cada passo
   * (ver o efeito no construtor); sem devolvê-lo no fim, quem fechou por
   * `Esc`/"Concluir" cai no `<body>` e precisa percorrer a página inteira de
   * `Tab` para voltar de onde estava.
   */
  private previouslyFocused: HTMLElement | null = null;

  private readonly onScroll = (): void => {
    if (!this.mounted()) return;
    this.reposition();
  };

  /**
   * Redimensionar NÃO é o mesmo caso que rolar. Cruzar os 1024px troca a barra
   * lateral inteira por outra (`@if` em `sidebar.html`), e o alvo guardado vira
   * um nó órfão que mede zero.
   *
   * O adiamento é o ponto: o `resize` roda ANTES da detecção de mudanças, e
   * nesse instante o `<aside>` condenado AINDA está no DOM. Perguntar ali se o
   * alvo continua vivo devolve "sim" — a re-resolução cai na própria guarda de
   * `isConnected` (`tour.service.ts`) e não faz nada, enquanto a medição pega o
   * nó que está prestes a morrer. Registrar o ouvinte mais cedo ou mais tarde
   * não muda nada: a troca do `@if` precisa de uma passada de detecção de
   * qualquer maneira. `afterNextRender` põe a conferência DEPOIS dela.
   *
   * No desktop o defeito se escondia porque arrastar a janela dispara dezenas
   * de eventos e o segundo já encontra o DOM novo; girar um celular dispara UM.
   */
  private readonly onResize = (): void => {
    if (!this.tour.active()) return;
    afterNextRender(
      () => {
        if (!this.mounted()) return;
        // Alvo vivo: só mudou o tamanho da janela, basta remedir. Alvo morto: a
        // barra lateral trocou, e quem repõe a medida é o efeito que observa
        // `target()`, depois que o serviço achar o nó novo.
        if (this.tour.target()?.isConnected) {
          this.reposition();
          return;
        }
        void this.tour.revalidateTarget();
      },
      { injector: this.injector },
    );
  };

  constructor() {
    // Guarda e devolve o foco. Roda ANTES do efeito que mede porque o foco vai
    // para o balão dentro do `afterNextRender` dali — capturar depois já
    // gravaria o próprio balão. A devolução cobre TODAS as saídas de uma vez
    // (Concluir, Pular, `Esc`, e o abandono por logout), porque todas passam
    // por `mounted()` virando falso.
    effect(() => {
      if (this.mounted()) {
        this.captureFocus();
        return;
      }
      this.restoreFocus();
    });

    // Alvo novo ⇒ medida velha inválida. Repor `positioned` num efeito separado
    // do que mede evita que o balão apareça por um quadro na coordenada do
    // passo anterior.
    effect(() => {
      this.tour.target();
      this.positioned.set(false);
    });

    effect(() => {
      // `index()` é lido de propósito mesmo sem ser usado: dois passos que
      // resolvessem para o MESMO elemento não mudariam `target()` (sinais
      // comparam por identidade) e o balão ficaria medido e focado no passo
      // anterior. Ler o índice garante uma remedição por passo.
      this.tour.index();
      const target = this.tour.target();
      const panel = this.panelRef();
      if (!target || !panel) return;

      // Medir DEPOIS da pintura, não dentro do efeito. `reposition()` lê
      // `panel.offsetHeight` para escolher entre 'top' e 'bottom', e o painel é
      // o MESMO nó entre passos: dentro do efeito a altura ainda é a do texto
      // anterior, e dois passos com corpos de tamanhos diferentes escolheriam o
      // lado com base na medida errada. `afterNextRender` é o precedente do
      // projeto para isso (`company-settings.ts`, `company-contact.ts`) e já é
      // no-op no servidor.
      afterNextRender(
        () => {
          this.reposition();
          this.positioned.set(true);
          // Foco vai para o balão (não para um botão) a cada troca de passo,
          // para o leitor de tela anunciar título + texto antes dos controles.
          panel.nativeElement.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });

    if (this.isBrowser) {
      const view = this.document.defaultView;
      view?.addEventListener('scroll', this.onScroll, true);
      view?.addEventListener('resize', this.onResize);
      this.destroyRef.onDestroy(() => {
        view?.removeEventListener('scroll', this.onScroll, true);
        view?.removeEventListener('resize', this.onResize);
      });
    }

    // O serviço é de raiz e sobrevive a este componente: sair do shell com o
    // tour aberto (logout) deixaria estado ativo apontando para um DOM morto.
    // A devolução do foco vem junto: destruir o componente não reavalia o
    // efeito acima, e o `<body>` ficaria com o foco.
    this.destroyRef.onDestroy(() => {
      this.tour.abandon();
      this.restoreFocus();
    });
  }

  /**
   * O `<body>` não conta como foco anterior — é o estado "ninguém tinha o
   * foco", e devolvê-lo explicitamente não muda nada.
   */
  private captureFocus(): void {
    if (!this.isBrowser || this.previouslyFocused) return;
    const active = this.document.activeElement;
    this.previouslyFocused =
      active instanceof HTMLElement && active !== this.document.body ? active : null;
  }

  /**
   * O alvo pode ter morrido durante o tour — cruzar os 1024px destrói a barra
   * lateral inteira (`@if` em `sidebar.html`). Focar um nó órfão não devolve o
   * foco a lugar nenhum; deixar no `<body>` é o mesmo resultado, sem o risco.
   */
  private restoreFocus(): void {
    const element = this.previouslyFocused;
    this.previouslyFocused = null;
    if (!element?.isConnected) return;
    element.focus({ preventScroll: true });
  }

  protected onNext(): void {
    void this.tour.next();
  }

  protected onBack(): void {
    void this.tour.back();
  }

  protected onSkip(): void {
    this.tour.skip();
  }

  /**
   * Toque/clique na área escura NÃO tira o foco de dentro do balão.
   *
   * Sem isto, a ação padrão do `mousedown` num alvo não focável entrega o foco
   * ao `<body>`: a armadilha de foco deixa de existir (o `keydown` só existe
   * dentro do overlay), `Esc` para de fechar e `Tab` passa a percorrer a página
   * de trás — apesar do `aria-modal="true"`. Só cancelamos FORA do balão; nos
   * botões o `mousedown` continua íntegro, senão eles não receberiam foco ao
   * serem clicados.
   */
  protected onOverlayMousedown(event: MouseEvent): void {
    const panel = this.panelRef()?.nativeElement;
    const target = event.target;
    if (panel && target instanceof Node && panel.contains(target)) return;
    event.preventDefault();
  }

  /**
   * Escape pula o tour; Tab circula dentro do balão. O handler vive no
   * container do overlay porque o foco já está preso ali dentro — não há para
   * onde o Tab escapar sem passar por aqui.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onSkip();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = this.focusables();
    if (items.length === 0) {
      event.preventDefault();
      this.panelRef()?.nativeElement.focus({ preventScroll: true });
      return;
    }

    const index = items.indexOf(this.document.activeElement as HTMLElement);
    if (event.shiftKey) {
      // index === -1 significa foco no próprio balão: Shift+Tab vai para o fim.
      if (index <= 0) {
        event.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
      }
      return;
    }
    if (index === items.length - 1) {
      event.preventDefault();
      items[0].focus({ preventScroll: true });
    }
  }

  private focusables(): HTMLElement[] {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  private reposition(): void {
    const view = this.isBrowser ? this.document.defaultView : null;
    const target = this.tour.target();
    const panel = this.panelRef()?.nativeElement;
    if (!view || !target || !panel) return;

    const rect = target.getBoundingClientRect();
    const viewportWidth = view.innerWidth;
    const viewportHeight = view.innerHeight;

    this.hole.set({
      top: rect.top - HOLE_PADDING,
      left: rect.left - HOLE_PADDING,
      width: rect.width + HOLE_PADDING * 2,
      height: rect.height + HOLE_PADDING * 2,
    });

    const width = Math.max(Math.min(BALLOON_WIDTH, viewportWidth - EDGE_MARGIN * 2), 0);
    const height = panel.offsetHeight;

    const spaceRight = viewportWidth - rect.right - HOLE_PADDING - BALLOON_GAP - EDGE_MARGIN;
    const spaceLeft = rect.left - HOLE_PADDING - BALLOON_GAP - EDGE_MARGIN;
    const spaceBelow = viewportHeight - rect.bottom - HOLE_PADDING - BALLOON_GAP - EDGE_MARGIN;
    const spaceAbove = rect.top - HOLE_PADDING - BALLOON_GAP - EDGE_MARGIN;

    // Ordem mobile-first: no celular o drawer ocupa 260px dos ~360 disponíveis,
    // então "ao lado" quase nunca cabe e a escolha natural vira vertical. No
    // desktop a sidebar é estreita em relação à tela e o balão fica à direita,
    // sem cobrir o menu que está sendo explicado.
    const placement: Placement =
      spaceRight >= width
        ? 'right'
        : spaceBelow >= height
          ? 'bottom'
          : spaceAbove >= height
            ? 'top'
            : spaceLeft >= width
              ? 'left'
              : 'bottom';

    const maxTop = Math.max(viewportHeight - height - EDGE_MARGIN, EDGE_MARGIN);
    const maxLeft = Math.max(viewportWidth - width - EDGE_MARGIN, EDGE_MARGIN);
    const clamp = (value: number, max: number): number =>
      Math.min(Math.max(value, EDGE_MARGIN), max);

    let top: number;
    let left: number;
    switch (placement) {
      case 'right':
        left = clamp(rect.right + HOLE_PADDING + BALLOON_GAP, maxLeft);
        top = clamp(rect.top + rect.height / 2 - height / 2, maxTop);
        break;
      case 'left':
        left = clamp(rect.left - HOLE_PADDING - BALLOON_GAP - width, maxLeft);
        top = clamp(rect.top + rect.height / 2 - height / 2, maxTop);
        break;
      case 'top':
        left = clamp(rect.left + rect.width / 2 - width / 2, maxLeft);
        top = clamp(rect.top - HOLE_PADDING - BALLOON_GAP - height, maxTop);
        break;
      default:
        left = clamp(rect.left + rect.width / 2 - width / 2, maxLeft);
        top = clamp(rect.bottom + HOLE_PADDING + BALLOON_GAP, maxTop);
        break;
    }

    this.balloon.set({
      top,
      left,
      width,
      placement,
      ...this.arrowOffset(placement, rect, { top, left, width, height }),
    });
  }

  /**
   * A seta aponta para o CENTRO do alvo, não para o centro do balão: quando o
   * balão é clampado contra a borda da tela os dois deixam de coincidir, e uma
   * seta presa ao meio do balão passaria a apontar para o nada.
   */
  private arrowOffset(
    placement: Placement,
    rect: DOMRect,
    box: { top: number; left: number; width: number; height: number },
  ): { arrowTop: number; arrowLeft: number } {
    const inside = (value: number, size: number): number =>
      Math.min(Math.max(value, 16), Math.max(size - 16 - ARROW_HALF * 2, 16));

    if (placement === 'right' || placement === 'left') {
      const arrowTop = inside(rect.top + rect.height / 2 - box.top - ARROW_HALF, box.height);
      return {
        arrowTop,
        arrowLeft: placement === 'right' ? -ARROW_HALF : box.width - ARROW_HALF,
      };
    }
    const arrowLeft = inside(rect.left + rect.width / 2 - box.left - ARROW_HALF, box.width);
    return {
      arrowLeft,
      arrowTop: placement === 'bottom' ? -ARROW_HALF : box.height - ARROW_HALF,
    };
  }
}
