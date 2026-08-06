import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

interface FeatureRow {
  label: string;
  status: string;
  badgeClass: string;
}

interface Feature {
  title: string;
  description: string;
  viz: 'chips' | 'rows' | 'bar' | 'export';
  chips?: string[];
  rows?: FeatureRow[];
  barLabel?: string;
  exportDoc?: string;
  exportTargets?: string[];
}

@Component({
  selector: 'app-landing-features',
  templateUrl: './landing-features.component.html',
  styleUrls: ['./landing-features.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingFeaturesComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly revealed = signal(false);

  readonly features: Feature[] = [
    {
      title: 'Conectado ao seu PSP.',
      description: 'Pix, boleto ou cartão pelo gateway que você já usa — status sincronizado por webhook.',
      viz: 'chips',
      chips: ['Pix', 'Boleto', 'Cartão'],
    },
    {
      title: 'Volta pro motorista certo.',
      description: 'Multa vinculada ao contrato. Manutenções agendadas com alerta automático.',
      viz: 'rows',
      rows: [
        { label: 'AIT 5829-G', status: 'A cobrar', badgeClass: 'bg-paper-2 text-ink border border-rule-strong' },
        { label: 'Revisão agendada', status: 'Em 4 dias', badgeClass: 'bg-paper-alt text-muted border border-rule' },
      ],
    },
    {
      title: 'Saldo devedor à vista.',
      description: 'Parcelas, juros e calendário consolidados por veículo da frota.',
      viz: 'bar',
      barLabel: 'Civic 2024 · 18 de 48 parcelas · R$ 61.580 restantes',
    },
    {
      title: 'Contrato pronto — e editável na IA.',
      description: 'Gerado do zero a partir do seu template. Baixe em Markdown ou copie o texto e peça pra sua IA favorita ajustar cláusulas.',
      viz: 'export',
      exportDoc: 'contrato.md',
      exportTargets: ['ChatGPT', 'Claude', 'Gemini'],
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
              this.revealed.set(true);
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
