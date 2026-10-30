import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * Lista de rótulo e valor num `dl`. Atributo, e não elemento: entre `dl` e `div` não pode
 * haver outro nó, ou o leitor de tela perde o par (AXE definition-list).
 */
@Component({
  selector: 'dl[appKvList]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class.kv-list-inset]': 'inset()',
    '[class.kv-list-flush]': 'flush()',
  },
  styleUrl: './kv-list.css',
  template: `<ng-content />`,
})
export class KvList {
  /** Sob uma linha com ícone: alinha com a coluna de texto dela. */
  readonly inset = input(false, { transform: booleanAttribute });
  /** Dentro de uma folha, que já tem o próprio respiro. */
  readonly flush = input(false, { transform: booleanAttribute });
}
