import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-cta',
  imports: [RouterModule],
  templateUrl: './landing-cta.component.html',
  styleUrls: ['./landing-cta.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingCtaComponent {
  readonly particles = Array.from({ length: 18 }, (_, i) => i);
}
