import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PaintedAction,
  PaintedCard,
  PaintedRing,
  PaintedStats,
} from '../../../../components/core/painted-card/painted-card';
import { GerenciaFinanceChunk } from '../../../../types/gerencia-summary.types';
import { moneyHero } from '../../vehicle-page.model';
import { VehicleIcon } from '../vehicle-icon/vehicle-icon';

/**
 * O dinheiro do carro: Recebido e Contratado lado a lado, com o mesmo peso. Laranja até
 * se pagar, verde depois. Os dois vazios não têm vermelho: faltar um dado não é erro.
 */
@Component({
  selector: 'app-vehicle-money-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  imports: [RouterLink, PaintedCard, PaintedRing, PaintedStats, PaintedAction, VehicleIcon],
  template: `
    @let h = hero();
    <app-painted-card [tone]="h.tone" data-money-hero>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-center lg:items-start">
        <div class="col-start-1 row-start-1 flex flex-col gap-1.5 min-w-0">
          <span class="text-xs uppercase tracking-wide text-white/80">{{ h.title }}</span>
          <span class="text-xs text-white/85 leading-snug">{{ h.line }}</span>
          @if (h.sale; as sale) {
            <span data-sale-line class="text-xs text-white/85 leading-snug">{{ sale }}</span>
          }
        </div>

        @if (h.ring; as ring) {
          <app-painted-ring
            class="col-start-2 row-start-1 lg:row-span-2 lg:self-center"
            [tone]="h.tone"
            [percent]="ring.percent"
            [value]="ring.value"
            unit="recebido"
            [ariaLabel]="ring.aria"
          />
        }

        <div
          class="col-span-2 lg:col-span-1 lg:col-start-1 grid grid-cols-2 gap-4 sm:gap-6 min-w-0"
          data-duo
        >
          @for (c of h.columns; track c.label) {
            <div class="min-w-0 flex flex-col gap-1.5" [attr.data-column]="c.label">
              <span class="text-xs uppercase tracking-wide text-white/80">{{ c.label }}</span>
              <span
                class="text-[clamp(19px,6.2vw,24px)] sm:text-[32px] xl:text-[40px] font-semibold
                       tracking-tight leading-tight tabular-nums whitespace-nowrap"
              >{{ c.amount.whole }}<small class="text-[0.62em] tracking-normal">{{ c.amount.decimals }}</small></span>
              @if (c.percent !== null) {
                <span
                  class="block h-1.5 rounded-full bg-white/25 overflow-hidden"
                  role="img"
                  [attr.aria-label]="c.caption"
                  data-track
                >
                  <i
                    class="block h-full rounded-full bg-white origin-left duo-fill"
                    [style.width.%]="trackWidth(c.percent)"
                  ></i>
                </span>
              }
              <span class="text-xs text-white/85 leading-snug">{{ c.caption }}</span>
              @if (c.result; as result) {
                <span class="mt-1 flex flex-col-reverse gap-0.5">
                  <span class="text-xs text-white/85">resultado</span>
                  <b class="text-sm sm:text-lg font-semibold tabular-nums whitespace-nowrap">{{ result }}</b>
                </span>
              }
            </div>
          }
        </div>
      </div>

      @if (h.stats; as stats) {
        <dl appPaintedStats [stats]="stats"></dl>
      }

      @if (h.empty; as empty) {
        <div class="border-t border-white/25 pt-3 flex flex-col gap-0.5" data-money-empty>
          <b class="text-sm font-semibold">{{ empty.title }}</b>
          <span class="text-xs text-white/85 leading-snug">{{ empty.line }}</span>
        </div>
        @if (emptyTarget(); as target) {
          <a appPaintedAction [tone]="h.tone" [routerLink]="target" data-money-empty-action>
            @if (empty.target === 'edit') {
              <app-vehicle-icon name="plus" [strokeWidth]="2.2" />
            }
            {{ empty.action }}
          </a>
        }
      }
    </app-painted-card>
  `,
  styles: `
    .duo-fill { animation: duo-fill 600ms ease-out backwards; }
    @keyframes duo-fill { from { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) { .duo-fill { animation: none; } }
  `,
})
export class VehicleMoneyHero {
  readonly finance = input.required<GerenciaFinanceChunk>();
  readonly vehicleId = input.required<string>();
  /** Vendido é somente-leitura: o formulário de edição não abre. */
  readonly sold = input(false);

  protected readonly hero = computed(() => moneyHero(this.finance()));

  protected readonly emptyTarget = computed(() => {
    const empty = this.hero().empty;
    if (!empty) return null;
    if (empty.target === 'financing') {
      return ['/veiculos', this.vehicleId(), 'gerencia', 'financiamentos'];
    }
    return this.sold() ? null : ['/veiculos', this.vehicleId(), 'editar'];
  });

  protected trackWidth(percent: number): number {
    return Math.min(percent, 100);
  }
}
