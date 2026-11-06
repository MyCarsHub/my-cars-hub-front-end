import { Pipe, PipeTransform } from '@angular/core';
import { formatPlate } from '../utils/display-format';

/** FEAT-0556: plate in upper-case, 7-char plates hyphenated; display-only. */
@Pipe({ name: 'plate' })
export class PlatePipe implements PipeTransform {
  transform(value: string | null | undefined, hyphen = true): string {
    return formatPlate(value, { hyphen });
  }
}
