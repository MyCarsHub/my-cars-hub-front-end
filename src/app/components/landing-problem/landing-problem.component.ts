import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';

interface Pain {
  icon: string;
  title: string;
  text: string;
}

@Component({
  selector: 'app-landing-problem',
  templateUrl: './landing-problem.component.html',
  styleUrls: ['./landing-problem.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingProblemComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly pains: Pain[] = [
    {
      icon: 'spreadsheet',
      title: 'Planilha desatualizada',
      text: 'Quem devolveu o carro? Qual contrato venceu ontem? Ninguém sabe.',
    },
    {
      icon: 'notebook',
      title: 'Caderno de controle',
      text: 'Anotação ilegível, dado perdido, multa esquecida no fundo da gaveta.',
    },
    {
      icon: 'whatsapp',
      title: 'WhatsApp como sistema',
      text: 'Cobrança no manual, cliente some, prejuízo garantido no fim do mês.',
    },
    {
      icon: 'clock',
      title: 'Horas perdidas',
      text: 'Conciliação financeira feita na madrugada toda semana.',
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
