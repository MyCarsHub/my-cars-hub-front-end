import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-landing-footer',
  imports: [RouterModule],
  templateUrl: './landing-footer.component.html',
  styleUrls: ['./landing-footer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFooterComponent {
  readonly year = new Date().getFullYear();
}
