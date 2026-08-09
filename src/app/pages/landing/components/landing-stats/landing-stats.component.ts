import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';

/**
 * Faixa de estatísticas — números sobre o PRODUTO, nunca sobre tração.
 *
 * Esta seção JÁ PUBLICOU três alegações falsas: "180+ frotas ativas" (havia 18 empresas),
 * "R$ 12M em contratos ativos/mês" (R$ 112.950 somando todo o histórico) e "99,9% de
 * uptime nos últimos 12 meses" (não existe monitoramento que sustente). Um número falso é
 * pior que um depoimento falso — passa impressão de fato aferido — e ainda contradizia a
 * seção "Construído em público", que admite não haver cliente para depor.
 *
 * Os três números que ficaram são verdades sobre o que o sistema faz, com fonte no código:
 *
 * - `14` dias de teste  → `landing-plans.ts` (`PLAN_PRICES.trialDays`), mesmo número que o
 *   hero, o CTA, a tabela de planos e o FAQ anunciam.
 * - `9` áreas da operação → `components/sidebar/sidebar.ts`: aluguéis, veículos,
 *   motoristas, manutenções, multas, sinistros, financiamentos, seguros e relatórios.
 * - `5` tipos de alerta → `types/notification-feed.types.ts` (`NotificationType`):
 *   CNH_DUE_SOON, LICENSING_DUE_SOON, IPVA_DUE_SOON, INSURANCE_DUE_SOON e
 *   FINANCING_INSTALLMENT_DUE.
 *
 * REGRA: nenhum número entra aqui sem fonte no código, e nenhum número de ADOÇÃO entra —
 * nem contagem de empresas, nem volume financeiro, nem uptime. Se um módulo ou um tipo de
 * alerta nascer, atualize o número E a lista enumerada no HTML, que é o que torna a
 * afirmação auditável pelo visitante.
 */
@Component({
  selector: 'app-landing-stats',
  templateUrl: './landing-stats.component.html',
  styleUrls: ['./landing-stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingStatsComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

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
            if (!e.isIntersecting) continue;
            e.target.classList.add('revealed');
            obs.unobserve(e.target);
            if ((e.target as HTMLElement).dataset['counters'] && !(e.target as HTMLElement).dataset['counted']) {
              (e.target as HTMLElement).dataset['counted'] = '1';
              e.target.querySelectorAll<HTMLElement>('[data-count]').forEach((node) => {
                const end = parseInt(node.dataset['count']!, 10);
                this.animate(node, end, end > 50 ? 1600 : 1400);
              });
            }
          }
        },
        { threshold: 0.2 }
      );
      this.host.nativeElement
        .querySelectorAll('.reveal')
        .forEach((el: Element) => obs.observe(el));
    });
  }

  private animate(node: HTMLElement, end: number, ms: number): void {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = Math.round(end * eased).toLocaleString('pt-BR');
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
