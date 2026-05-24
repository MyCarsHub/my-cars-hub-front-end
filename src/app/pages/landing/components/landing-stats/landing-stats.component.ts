import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-landing-stats',
  templateUrl: './landing-stats.component.html',
  styleUrls: ['./landing-stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingStatsComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  ngAfterViewInit(): void {
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
