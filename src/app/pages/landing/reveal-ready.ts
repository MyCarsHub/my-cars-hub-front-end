/** Marca que a animação de reveal pode assumir o controle do `.landing-root`. */
export const REVEAL_READY_ATTR = 'data-reveal-ready';

/**
 * Liga a animação "reveal on scroll" DEPOIS que o JavaScript rodou.
 *
 * A landing é prerenderizada: o HTML estático já chega completo. Enquanto o estado base
 * de `.reveal` era `opacity: 0`, esse HTML chegava INVISÍVEL e só aparecia quando o
 * bundle baixava, bootava e o IntersectionObserver disparava — ou seja, todo o ganho de
 * velocidade do prerender era jogado fora, e um erro de carregamento do JS deixava a
 * página em branco. (A regra `@media (scripting: none)` cobria só navegador sem suporte
 * a script, que não é o caso real.)
 *
 * A lógica agora é invertida: o CSS revela por padrão e o estado escondido só existe sob
 * `.landing-root[data-reveal-ready]`, atributo que só este helper escreve. Antes de
 * escrevê-lo, tudo que já está visível é marcado `.revealed` — assim nada que o visitante
 * já enxerga pisca para invisível; só o que está abaixo da dobra é escondido para depois
 * entrar animado.
 *
 * Deve ser chamado de um `afterNextRender` (nunca roda no prerender): usa layout real.
 */
export function enableRevealAnimations(root: HTMLElement): void {
  if (root.hasAttribute(REVEAL_READY_ATTR)) {
    return;
  }

  // `defaultView` em vez do global `window`: mantém o helper seguro sob SSR/jsdom.
  const view = root.ownerDocument.defaultView;
  const viewportHeight = view?.innerHeight ?? 0;

  root.querySelectorAll<HTMLElement>('.reveal').forEach((el) => {
    // Qualquer elemento que já entrou na viewport (ou passou dela) permanece visível:
    // esconder agora, depois de o HTML estático já ter pintado, seria um flash.
    if (el.getBoundingClientRect().top < viewportHeight) {
      el.classList.add('revealed');
    }
  });

  root.setAttribute(REVEAL_READY_ATTR, '');
}
