import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PlanPriceRow } from './coupon-plan-prices';

/**
 * "Quanto cada plano paga": plano, mensal e anual, com o preço cheio embaixo. Fica no
 * cartão pintado da prévia (texto branco) e no detalhe do cupom (texto da página).
 */
@Component({
  selector: 'app-coupon-plan-prices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-[18px] gap-y-2.5 tabular-nums"
      role="table"
      aria-label="Quanto cada plano paga"
    >
      <div class="contents" role="row">
        <span class="text-xs font-semibold" [class]="mutedClass()" role="columnheader">Plano</span>
        <span class="text-right text-xs font-semibold" [class]="mutedClass()" role="columnheader">Mensal</span>
        <span class="text-right text-xs font-semibold" [class]="mutedClass()" role="columnheader">Anual</span>
      </div>
      @for (row of rows(); track row.name) {
        <div class="contents" role="row" data-testid="coupon-plan-price-row">
          <span class="text-[15px] font-semibold" role="rowheader">{{ row.name }}</span>
          @for (cell of [row.monthly, row.yearly]; track $index) {
            <span class="text-right" role="cell">
              @if (cell) {
                <b class="block text-[15px] font-bold">{{ cell.price }}</b>
                <small class="block text-xs" [class]="mutedClass()">{{ cell.was }}</small>
              } @else {
                <span [class]="mutedClass()">—</span>
              }
            </span>
          }
        </div>
      }
    </div>
  `,
})
export class CouponPlanPricesTable {
  readonly rows = input.required<readonly PlanPriceRow[]>();
  /** `painted` = sobre o laranja/verde sólido; `plain` = sobre a superfície da folha. */
  readonly tone = input<'painted' | 'plain'>('painted');

  protected mutedClass(): string {
    return this.tone() === 'painted' ? 'opacity-90' : 'text-fg-subtle';
  }
}
