import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-hero',
  imports: [RouterModule, NgOptimizedImage],
  templateUrl: './landing-hero.component.html',
  styleUrls: ['./landing-hero.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingHeroComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly mx = signal(0);
  private readonly my = signal(0);

  readonly perks = [
    'Cobranças automáticas',
    'Assinatura eletrônica com validade jurídica',
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
        { threshold: 0.15 },
      );
      this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
    });
  }

  protected onMouseMove(evt: MouseEvent): void {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = this.host.nativeElement as HTMLElement;
    const rect = el.getBoundingClientRect();
    const cx = (evt.clientX - rect.left) / rect.width - 0.5;
    const cy = (evt.clientY - rect.top) / rect.height - 0.5;
    this.mx.set(cx);
    this.my.set(cy);
    el.style.setProperty('--spotlight-x', `${evt.clientX - rect.left}px`);
    el.style.setProperty('--spotlight-y', `${evt.clientY - rect.top}px`);
  }

  protected chipParallax(index: 1 | 2 | 3, axis: 'x' | 'y'): string {
    const strength = [10, 14, 8][index - 1];
    const sign = axis === 'x' ? (index === 2 ? -1 : 1) : (index === 3 ? -1 : 1);
    const val = (axis === 'x' ? this.mx() : this.my()) * strength * sign;
    return `${val.toFixed(2)}px`;
  }
}
