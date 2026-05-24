import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-landing-features',
  templateUrl: './landing-features.component.html',
  styleUrls: ['./landing-features.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFeaturesComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

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
      { threshold: 0.15 }
    );
    this.host.nativeElement
      .querySelectorAll('.reveal')
      .forEach((el: Element) => obs.observe(el));
  }
}
