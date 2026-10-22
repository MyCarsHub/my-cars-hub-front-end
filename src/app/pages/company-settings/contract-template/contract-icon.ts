import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ContractIconName =
  | 'file'
  | 'fileUp'
  | 'fileText'
  | 'check'
  | 'checkCircle'
  | 'sparkles'
  | 'layers'
  | 'pen'
  | 'shield'
  | 'eyeOff'
  | 'eye'
  | 'info'
  | 'clock'
  | 'arrowRight'
  | 'arrowLeft'
  | 'chevronDown'
  | 'download'
  | 'x'
  | 'alert'
  | 'refresh'
  | 'copy'
  | 'trash'
  | 'listChecks';

/**
 * Ícones de traço da página de contrato (traço 2, currentColor, sempre decorativos), no
 * mesmo molde do `MembersIcon`: o app não tem um set global, cada área tem o seu com os
 * desenhos Lucide que já usa. TODA a página desenha ícone por aqui: um traço, um grid.
 */
@Component({
  selector: 'app-contract-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" [attr.width]="size()" [attr.height]="size()"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="stroke()"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('file') {
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        }
        @case ('fileUp') {
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />
        }
        @case ('fileText') {
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
        }
        @case ('check') {
          <polyline points="20 6 9 17 4 12" />
        }
        @case ('checkCircle') {
          <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
        }
        @case ('sparkles') {
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" /><path d="M5 3v4" /><path d="M3 5h4" />
        }
        @case ('layers') {
          <path d="m12 2 9 5-9 5-9-5 9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
        }
        @case ('pen') {
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        }
        @case ('shield') {
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
        }
        @case ('eyeOff') {
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" />
        }
        @case ('eye') {
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        }
        @case ('arrowRight') {
          <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
        }
        @case ('arrowLeft') {
          <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
        }
        @case ('chevronDown') {
          <polyline points="6 9 12 15 18 9" />
        }
        @case ('download') {
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        }
        @case ('x') {
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        }
        @case ('alert') {
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" /><path d="M12 9v4" /><path d="M12 17h.01" />
        }
        @case ('refresh') {
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M8 16H3v5" />
        }
        @case ('copy') {
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        }
        @case ('trash') {
          <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        }
        @case ('listChecks') {
          <path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" />
        }
      }
    </svg>
  `,
})
export class ContractIcon {
  readonly name = input.required<ContractIconName>();
  readonly size = input(20);
  readonly stroke = input(2);
}
