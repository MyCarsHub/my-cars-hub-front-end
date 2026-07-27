import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ClickOutsideDirective } from '../../../utils/directives/click-outside.directive';

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const EDGE_MARGIN = 8;
const TRIGGER_GAP = 6;
const MIN_PANEL_HEIGHT = 120;

/**
 * Menu de ações ("kebab") para linhas de listagem.
 *
 * O painel é renderizado com `position: fixed` e coordenadas calculadas a partir
 * do retângulo do gatilho. Isso é proposital: os containers das listagens têm
 * `overflow-hidden` (`app-page-card`) e `overflow-x-auto` (wrapper da tabela),
 * que recortam qualquer popover `absolute` e ainda geram scroll horizontal.
 * `fixed` escapa desses contextos de recorte (nenhum ancestral usa `transform`).
 *
 * O painel é clampado à viewport (nunca ultrapassa as bordas → sem scroll
 * horizontal), inverte para cima quando não há espaço abaixo (última linha da
 * lista) e limita a altura com scroll interno.
 *
 * Teclado (WAI-ARIA menu button): setas navegam, Home/End vão às pontas,
 * Escape fecha e devolve o foco ao gatilho, Tab fecha.
 *
 * @example
 * ```html
 * <app-actions-menu label="Mais ações">
 *   <button type="button" role="menuitem" (click)="edit()">Editar</button>
 * </app-actions-menu>
 * ```
 */
@Component({
  selector: 'app-actions-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClickOutsideDirective],
  templateUrl: './actions-menu.html',
  host: {
    class: 'inline-flex',
    '(click)': 'onHostClick($event)',
    '(keydown)': 'onHostKeydown($event)',
  },
})
export class ActionsMenu {
  private static instanceCounter = 0;

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Rótulo acessível do gatilho (ícone-only). */
  readonly label = input('Mais ações');
  /** Largura desejada do painel; é reduzida se a viewport for mais estreita. */
  readonly menuWidth = input(224);

  private readonly triggerRef = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menuRef = viewChild<ElementRef<HTMLElement>>('menu');

  protected readonly menuId = `actions-menu-${++ActionsMenu.instanceCounter}`;
  protected readonly triggerId = `${this.menuId}-trigger`;

  protected readonly open = signal(false);
  /** Só torna o painel visível depois de medido, para não piscar na posição errada. */
  protected readonly positioned = signal(false);
  protected readonly position = signal<MenuPosition>({
    top: 0,
    left: 0,
    width: 224,
    maxHeight: MIN_PANEL_HEIGHT,
  });

  /**
   * Scroll/resize invalidam as coordenadas fixas do painel: fecha. Scroll de
   * dentro do próprio painel (lista longa) é ignorado.
   */
  private readonly onViewportChange = (event: Event): void => {
    if (!this.open()) return;
    const menu = this.menuRef()?.nativeElement;
    const target = event.target as Node | null;
    if (event.type === 'scroll' && menu && target && menu.contains(target)) return;
    this.close(false);
  };

  constructor() {
    effect(() => {
      const menu = this.menuRef();
      if (!this.open() || !menu) return;
      this.reposition(menu.nativeElement);
      this.positioned.set(true);
      this.focusItemAt(0);
    });

    if (this.isBrowser) {
      const view = this.document.defaultView;
      view?.addEventListener('scroll', this.onViewportChange, true);
      view?.addEventListener('resize', this.onViewportChange);
      this.destroyRef.onDestroy(() => {
        view?.removeEventListener('scroll', this.onViewportChange, true);
        view?.removeEventListener('resize', this.onViewportChange);
      });
    }
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(true);
      return;
    }
    this.positioned.set(false);
    this.open.set(true);
  }

  protected close(focusTrigger: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.positioned.set(false);
    if (focusTrigger) this.triggerRef().nativeElement.focus();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (!this.open()) {
      this.positioned.set(false);
      this.open.set(true);
      return;
    }
    this.moveFocus(event.key === 'ArrowDown' ? 1 : -1);
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close(true);
        break;
      case 'Tab':
        event.preventDefault();
        this.close(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusItemAt(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusItemAt(this.items().length - 1);
        break;
      default:
        break;
    }
  }

  /** Fecha ao acionar um item (o item já executou sua própria ação). */
  protected onMenuClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[role="menuitem"]')) this.close(false);
  }

  /** Impede que o clique vaze para a linha/card clicável que envolve o menu. */
  protected onHostClick(event: Event): void {
    event.stopPropagation();
  }

  /** Idem para teclado: Enter/Espaço num item não deve abrir o detalhe da linha. */
  protected onHostKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  private items(): HTMLElement[] {
    const menu = this.menuRef()?.nativeElement;
    if (!menu) return [];
    return Array.from(
      menu.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
      ),
    );
  }

  private focusItemAt(index: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    items[clamped].focus({ preventScroll: true });
  }

  private moveFocus(delta: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const current = items.indexOf(this.document.activeElement as HTMLElement);
    const next = current === -1 ? 0 : (current + delta + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  /**
   * Ancora o painel ao gatilho em coordenadas de viewport, clampando às bordas
   * e invertendo para cima quando não couber abaixo.
   */
  private reposition(menu: HTMLElement): void {
    const view = this.isBrowser ? this.document.defaultView : null;
    if (!view) return;

    const anchor = this.triggerRef().nativeElement.getBoundingClientRect();
    const viewportWidth = view.innerWidth;
    const viewportHeight = view.innerHeight;

    const width = Math.max(Math.min(this.menuWidth(), viewportWidth - EDGE_MARGIN * 2), 0);
    const left = Math.min(
      Math.max(anchor.right - width, EDGE_MARGIN),
      Math.max(viewportWidth - width - EDGE_MARGIN, EDGE_MARGIN),
    );

    const height = menu.scrollHeight;
    const spaceBelow = viewportHeight - anchor.bottom - TRIGGER_GAP - EDGE_MARGIN;
    const spaceAbove = anchor.top - TRIGGER_GAP - EDGE_MARGIN;
    const flipUp = height > spaceBelow && spaceAbove > spaceBelow;

    const maxHeight = Math.max(flipUp ? spaceAbove : spaceBelow, MIN_PANEL_HEIGHT);
    const top = flipUp
      ? Math.max(anchor.top - TRIGGER_GAP - Math.min(height, maxHeight), EDGE_MARGIN)
      : anchor.bottom + TRIGGER_GAP;

    this.position.set({ top, left, width, maxHeight });
  }
}
