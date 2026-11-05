import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type KpiGlyphName =
  | 'receipt'
  | 'check'
  | 'clock'
  | 'alert'
  | 'contract'
  | 'coin'
  | 'calendar'
  | 'shield';

/**
 * Ícone do rótulo do `app-kpi-card`, no mesmo traço e tamanho (14px, stroke 2) dos cartões de
 * Cupons. Vai no slot `[kpiIcon]`: `<app-kpi-glyph kpiIcon name="clock" />`. Decorativo — o
 * rótulo do cartão já diz o que é.
 */
@Component({
  selector: 'app-kpi-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex', 'aria-hidden': 'true' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('receipt') {
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
          <path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" />
        }
        @case ('check') {
          <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
        }
        @case ('alert') {
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" /><path d="M12 17h.01" />
        }
        @case ('contract') {
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" />
        }
        @case ('coin') {
          <circle cx="12" cy="12" r="9" />
          <path d="M14.8 9A2 2 0 0 0 13 8h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1" />
          <path d="M12 6v2m0 8v2" />
        }
        @case ('calendar') {
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" />
          <path d="M3 10h18" />
        }
        @case ('shield') {
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        }
      }
    </svg>
  `,
})
export class KpiGlyph {
  readonly name = input.required<KpiGlyphName>();
}
