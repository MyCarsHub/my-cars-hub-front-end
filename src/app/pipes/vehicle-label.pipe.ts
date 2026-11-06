import { Pipe, PipeTransform } from '@angular/core';
import { formatVehicleLabel } from '../utils/display-format';

/** FEAT-0556: "brand model" with the shared display rule; display-only. */
@Pipe({ name: 'vehicleLabel' })
export class VehicleLabelPipe implements PipeTransform {
  transform(brand: string | null | undefined, model?: string | null): string {
    return formatVehicleLabel(brand, model);
  }
}
