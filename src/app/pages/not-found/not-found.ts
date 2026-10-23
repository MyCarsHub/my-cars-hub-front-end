import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Página do catch-all `**`.
 *
 * Antes o `**` era `redirectTo: 'login'`: toda URL inexistente virava um SOFT-404 em
 * `/login` — uma página que o robots.txt bloqueia. Esta página é de verdade: a rota não
 * declara `data.seo`, então o `SeoService` falha-fechado e emite `noindex, nofollow` sem
 * canonical, que é o mecanismo que o Google honra para tirar a URL do índice.
 *
 * LIMITE HONESTO: o app é um SPA estático (`outputMode: "static"`); nenhum componente
 * Angular altera o status HTTP, o host devolve **200**. Um 404 de verdade exigiria uma
 * regra no host (Vercel) ou SSR.
 *
 * Layout do handoff "Páginas de sistema": mobile-first, SEM shell autenticado e SEM logo,
 * "404" gigante em cinza suave atrás da ilustração, "Voltar ao painel" é a única ação
 * laranja. Fica FORA do `AppShell`: um visitante deslogado tem de conseguir ver a página
 * ("Voltar ao painel" leva a `/dashboard` e o guard o manda para o login).
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterLink],
  template: `
    <main
      class="relative min-h-dvh bg-canvas flex flex-col items-center px-4 pt-6 pb-8 overflow-hidden"
    >
      <section
        class="flex-1 w-full max-w-[1040px] flex flex-col items-center justify-center gap-6 text-center py-4"
      >
        <div class="relative w-full flex items-center justify-center">
          <span
            aria-hidden="true"
            class="absolute left-0 right-0 top-1/2 -translate-y-[58%] text-center select-none
                   pointer-events-none font-['Sora'] font-extrabold tracking-[-0.04em] leading-none
                   text-fg/[0.06] text-[clamp(150px,36vw,440px)]"
            >404</span
          >
          <picture class="relative block w-full max-w-[960px]">
            <source type="image/webp" srcset="png/404-ilustracao.webp" />
            <img
              src="png/404-ilustracao.png"
              width="1871"
              height="768"
              loading="eager"
              class="block w-full h-auto"
              alt="Ilustração: placa de sinalização com um X e um mapa, indicando que o caminho não foi encontrado"
            />
          </picture>
        </div>

        <div class="flex flex-col items-center gap-2">
          <h1
            class="font-bold tracking-tight leading-tight text-fg text-[clamp(24px,5vw,36px)]"
          >
            Opa, essa página saiu da rota.
          </h1>
          <p class="text-base text-fg-muted max-w-[40ch] leading-relaxed">
            O endereço que você abriu não existe ou foi movido. Volte ao painel e siga de onde
            parou.
          </p>
        </div>

        <div class="w-full max-w-[360px] flex flex-col gap-1 pt-2">
          <a
            routerLink="/dashboard"
            data-home
            class="w-full min-h-[44px] inline-flex items-center justify-center rounded-xl px-5
                   text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 shadow-sm
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                   focus-visible:ring-offset-2"
            >Voltar ao painel</a
          >
          <button
            type="button"
            data-back
            (click)="back()"
            class="min-h-[44px] text-sm font-medium text-fg-muted hover:text-fg rounded-xl
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                   focus-visible:ring-offset-2"
          >
            Voltar à página anterior
          </button>
        </div>
      </section>

      @if (supportUrl) {
        <p class="relative text-sm text-fg-muted text-center">
          Precisa de ajuda?
          <a
            [href]="supportUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-primary-700 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-400 underline-offset-2 hover:underline
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            >Fale com o suporte</a
          >
        </p>
      }
    </main>
  `,
})
export class NotFound {
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  /** WhatsApp do suporte (E.164 sem `+`); vazio esconde o rodapé, como na tela de Suporte. */
  protected readonly supportUrl = environment.supportWhatsapp
    ? `https://wa.me/${environment.supportWhatsapp}`
    : '';

  /**
   * Volta uma página; sem histórico (aba aberta direto na URL quebrada) o `back()` não
   * faria nada, então vai para o painel.
   */
  protected back(): void {
    if (typeof history !== 'undefined' && history.length > 1) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl('/dashboard');
  }
}
