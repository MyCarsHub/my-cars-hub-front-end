import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { InviteRow, MemberRow, ROLE_CHANGE_NOTE } from './members.model';
import { MembersIcon } from './members-icon';
import { MembersSheet } from './members-sheet';

export type RowActionsTarget =
  | { kind: 'member'; row: MemberRow }
  | { kind: 'invite'; row: InviteRow };

const ITEM =
  'w-full min-h-14 flex items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:bg-surface-sunken';

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
          <div class="flex items-center gap-3 px-4 pb-3 border-b border-edge-soft">
            <div
              class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-surface-strong text-fg-soft"
              aria-hidden="true"
            >
              {{ t.row.initial }}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-fg truncate">{{ t.row.name }}</p>
              <p class="text-xs text-fg-subtle truncate">
                {{ t.row.email }} · {{ t.row.roleLabel }}
              </p>
            </div>
          </div>
          <div class="py-1">
            <button
              type="button"
              data-remove-member
              [class]="item + ' text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10'"
              (click)="remove.emit(t.row)"
            >
              <span class="text-rose-600 dark:text-rose-300"><app-members-icon name="userMinus" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">{{ t.row.removeLabel }}</span>
                <span class="block text-xs text-rose-700 dark:text-rose-300">
                  {{
                    t.row.isSelf
                      ? 'Você deixa de entrar nesta empresa na hora.'
                      : t.row.name + ' deixa de entrar nesta empresa na hora.'
                  }}
                </span>
              </span>
            </button>
          </div>
          <p class="px-4 pb-5 pt-1 text-xs text-fg-subtle">{{ note }}</p>
        } @else {
          <div class="flex items-center gap-3 px-4 pb-3 border-b border-edge-soft">
            <div
              class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-surface border-2 border-dashed border-edge-strong text-fg-subtle"
              aria-hidden="true"
            >
              {{ t.row.initial }}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-fg truncate">{{ t.row.title }}</p>
              <p class="text-xs text-fg-subtle truncate">
                {{ t.row.email }} · {{ t.row.roleLabel }}
              </p>
            </div>
          </div>
          <div class="py-1 pb-4">
            <button
              type="button"
              data-resend-invite
              [class]="item + ' text-fg-body hover:bg-surface-muted'"
              (click)="resend.emit(t.row)"
            >
              <span class="text-fg-subtle"><app-members-icon name="resend" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">Reenviar convite</span>
                <span class="block text-xs text-fg-subtle">
                  Manda um link novo para o mesmo e-mail. O anterior deixa de valer.
                </span>
              </span>
            </button>
            <button
              type="button"
              data-copy-invite-link
              [class]="item + ' text-fg-body hover:bg-surface-muted'"
              (click)="copyLink.emit(t.row)"
            >
              <span class="text-fg-subtle"><app-members-icon name="link" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">Copiar link</span>
                <span class="block text-xs text-fg-subtle">
                  Gera um link novo e copia. O anterior deixa de valer.
                </span>
              </span>
            </button>
            <button
              type="button"
              data-whatsapp-invite-link
              [class]="item + ' text-fg-body hover:bg-surface-muted'"
              (click)="sendWhatsApp.emit(t.row)"
            >
              <span class="text-fg-subtle"><app-members-icon name="message" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">Enviar pelo WhatsApp</span>
                <span class="block text-xs text-fg-subtle">
                  Gera um link novo e abre o WhatsApp. O anterior deixa de valer.
                </span>
              </span>
            </button>
            <button
              type="button"
              data-cancel-invite
              [class]="item + ' text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10'"
              (click)="cancel.emit(t.row)"
            >
              <span class="text-rose-600 dark:text-rose-300"><app-members-icon name="xCircle" /></span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold">Cancelar convite</span>
                <span class="block text-xs text-rose-700 dark:text-rose-300">O link deixa de funcionar na hora.</span>
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
  /** Resend + copy the new link. The page confirms first: the old link dies. */
  readonly copyLink = output<InviteRow>();
  /** Resend + open WhatsApp with the new link. Same confirmation. */
  readonly sendWhatsApp = output<InviteRow>();
  readonly cancel = output<InviteRow>();

  protected readonly item = ITEM;
  protected readonly note = ROLE_CHANGE_NOTE;
}
