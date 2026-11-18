import { Directive, computed, input } from '@angular/core';

/** `default` = neutral action; `danger` = destructive (Excluir, Desativar); `success` = Ativar. */
export type DataListMenuItemTone = 'default' | 'danger' | 'success' | '';

const BASE =
  'flex w-full items-center text-left text-sm px-4 py-3 min-h-[44px] transition-colors ' +
  'focus:outline-none focus-visible:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed';

const TONE: Record<Exclude<DataListMenuItemTone, ''>, string> = {
  default: 'text-fg-soft hover:bg-canvas',
  danger: 'text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10',
  success: 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10',
};

/**
 * One item of a row's kebab (`<ng-template dataListActions>`): 44px tall, full width, NO line
 * between items (space and hover only). Sets `role="menuitem"` itself.
 *
 * @example
 * ```html
 * <ng-template dataListActions let-user>
 *   <a dataListMenuItem [routerLink]="['/admin/users', user.id]">Abrir</a>
 *   <button type="button" dataListMenuItem="danger" (click)="deactivate(user)">Desativar</button>
 * </ng-template>
 * ```
 */
@Directive({
  selector: '[dataListMenuItem]',
  host: { role: 'menuitem', '[class]': 'hostClass()' },
})
export class DataListMenuItem {
  readonly tone = input<DataListMenuItemTone>('default', { alias: 'dataListMenuItem' });

  protected readonly hostClass = computed(() => `${BASE} ${TONE[this.tone() || 'default']}`);
}
