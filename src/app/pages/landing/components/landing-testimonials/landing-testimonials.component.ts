import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';

import { COMMUNITY_WHATSAPP_URL } from '../../landing-community';

/** Um fato verificável sobre como o produto é construído — nunca um depoimento. */
interface ProofPoint {
  title: string;
  body: string;
}

/**
 * Prova social honesta de pré-lançamento.
 *
 * Esta seção JÁ EXIBIU seis depoimentos com nome, cidade e tamanho de frota. Nenhum
 * deles vinha de cliente real — decisão do dono do produto de removê-los. O que ficou
 * no lugar só afirma coisas checáveis no próprio produto (roadmap com sugestão e voto,
 * trial de 14 dias sem cartão) mais o convite para a comunidade.
 *
 * Esse histórico é memória de manutenção, e NÃO texto de página: a copy não narra mais a
 * remoção ao visitante (decisão do dono). O que ela afirma é a regra em vigor, no futuro.
 *
 * REGRA: nada entra aqui sem fonte. Nem número de usuários, nem citação, nem nome.
 * Quando existir depoimento real e autorizado, ele volta com nome — não antes.
 */
@Component({
  selector: 'app-landing-testimonials',
  templateUrl: './landing-testimonials.component.html',
  styleUrls: ['./landing-testimonials.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingTestimonialsComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Vazio enquanto o convite real não for colado em `landing-community.ts`. */
  readonly communityUrl = COMMUNITY_WHATSAPP_URL;

  readonly proofPoints: ProofPoint[] = [
    {
      title: 'Depoimento só com nome e autorização.',
      body: 'Quando quem usa o sistema quiser falar, o depoimento entra aqui com o nome de quem falou. Até lá, esta seção só afirma o que você confere dentro do produto.',
    },
    {
      title: 'Roadmap aberto dentro do produto.',
      body: 'Qualquer conta manda uma sugestão e vota no que entra primeiro. A fila de prioridade é a que você vê, não uma versão de marketing dela.',
    },
    {
      title: '14 dias grátis, sem cartão.',
      body: 'Você julga o produto rodando com os seus carros e os seus contratos, não a propaganda dele.',
    },
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
        { threshold: 0.15 }
      );
      this.host.nativeElement
        .querySelectorAll('.reveal')
        .forEach((el: Element) => obs.observe(el));
    });
  }
}
