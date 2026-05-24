import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';

@Component({
  selector: 'app-landing-stats',
  templateUrl: './landing-stats.component.html',
  styleUrls: ['./landing-stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingStatsComponent {}
