import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-landing-solution',
  templateUrl: './landing-solution.component.html',
  styleUrls: ['./landing-solution.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingSolutionComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private animatedCounters = false;

  readonly days = signal(0);
  readonly speed = signal(0);
  readonly auto = signal(0);

  ngAfterViewInit(): void {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('revealed');
            obs.unobserve(e.target);
            if ((e.target as HTMLElement).dataset['counters'] && !this.animatedCounters) {
              this.animatedCounters = true;
              this.animate(this.days, 14, 1400);
              this.animate(this.speed, 3, 1400);
              this.animate(this.auto, 100, 1600);
            }
          }
        }
      },
      { threshold: 0.2 }
    );
    this.host.nativeElement
      .querySelectorAll('.reveal')
      .forEach((el: Element) => obs.observe(el));
  }

  private animate(target: ReturnType<typeof signal<number>>, end: number, ms: number): void {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      target.set(Math.round(end * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
