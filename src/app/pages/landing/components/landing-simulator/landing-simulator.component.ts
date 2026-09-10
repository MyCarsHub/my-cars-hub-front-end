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
