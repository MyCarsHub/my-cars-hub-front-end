import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-problem',
  imports: [RouterModule],
  templateUrl: './landing-problem.component.html',
  styleUrls: ['./landing-problem.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingProblemComponent implements AfterViewInit {
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
