import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-pricing',
  imports: [RouterModule],
  templateUrl: './landing-pricing.component.html',
  styleUrls: ['./landing-pricing.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingPricingComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly cycle = signal<'monthly' | 'yearly'>('monthly');

  private readonly proMonthly = 79.9;
  private readonly proYearlyMonth = 63.9;
  protected readonly proPrice = computed(() =>
    this.cycle() === 'monthly' ? this.proMonthly : this.proYearlyMonth,
  );
  protected readonly proSavings = computed(() =>
    Math.round((1 - this.proYearlyMonth / this.proMonthly) * 100),
  );
  protected readonly proYearlyTotal = computed(() => Math.round(this.proYearlyMonth * 12));

  readonly trialItems = [
    'Até 2 veículos',
    'Até 3 motoristas',
    'Contratos, cobranças, multas, manutenções',
    'Suporte por email',
  ];

  readonly proItems = [
    'Até 20 veículos',
    'Motoristas ilimitados',
    'Cobranças automáticas por Asaas e Stripe',
    'Assinatura eletrônica com validade jurídica',
    'Vistoria digital com 6 fotos por veículo',
    'Multi-usuário com controle de acesso',
    'Suporte prioritário',
  ];

  readonly businessItems = [
    'Veículos ilimitados',
    'Multi-empresa ilimitado (cadastre suas filiais)',
    'Usuários e papéis ilimitados',
    'Relatórios avançados exportáveis',
    'Onboarding assistido dedicado',
    'Suporte prioritário com SLA',
  ];

  protected setCycle(c: 'monthly' | 'yearly'): void { this.cycle.set(c); }
  protected formatBRL(v: number): string { return v.toFixed(2).replace('.', ','); }

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
