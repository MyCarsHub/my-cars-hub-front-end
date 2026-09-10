import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { ControlMethod, simulate } from './simulator-math';

/**
 * Simulador de tempo da landing (âncora #simulador, logo abaixo do hero).
 *
 * O visitante arrasta o slider com o tamanho da frota e vê ao vivo quantas
 * horas/mês perde no manual contra ~2h com o MyCarsHub. Puro client-side —
 * a fórmula vive em `simulator-math.ts` (pura, testável sem DOM). Título,
 * subtítulo e CTA são texto estático no template (indexável); só os números
 * são dinâmicos.
 */
@Component({
  selector: 'app-landing-simulator',
  imports: [RouterModule],
  templateUrl: './landing-simulator.component.html',
  styleUrls: ['./landing-simulator.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingSimulatorComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly cars = signal(7);
  protected readonly method = signal<ControlMethod>('planilha');

  protected readonly result = computed(() => simulate(this.cars(), this.method()));

  /** Percentual preenchido da trilha do slider (faixa 1–30). */
  protected readonly sliderFill = computed(
    () => ((this.cars() - 1) / 29) * 100,
  );

  protected readonly carsValueText = computed(() =>
    this.cars() === 1 ? '1 carro' : `${this.cars()} carros`,
  );

  /**
   * Linhas do breakdown (sem emoji): rótulo + horas + mini-barra proporcional.
   * `miniPct` é relativo à MAIOR linha (cobranças, taxa 1,4 — sempre 100%),
   * então as quatro mini-barras se comparam entre si, não com o total.
   */
  protected readonly sourceRows = computed(() => {
    const { lines } = this.result();
    const rows = [
      { key: 'charges', label: 'Cobrar aluguel um por um', hours: lines.charges },
      { key: 'spreadsheet', label: 'Manter a planilha em dia', hours: lines.spreadsheet },
      { key: 'fines', label: 'Descobrir e repassar multas', hours: lines.fines },
      { key: 'documents', label: 'CNH, IPVA e manutenção', hours: lines.documents },
    ];
    const max = Math.max(...rows.map((r) => r.hours), 1);
    return rows.map((r) => ({ ...r, miniPct: (r.hours / max) * 100 }));
  });

  /**
   * Segmentos da barra "manual" do gráfico comparativo, na MESMA ordem do
   * breakdown à esquerda (a correspondência linha↔segmento é por posição).
   * Percentuais sobre o total manual — a barra manual é a referência (100%).
   */
  protected readonly segments = computed(() => {
    const { lines, totalManual } = this.result();
    const seg = (hours: number) => (totalManual > 0 ? (hours / totalManual) * 100 : 0);
    return [
      { key: 'charges', pct: seg(lines.charges) },
      { key: 'spreadsheet', pct: seg(lines.spreadsheet) },
      { key: 'fines', pct: seg(lines.fines) },
      { key: 'documents', pct: seg(lines.documents) },
    ];
  });

  /** Largura da barra MyCarsHub, na mesma escala da barra manual (=100%). */
  protected readonly hubPct = computed(() => {
    const { totalManual, withMyCarsHub } = this.result();
    return totalManual > 0 ? (withMyCarsHub / totalManual) * 100 : 0;
  });

  /** Alternativa textual do gráfico (role="img") — todos os valores. */
  protected readonly chartAria = computed(() => {
    const r = this.result();
    return (
      `Gráfico de barras comparativas. No manual: ${r.totalManual} horas por mês — ` +
      `cobranças ${r.lines.charges}h, planilha ${r.lines.spreadsheet}h, ` +
      `multas ${r.lines.fines}h, vencimentos ${r.lines.documents}h. ` +
      `Com o MyCarsHub: cerca de ${r.withMyCarsHub} horas por mês.`
    );
  });

  /** Frase anunciada pelo aria-live a cada recálculo (visualmente oculta). */
  protected readonly liveText = computed(() => {
    const r = this.result();
    return `No manual: ${r.totalManual}h por mês. Com o MyCarsHub: cerca de ${r.withMyCarsHub}h por mês.`;
  });

  protected readonly methods: { id: ControlMethod; label: string }[] = [
    { id: 'planilha', label: 'Planilha + WhatsApp' },
    { id: 'caderno', label: 'Caderno' },
    { id: 'cabeca', label: 'De cabeça' },
  ];

  constructor() {
    // `afterNextRender` em vez de `ngAfterViewInit`: o reveal usa APIs de DOM
    // real (IntersectionObserver) que não existem durante o prerender — mesmo
    // padrão do landing-hero.
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
      this.host.nativeElement
        .querySelectorAll('.reveal')
        .forEach((el: Element) => obs.observe(el));
    });
  }

  protected onSlider(evt: Event): void {
    this.cars.set(Number((evt.target as HTMLInputElement).value));
  }

  protected selectMethod(method: ControlMethod): void {
    this.method.set(method);
  }
}
