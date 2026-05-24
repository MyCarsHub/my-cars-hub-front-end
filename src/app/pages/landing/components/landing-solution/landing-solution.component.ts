import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-landing-solution',
  templateUrl: './landing-solution.component.html',
  styleUrls: ['./landing-solution.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingSolutionComponent implements AfterViewInit {
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
      { threshold: 0.2 }
    );
    this.host.nativeElement
      .querySelectorAll('.reveal')
      .forEach((el: Element) => obs.observe(el));
  }
}
