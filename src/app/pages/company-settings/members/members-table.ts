import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { CHIP_TONE, MemberRow, ROLE_CHANGE_NOTE } from './members.model';
import { MembersIcon } from './members-icon';

const CHIP =
  'whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium';

/** Active members as a table on desktop (lg+), row actions in the app's kebab menu. */
@Component({
  selector: 'app-members-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ActionsMenu, MembersIcon],
  host: { class: 'block' },
  template: `
    <table class="min-w-full text-sm">
      <thead class="text-xs text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
        <tr>
          <th scope="col" class="px-4 py-3 font-medium text-left">Pessoa</th>
          <th scope="col" class="px-4 py-3 font-medium text-left">Acesso</th>
          <th scope="col" class="px-4 py-3 font-medium text-left">Situação</th>
          <th scope="col" class="px-4 py-3 font-medium text-left">Membro desde</th>
          <th scope="col" class="px-4 py-3 font-medium text-right">
            <span class="sr-only">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.id) {
          <tr data-member-row class="border-b border-neutral-100 hover:bg-neutral-50">
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <div
                  class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-neutral-200 text-neutral-700"
                  aria-hidden="true"
                >
                  {{ row.initial }}
                </div>
                <div class="min-w-0">
                  <p class="font-medium text-neutral-900 truncate">
                    {{ row.name }}
                    @if (row.isSelf) {
                      <span class="font-normal text-neutral-500">(você)</span>
                    }
                  </p>
                  <p class="text-xs text-neutral-500 truncate">{{ row.email }}</p>
                </div>
              </div>
            </td>
            <td class="px-4 py-3">
              <span [class]="chip + ' ' + tone.neutral">{{ row.roleLabel }}</span>
            </td>
            <td class="px-4 py-3">
              <span [class]="chip + ' ' + tone.ok">Com acesso</span>
            </td>
            <td class="px-4 py-3 text-neutral-700 tabular-nums">
              {{ row.memberSince | date: 'dd/MM/yyyy' }}
            </td>
            <td class="px-4 py-2 text-right">
              @if (busyId() === row.id) {
                <span role="status" class="text-xs text-neutral-500">
                  {{ row.isSelf ? 'Saindo…' : 'Removendo…' }}
                </span>
              } @else if (row.canRemove) {
                <app-actions-menu
                  data-member-actions
                  [label]="'Ações para ' + row.name"
                  [menuWidth]="256"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-remove-member
                    [disabled]="busyId() !== null"
                    (click)="remove.emit(row)"
                    class="w-full flex items-center gap-2 px-3 py-3 text-sm text-rose-700 hover:bg-rose-50 min-h-[44px] text-left focus:outline-none focus-visible:bg-rose-50"
                  >
                    <app-members-icon name="userMinus" [size]="16" />{{ row.removeLabel }}
                  </button>
                  <p class="px-3 pb-2 pt-1 text-xs text-neutral-500 border-t border-neutral-100">
                    {{ note }}
                  </p>
                </app-actions-menu>
              } @else {
                <span class="text-xs text-neutral-500">{{ row.lockedReason }}</span>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class MembersTable {
  readonly rows = input.required<readonly MemberRow[]>();
  readonly busyId = input<string | null>(null);
  readonly remove = output<MemberRow>();

  protected readonly chip = CHIP;
  protected readonly tone = CHIP_TONE;
  protected readonly note = ROLE_CHANGE_NOTE;
}
