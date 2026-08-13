import { DestroyRef, PLATFORM_ID, Signal, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Uma media query como signal, segura no SSR.
 *
 * <h4>Por que isto existe, e por que não é uma classe do Tailwind</h4>
 * Quase toda diferença entre telefone e desktop é apresentação pura e pertence a
 * um `md:`/`lg:` no template. Esta função é para o caso em que NÃO é: quando a
 * ORDEM dos elementos muda com a largura.
 *
 * `flex-col-reverse` e `order-*` reordenam só o que se vê. O DOM continua na
 * ordem antiga, e com ele a ordem de leitura do leitor de tela e a ordem do
 * Tab. Quando a sequência carrega sentido — a grade de planos carrega: cada card
 * acima do TRIAL diz "tudo o que o plano anterior tem" — essa divergência é
 * falha de WCAG 1.3.2 (Meaningful Sequence) e 2.4.3 (Focus Order), e ela aparece
 * exatamente no público que menos consegue contorná-la. Reordenar o ARRAY resolve
 * as duas de uma vez: o que se vê e o que se navega saem sempre iguais.
 *
 * <h4>Escreva a query em `rem`, nunca em `px`</h4>
 * Os breakpoints do Tailwind v4 são `rem` (`sm` = 40rem, `md` = 48rem) e este
 * projeto não redefine `--breakpoint-*`. Uma query em `px` só coincide com a
 * classe correspondente em quem está com 16px de fonte-raiz; quem aumentou a
 * fonte do navegador cai numa faixa em que o signal diz uma coisa e o `md:` do
 * template diz outra — que é exatamente o desencontro que esta função existe
 * para evitar, chegando pela porta da unidade em vez da porta do número.
 *
 * <h4>Não use isto numa rota PRERENDERIZADA para decidir ordem de DOM</h4>
 * No servidor o signal congela em `ssrFallback`, então o HTML estático sai com
 * UM dos arranjos para todo mundo e o outro só aparece na hidratação — em
 * silêncio, porque a contagem de nós bate e o Angular reivindica as views por
 * posição sem reclamar. Em rota prerenderizada, emita as duas ordens e esconda
 * uma com `display: none` (que também tira da ordem de Tab e da árvore de
 * acessibilidade); ver `landing-pricing.component.ts`. Rotas
 * `RenderMode.Client`, como o billing, não têm esse problema.
 *
 * <h4>Contrato</h4>
 * Chame em contexto de injeção (inicializador de campo do componente). O signal
 * fica congelado em `ssrFallback` e nenhum listener é registrado em dois casos:
 * no servidor, onde não há `window`, e num DOM que não implementa `matchMedia` —
 * o jsdom da suíte é um deles, e WebViews antigas também.
 *
 * O default `false` é deliberado: significa "a query mais larga não bate", isto
 * é, o arranjo de TELEFONE. Mobile-first vale para o que vai no fio e para o que
 * sobra quando a API não existe, não só para o CSS.
 */
export function mediaQuerySignal(query: string, ssrFallback = false): Signal<boolean> {
  const platformId = inject(PLATFORM_ID);
  const destroyRef = inject(DestroyRef);

  if (!isPlatformBrowser(platformId) || typeof window.matchMedia !== 'function') {
    return signal(ssrFallback).asReadonly();
  }

  const list = window.matchMedia(query);
  const matches = signal(list.matches);
  const onChange = (event: MediaQueryListEvent): void => matches.set(event.matches);

  list.addEventListener('change', onChange);
  destroyRef.onDestroy(() => list.removeEventListener('change', onChange));

  return matches.asReadonly();
}
