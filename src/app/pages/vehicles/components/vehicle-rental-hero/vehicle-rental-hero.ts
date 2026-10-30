import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PaintedAction,
  PaintedCard,
  PaintedRing,
  PaintedStats,
} from '../../../../components/core/painted-card/painted-card';
import { VehicleHero } from '../../vehicle-page.model';
import { VehicleIcon } from '../vehicle-icon/vehicle-icon';

/** O que está acontecendo com o carro agora, com um botão só. */
@Component({
  selector: 'app-vehicle-rental-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0 h-full' },
  imports: [RouterLink, PaintedCard, PaintedRing, PaintedStats, PaintedAction, VehicleIcon],
  template: `
    @let h = hero();
    <app-painted-card class="h-full" [tone]="tone()" data-rental-hero>
      @if (h.kind === 'rented') {
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-1.5 min-w-0">
            <span class="text-xs uppercase tracking-wide text-white/80">Aluguel em curso</span>
            <span
              data-hero-driver
              class="text-[32px] sm:text-[40px] font-semibold tracking-tight leading-tight [overflow-wrap:anywhere]"
            >{{ h.driver }}</span>
            <span data-hero-line class="text-xs text-white/85 leading-snug">{{ h.line }}</span>
          </div>
          <app-painted-ring
            [tone]="h.tone"
            [percent]="h.ring.percent"
            [value]="'' + h.ring.days"
            [unit]="h.ring.unit"
            [ariaLabel]="h.ring.aria"
          />
        </div>
        <dl appPaintedStats [stats]="h.stats"></dl>
        <a appPaintedAction [tone]="h.tone" [routerLink]="['/alugueis', h.rentalId]">
          <app-vehicle-icon name="key" [strokeWidth]="2.2" />
          Ver aluguel
        </a>
      } @else {
        <div class="flex flex-col gap-1.5 min-w-0">
          <span class="text-xs uppercase tracking-wide text-white/80">{{ h.label }}</span>
          <span
            data-hero-big
            class="text-[32px] sm:text-[40px] font-semibold tracking-tight leading-tight tabular-nums"
          >{{ h.big }}</span>
          <span data-hero-line class="text-xs text-white/85 leading-snug">{{ h.line }}</span>
        </div>
        @if (h.action; as action) {
          <a appPaintedAction tone="orange" [routerLink]="action.link" [queryParams]="action.query">
            <app-vehicle-icon [name]="action.icon" [strokeWidth]="2.2" />
            {{ action.label }}
          </a>
        }
      }
    </app-painted-card>
  `,
})
export class VehicleRentalHero {
  readonly hero = input.required<VehicleHero>();

  protected readonly tone = computed(() => {
    const h = this.hero();
    return h.kind === 'rented' ? h.tone : 'orange';
  });
}
