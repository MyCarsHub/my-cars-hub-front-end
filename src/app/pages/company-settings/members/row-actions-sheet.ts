import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { InviteRow, MemberRow, ROLE_CHANGE_NOTE } from './members.model';
import { MembersIcon } from './members-icon';
import { MembersSheet } from './members-sheet';

export type RowActionsTarget =
  | { kind: 'member'; row: MemberRow }
  | { kind: 'invite'; row: InviteRow };

const ITEM =
  'w-full min-h-14 flex items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:bg-neutral-100';

/**
 * The row actions on phones: a bottom sheet naming WHO the actions apply to, then one
 * full-width item per action. Choosing an item only emits — the page decides whether a
 * confirmation comes next.
 */
@Component({
  selector: 'app-row-actions-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MembersSheet, MembersIcon],
  template: `
    @if (target(); as t) {
      <app-members-sheet
        [open]="true"
        [title]="t.kind === 'member' ? 'Ações' : 'Convite'"
        (closed)="closed.emit()"
      >
        @if (t.kind === 'member') {
          <div class="flex items-center gap-3 px-4 pb-3 border-b border-neutral-100">
            <div
              class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-neutral-200 text-neutral-700"
              aria-hidden="true"
            >
              {{ t.row.initial }}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-neutral-900 truncate">{{ t.row.name }}</p>
              <p class="text-xs text-neutral-500 truncate">
                {{ t.row.email }} · {{ t.row.roleLabel }}
              </p>
            </div>
          </div>
          <div class="py-1">
            <button
              type="button"
              data-remove-member
              [class]="item + ' text-rose-700 hover:bg-rose-50'"
              (click)="remove.emit(t.row)"
            >
              <span class="text-rose-600"><app-members-icon name="userMinus" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">{{ t.row.removeLabel }}</span>
                <span class="block text-xs text-rose-700">
                  {{
                    t.row.isSelf
                      ? 'Você deixa de entrar nesta empresa na hora.'
                      : t.row.name + ' deixa de entrar nesta empresa na hora.'
                  }}
                </span>
              </span>
            </button>
          </div>
          <p class="px-4 pb-5 pt-1 text-xs text-neutral-500">{{ note }}</p>
        } @else {
          <div class="flex items-center gap-3 px-4 pb-3 border-b border-neutral-100">
            <div
              class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-white border-2 border-dashed border-neutral-300 text-neutral-500"
              aria-hidden="true"
            >
              {{ t.row.initial }}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-neutral-900 truncate">{{ t.row.title }}</p>
              <p class="text-xs text-neutral-500 truncate">
                {{ t.row.email }} · {{ t.row.roleLabel }}
              </p>
            </div>
          </div>
          <div class="py-1 pb-4">
            <button
              type="button"
              data-resend-invite
              [class]="item + ' text-neutral-800 hover:bg-neutral-50'"
              (click)="resend.emit(t.row)"
            >
              <span class="text-neutral-500"><app-members-icon name="resend" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">Reenviar convite</span>
                <span class="block text-xs text-neutral-500">
                  Manda um link novo para o mesmo e-mail. O anterior deixa de valer.
                </span>
              </span>
            </button>
            <button
              type="button"
              data-cancel-invite
              [class]="item + ' text-rose-700 hover:bg-rose-50'"
              (click)="cancel.emit(t.row)"
            >
              <span class="text-rose-600"><app-members-icon name="xCircle" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">Cancelar convite</span>
                <span class="block text-xs text-rose-700">O link deixa de funcionar na hora.</span>
              </span>
            </button>
          </div>
        }
      </app-members-sheet>
    }
  `,
})
export class RowActionsSheet {
  readonly target = input<RowActionsTarget | null>(null);
  readonly closed = output<void>();
  readonly remove = output<MemberRow>();
  readonly resend = output<InviteRow>();
  readonly cancel = output<InviteRow>();

  protected readonly item = ITEM;
  protected readonly note = ROLE_CHANGE_NOTE;
}
