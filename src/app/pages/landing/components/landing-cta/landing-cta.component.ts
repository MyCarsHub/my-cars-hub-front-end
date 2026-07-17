import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-cta',
  imports: [RouterModule],
  templateUrl: './landing-cta.component.html',
  styleUrls: ['./landing-cta.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingCtaComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly particles = Array.from({ length: 8 }, (_, i) => i);

  ngAfterViewInit(): void {
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) { if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); } } },
      { threshold: 0.15 }
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
