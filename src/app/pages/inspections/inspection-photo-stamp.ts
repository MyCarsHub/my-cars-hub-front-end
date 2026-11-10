import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { VehicleIcon } from '../vehicles/components/vehicle-icon/vehicle-icon';

/**
 * As duas linhas sob a foto da vistoria: relógio + hora e pino + local (desenho aprovado em
 * `DtVistoria.dc.html`). Uma linha cada, com reticências; o texto inteiro vai no `title`.
 *
 * Usado pela página do dono/gerente e pela do motorista, para as duas dizerem o mesmo.
 */
@Component({
  selector: 'app-inspection-photo-stamp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VehicleIcon],
  host: { class: 'block min-w-0' },
  template: `
    @if (when(); as text) {
      <p data-photo-when class="mt-1.5 flex items-center gap-1.5 text-xs text-fg-soft min-w-0">
        <span class="shrink-0 text-fg-muted"><app-vehicle-icon name="clock" [size]="12" [strokeWidth]="2" /></span>
        <span class="sr-only">Hora da foto:</span>
        <span class="truncate" [attr.title]="text">{{ text }}</span>
      </p>
    }
    @if (where(); as text) {
      <p
        data-photo-where
        class="mt-1 flex items-center gap-1.5 text-xs min-w-0"
        [class.text-fg-soft]="!whereMissing()"
        [class.text-amber-700]="whereMissing()"
        [class.dark:text-amber-300]="whereMissing()"
      >
        <span class="shrink-0" [class.text-fg-muted]="!whereMissing()">
          <app-vehicle-icon name="map-pin" [size]="12" [strokeWidth]="2" />
        </span>
        <span class="sr-only">Local da foto:</span>
        @if (mapUrl(); as url) {
          <a
            data-photo-map
            class="truncate underline underline-offset-2 hover:text-fg focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            [href]="url"
            target="_blank"
            rel="noopener noreferrer"
            [attr.title]="'Abrir no mapa: ' + text"
            >{{ text }}</a
          >
        } @else {
          <span class="truncate" [attr.title]="text">{{ text }}</span>
        }
      </p>
    }
  `,
})
export class InspectionPhotoStamp {
  readonly when = input<string | null>(null);
  readonly where = input<string | null>(null);
  readonly whereMissing = input(false);
  readonly mapUrl = input<string | null>(null);
}
