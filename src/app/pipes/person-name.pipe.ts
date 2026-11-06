import { Pipe, PipeTransform } from '@angular/core';
import { formatPersonName } from '../utils/display-format';

/** FEAT-0556 display rule for person names; display-only. */
@Pipe({ name: 'personName' })
export class PersonNamePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatPersonName(value);
  }
}
