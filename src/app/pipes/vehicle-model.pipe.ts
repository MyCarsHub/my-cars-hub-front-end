import { Pipe, PipeTransform } from '@angular/core';
import { formatModel } from '../utils/display-format';

/** FEAT-0556 display rule for vehicle models; display-only. */
@Pipe({ name: 'vehicleModel' })
export class VehicleModelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatModel(value);
  }
}
