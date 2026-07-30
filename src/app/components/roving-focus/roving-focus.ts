import { ElementRef, signal } from '@angular/core';

/**
 * O que uma tecla significa dentro de um grupo com roving tabindex.
 * `null` = tecla irrelevante, deixa passar.
 */
export type RovingFocusAction =
  { readonly kind: 'move'; readonly index: number } | { readonly kind: 'confirm' } | null;

/**
 * Traduz a tecla no gesto do padrão "a seleção NÃO acompanha o foco": setas /
 * Home / End movem só o foco (circulando nas pontas) e Enter / Espaço confirmam
 * o item focado. É a variante que o APG descreve para radio group em toolbar e
 * a recomendada quando selecionar dispara efeito colateral (requisição, troca
 * de preço na tela) — o usuário explora antes de commitar.
 */
export function resolveRovingKey(key: string, current: number, length: number): RovingFocusAction {
  if (length === 0) return null;
  if (key === 'Enter' || key === ' ') return { kind: 'confirm' };
  if (key === 'ArrowRight' || key === 'ArrowDown')
    return { kind: 'move', index: (current + 1) % length };
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return { kind: 'move', index: (current - 1 + length) % length };
  }
  if (key === 'Home') return { kind: 'move', index: 0 };
  if (key === 'End') return { kind: 'move', index: length - 1 };
  return null;
}

/**
 * Índice do item realmente focado dentro de um grupo. `null` quando o foco está
 * fora — nesse estado o grupo devolve o tabindex ao item marcado, para que o
 * Tab de retorno caia na seleção, como manda o APG.
 */
export class RovingFocusTracker {
  private readonly focused = signal<number | null>(null);

  readonly index = this.focused.asReadonly();

  set(index: number): void {
    this.focused.set(index);
  }

  /** Mantém o roving tabindex no item que recebeu o foco. */
  onFocusIn(event: FocusEvent, items: readonly ElementRef<HTMLElement>[]): void {
    const index = items.findIndex((item) => item.nativeElement === event.target);
    if (index >= 0) this.focused.set(index);
  }

  /** Foco saiu do grupo (e não só de um item para o vizinho): reseta. */
  onFocusOut(event: FocusEvent, items: readonly ElementRef<HTMLElement>[]): void {
    const stillInside = items.some((item) => item.nativeElement === event.relatedTarget);
    if (!stillInside) this.focused.set(null);
  }
}
