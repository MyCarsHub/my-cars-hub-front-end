import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';

interface Testimonial {
  initials: string;
  name: string;
  location: string;
  quote: string;
}

@Component({
  selector: 'app-landing-testimonials',
  templateUrl: './landing-testimonials.component.html',
  styleUrls: ['./landing-testimonials.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingTestimonialsComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly testimonials: Testimonial[] = [
    {
      initials: 'AM',
      name: 'André M.',
      location: 'Goiânia/GO · 24 carros',
      quote:
        'O fechamento do mês era o pesadelo do domingo. Hoje abro o sistema, dou OK em duas coisas e vou jantar.',
    },
    {
      initials: 'MS',
      name: 'Mariana S.',
      location: 'Curitiba/PR · 11 carros',
      quote:
        'Pagava multa do locatário do meu bolso porque não conseguia rastrear quem usou o carro. Acabou esse pesadelo.',
    },
    {
      initials: 'FL',
      name: 'Felipe L.',
      location: 'Porto Alegre/RS · 17 carros',
      quote:
        'Cobrança no WhatsApp consumia minha tarde inteira. Agora o gateway emite, o cliente paga, o sistema baixa.',
    },
    {
      initials: 'BR',
      name: 'Beatriz R.',
      location: 'Recife/PE · 28 carros',
      quote:
        'Comecei com 6 carros numa planilha. Hoje tenho 28 e o sistema escala junto sem precisar migrar de novo.',
    },
    {
      initials: 'LC',
      name: 'Lucas C.',
      location: 'São Paulo/SP · 47 carros',
      quote:
        'Sou sócio de uma locadora e gestor de outra. Mesmo login, troca em 1 clique. Esse detalhe sozinho já valia a assinatura.',
    },
    {
      initials: 'CB',
      name: 'Camila B.',
      location: 'Florianópolis/SC · 14 carros',
      quote:
        'Migrei de um sistema que tinha 200 telas e eu usava 5. Aqui é minimalista, faz o que precisa, sem firula.',
    },
  ];

  ngAfterViewInit(): void {
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
  }
}
