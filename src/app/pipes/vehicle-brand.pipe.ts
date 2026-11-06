import { Pipe, PipeTransform } from '@angular/core';
import { formatBrand } from '../utils/display-format';

/** FEAT-0556 display rule for vehicle brands; display-only. */
@Pipe({ name: 'vehicleBrand' })
export class VehicleBrandPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatBrand(value);
  }
}
