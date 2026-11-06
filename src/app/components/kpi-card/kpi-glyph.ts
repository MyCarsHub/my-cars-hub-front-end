import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type KpiGlyphName =
  | 'receipt'
  | 'check'
  | 'clock'
  | 'alert'
  | 'contract'
  | 'coin'
  | 'calendar'
  | 'shield'
  | 'car'
  | 'user'
  | 'wrench'
  | 'camera'
  | 'x'
  | 'key'
  | 'swap';

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
        @case ('car') {
          <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
          <circle cx="6.5" cy="16.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" />
        }
        @case ('user') {
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        }
        @case ('wrench') {
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        }
        @case ('camera') {
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        }
        @case ('x') {
          <circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
        }
        @case ('key') {
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        }
        @case ('swap') {
          <path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" />
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
