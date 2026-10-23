import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { coverModel } from './driver-dashboard.model';
import * as ui from './driver-finance.ui';

export type RentCover = NonNullable<ReturnType<typeof coverModel>>;

/**
 * «Aluguel da semana» do Dashboard: quanto do aluguel o que entrou desde a última cobrança
 * já cobre, e a próxima cobrança. Componente próprio de propósito — é o SLOT que a
 * integração com o protótipo de Meu aluguel (feat/0361) pode trocar sem mexer no Dashboard.
 */
@Component({
  selector: 'app-driver-rent-cover-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    @let c = cover();
    <div [class]="ui.CARD">
      <div [class]="ui.CARD_HEAD"><h2 [class]="ui.H2">{{ c.title }}</h2></div>
      <div class="px-4 sm:px-6 pt-3 pb-4 sm:pb-6 flex flex-col gap-3.5">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-lg sm:text-xl font-semibold tabular-nums"
            [class]="c.tone === 'done' ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg'">{{ c.pct }}%</span>
          <span class="text-xs text-fg-subtle text-right tabular-nums">{{ c.sub }}</span>
        </div>
        <div role="progressbar" aria-label="Cobertura do aluguel" aria-valuemin="0" aria-valuemax="100"
          [attr.aria-valuenow]="c.pct" class="h-2 rounded bg-surface-sunken overflow-hidden">
          <div class="h-full rounded" [style.width.%]="c.pct"
            [class]="c.tone === 'done' ? 'bg-emerald-700' : c.tone === 'mid' ? 'bg-amber-500' : 'bg-primary-500'"></div>
        </div>
        <p class="m-0 text-sm text-fg-body leading-relaxed">{{ c.text }}</p>
        @if (c.next) {
          <div class="flex flex-col gap-0.5 border-t border-edge-soft pt-3">
            <span [class]="ui.EYEBROW">Próxima cobrança</span>
            <span class="text-sm font-semibold text-fg tabular-nums">{{ c.next }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class DriverRentCoverCard {
  readonly cover = input.required<RentCover>();
  protected readonly ui = ui;
}
