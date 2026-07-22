import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
} from '@angular/core';

interface FeatureRow {
  label: string;
  status: string;
  badgeClass: string;
}

interface Feature {
  pill: string;
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
export class LandingFeaturesComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly revealed = signal(false);

  readonly features: Feature[] = [
    {
      pill: 'Cobranças',
      title: 'Conectado ao seu PSP.',
      description: 'Pix, boleto ou cartão pelo gateway que você já usa — status sincronizado por webhook.',
      viz: 'chips',
      chips: ['Pix', 'Boleto', 'Cartão'],
    },
    {
      pill: 'Multas & Manutenções',
      title: 'Volta pro motorista certo.',
      description: 'Multa vinculada ao contrato. Manutenções agendadas com alerta automático.',
      viz: 'rows',
      rows: [
        { label: 'AIT 5829-G', status: 'A cobrar', badgeClass: 'bg-paper-2 text-ink border border-rule-strong' },
        { label: 'Revisão agendada', status: 'Em 4 dias', badgeClass: 'bg-paper-alt text-muted border border-rule' },
      ],
    },
    {
      pill: 'Financiamentos',
      title: 'Saldo devedor à vista.',
      description: 'Parcelas, juros e calendário consolidados por veículo da frota.',
      viz: 'bar',
      barLabel: 'Civic 2024 · 18 de 48 parcelas · R$ 61.580 restantes',
    },
    {
      pill: 'Contrato & IA',
      title: 'Contrato pronto — e editável na IA.',
      description: 'Gerado do zero a partir do seu template. Baixe em Markdown ou copie o texto e peça pra sua IA favorita ajustar cláusulas.',
      viz: 'export',
      exportDoc: 'contrato.md',
      exportTargets: ['ChatGPT', 'Claude', 'Gemini'],
    },
  ];

  ngAfterViewInit(): void {
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
  }
}
