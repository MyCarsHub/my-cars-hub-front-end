import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LandingNavComponent } from '../landing/components/landing-nav/landing-nav.component';
import { LandingFooterComponent } from '../landing/components/landing-footer/landing-footer.component';

/**
 * Página do catch-all `**`.
 *
 * Antes o `**` era `redirectTo: 'login'`: toda URL inexistente virava um SOFT-404 em
 * `/login` — uma página que o robots.txt bloqueia. Para o Google isso é o pior dos dois
 * mundos: a URL quebrada responde 200, o conteúdo servido é um destino proibido, e o
 * crawler conclui que o site inteiro responde 200 para qualquer coisa (o que dilui o
 * orçamento de rastreio e pode indexar lixo).
 *
 * LIMITE HONESTO: este é um SPA estático (`outputMode: "static"`, sem processo de
 * servidor — ver `angular.json`). Nenhum componente Angular pode alterar o status HTTP;
 * o host continua devolvendo **200** para esta página. O que muda é o sinal: a rota não
 * declara `data.seo`, então o `SeoService` falha-fechado e emite `noindex, nofollow` sem
 * canonical — que é o mecanismo que o Google realmente honra para tirar a URL do índice.
 * Um 404 de verdade exigiria uma regra no host (Vercel) ou SSR, decisão fora deste escopo.
 *
 * Fica FORA do `AppShell`: um visitante deslogado tem de conseguir ver esta página.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterModule, LandingNavComponent, LandingFooterComponent],
  templateUrl: './not-found.html',
})
export class NotFound {}
