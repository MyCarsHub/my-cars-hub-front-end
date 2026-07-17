import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
export class LandingProblemComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly cadernoItems = [
    'Vencimentos e devoluções no escuro',
    'Multas esquecidas no CNPJ',
    'Zero automação',
    'Se o dono some, a operação some junto',
  ];

  readonly planilhaItems = [
    'Só uma pessoa edita por vez',
    'Sem integração com gateway',
    'Qualquer erro derruba tudo',
    'Não sobrevive a 100+ contratos',
  ];

  readonly ourItems = [
    'Contratos, veículos e locatários num lugar só',
    'Cobranças via Asaas/Stripe com status por webhook',
    'Multas vinculadas ao motorista certo',
    'Manutenções com alerta antecipado',
    'Multi-empresa em um login só',
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
      { threshold: 0.15 },
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
