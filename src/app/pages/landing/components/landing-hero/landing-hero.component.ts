import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-hero',
  imports: [RouterModule, NgOptimizedImage],
  templateUrl: './landing-hero.component.html',
  styleUrls: ['./landing-hero.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingHeroComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  ngAfterViewInit(): void {
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) { if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); } } },
      { threshold: 0.15 }
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
