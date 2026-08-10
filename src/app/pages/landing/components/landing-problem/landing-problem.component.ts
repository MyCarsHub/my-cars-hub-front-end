import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-problem',
  imports: [RouterModule],
  templateUrl: './landing-problem.component.html',
  styleUrls: ['./landing-problem.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingProblemComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly cadernoItems = [
    'Vencimentos e devoluções no escuro',
    'Multas esquecidas no seu nome',
    'Zero automação',
    'Se você some, a operação some junto',
  ];

  readonly planilhaItems = [
    'Só uma pessoa edita por vez',
    'Sem integração com gateway',
    'Qualquer erro derruba tudo',
    'Quebra no primeiro mês com 3 carros rodando',
  ];

  readonly ourItems = [
    'Contratos, carros e motoristas num lugar só',
    'Cobranças via Asaas/Stripe com status por webhook',
    'Multas vinculadas ao motorista certo',
    'Manutenções com alerta antecipado',
    'Multi-empresa em um login só',
  ];

  constructor() {
    this.revealOnScroll();
  }

  private revealOnScroll(): void {
    // `afterNextRender` em vez de `ngAfterViewInit`: este bloco usa APIs de DOM real
    // (IntersectionObserver, NodeList.forEach) que não existem durante o prerender. O
    // Angular pula estes callbacks no servidor — ver `app.routes.server.ts`.
    afterNextRender(() => {
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('revealed');
              obs.unobserve(e.target);
            }
          }
        },
        { threshold: 0.15 },
      );
      this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
    });
  }
}
