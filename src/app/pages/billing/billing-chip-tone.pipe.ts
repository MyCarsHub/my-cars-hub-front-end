import { Pipe, PipeTransform } from '@angular/core';
import { StatusChipTone } from '../../components/core/status-chip/status-chip';

/** Os códigos de chip que `billing.ts` já devolve, no vocabulário do chip compartilhado. */
const TONE: Record<string, StatusChipTone> = {
  ok: 'green',
  g: 'green',
  brand: 'orange',
  o: 'orange',
  warn: 'amber',
  danger: 'red',
  neutral: 'neutral',
  n: 'neutral',
  // Sobre os degradês profundos da Assinatura: branco translúcido.
  w: 'white',
};

@Pipe({ name: 'billingChipTone' })
export class BillingChipTonePipe implements PipeTransform {
  transform(code: string): StatusChipTone {
    return TONE[code] ?? 'neutral';
  }
}
