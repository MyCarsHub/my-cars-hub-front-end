import { describe, expect, it } from 'vitest';

import { REVEAL_READY_ATTR, enableRevealAnimations } from './reveal-ready';

/**
 * O contrato aqui é o do prerender: o HTML estático da landing tem de chegar VISÍVEL.
 * Só depois que o cliente renderizou é que o estado escondido pode entrar em cena — e
 * mesmo assim apenas para o que ainda não apareceu na tela.
 */
describe('enableRevealAnimations', () => {
  function stubTop(el: HTMLElement, top: number): void {
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
  }

  function buildRoot(tops: readonly number[]): { root: HTMLElement; items: HTMLElement[] } {
    const root = document.createElement('div');
    root.className = 'landing-root';
    const items = tops.map((top) => {
      const el = document.createElement('section');
      el.className = 'reveal';
      stubTop(el, top);
      root.appendChild(el);
      return el;
    });
    document.body.appendChild(root);
    return { root, items };
  }

  it('does not mark the root ready until it is called (static HTML stays visible)', () => {
    const { root } = buildRoot([0]);

    expect(root.hasAttribute(REVEAL_READY_ATTR)).toBe(false);
  });

  it('keeps whatever is already on screen visible and only hides what is below the fold', () => {
    const { root, items } = buildRoot([-200, 10, window.innerHeight + 500]);

    enableRevealAnimations(root);

    expect(root.hasAttribute(REVEAL_READY_ATTR)).toBe(true);
    expect(items[0].classList.contains('revealed')).toBe(true);
    expect(items[1].classList.contains('revealed')).toBe(true);
    expect(items[2].classList.contains('revealed')).toBe(false);
  });

  it('is idempotent — a second call cannot hide what the first one revealed', () => {
    const { root, items } = buildRoot([10]);

    enableRevealAnimations(root);
    stubTop(items[0], window.innerHeight + 500);
    enableRevealAnimations(root);

    expect(items[0].classList.contains('revealed')).toBe(true);
  });
});
