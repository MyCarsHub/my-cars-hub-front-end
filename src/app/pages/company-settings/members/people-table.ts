import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import {
  CHIP_TONE,
  InviteRow,
  MemberRow,
  PersonRow,
  ROLE_CHANGE_NOTE,
  validityTextTone,
} from './members.model';
import { MembersIcon } from './members-icon';

const CHIP =
  'whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium';

/** The unified list as a table on desktop (lg+); row actions in the app's kebab menu. */
@Component({
  selector: 'app-people-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ActionsMenu, MembersIcon],
  host: { class: 'block' },
  template: `
    <table class="w-full text-sm">
      <thead class="text-xs text-fg-subtle uppercase tracking-wide border-b border-edge">
        <tr>
          <th scope="col" class="px-3 py-3 font-medium text-left">Nome</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">E-mail</th>
          <th scope="col" class="px-3 py-3 font-medium text-left whitespace-nowrap">Nível de acesso</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">Status</th>
          <th scope="col" class="px-3 py-3 font-medium text-left whitespace-nowrap">Enviado em</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">Aceite</th>
          <th scope="col" class="px-3 py-3 font-medium text-right">
            Ações
          </th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.key) {
          <tr
            class="border-b border-edge-soft hover:bg-surface-muted align-middle"
            [attr.data-member-row]="row.member ? '' : null"
            [attr.data-invite-row]="row.invite ? '' : null"
          >
            <td class="px-3 py-3 min-w-[10rem]">
              <div class="flex items-center gap-3">
                <div
                  class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold"
                  [class]="
                    row.invite
                      ? 'bg-surface border-2 border-dashed border-edge-strong text-fg-subtle'
                      : 'bg-surface-strong text-fg-soft'
                  "
                  aria-hidden="true"
                >
                  {{ row.initial }}
                </div>
                <p class="font-medium text-fg break-words min-w-0">
                  {{ row.name }}
                  @if (row.isSelf) {
                    <span class="font-normal text-fg-subtle">(você)</span>
                  }
                </p>
              </div>
            </td>
            <td data-email class="px-3 py-3 text-fg-soft max-w-[16rem] min-w-[10rem]">
              <span class="block truncate" [attr.title]="row.email">{{ row.email }}</span>
            </td>
            <td class="px-3 py-3">
              <span [class]="chip + ' ' + tone.neutral">{{ row.roleLabel }}</span>
            </td>
            <td class="px-3 py-3">
              <div class="flex flex-col items-start gap-1">
                <span data-status-chip [class]="chip + ' ' + tone[row.statusChip.tone]">{{
                  row.statusChip.label
                }}</span>
                @if (row.invite?.delivery; as delivery) {
                  <span data-delivery-chip [class]="chip + ' ' + tone[delivery.tone]">
                    <app-members-icon
                      [name]="delivery.icon === 'x' ? 'xCircle' : delivery.icon"
                      [size]="12"
                    />{{ delivery.label }}
                  </span>
                }
              </div>
            </td>
            <td class="px-3 py-3 text-fg-soft tabular-nums whitespace-nowrap">
              {{ row.date | date: 'dd/MM/yyyy' }}
            </td>
            <td class="px-3 py-3 whitespace-nowrap">
              @if (row.invite; as invite) {
                <span data-validity [class]="validityTone[invite.validity.tone]">{{
                  invite.validity.label
                }}</span>
              } @else {
                <span class="text-fg-subtle">—</span>
              }
            </td>
            <td class="px-3 py-2 text-right min-w-[14rem]">
              @if (busyId() === row.id) {
                <span role="status" class="text-xs text-fg-subtle">
                  {{ busyLabel(row) }}
                </span>
              } @else if (row.member; as member) {
                @if (member.canRemove) {
                  <app-actions-menu
                    data-member-actions
                    [label]="'Ações para ' + member.name"
                    [menuWidth]="256"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-remove-member
                      [disabled]="busyId() !== null"
                      (click)="remove.emit(member)"
                      class="w-full flex items-center gap-2 px-3 py-3 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 min-h-[44px] text-left focus:outline-none focus-visible:bg-rose-50 dark:focus-visible:bg-rose-500/10"
                    >
                      <app-members-icon name="userMinus" [size]="16" />{{ member.removeLabel }}
                    </button>
                    <p class="px-3 pb-2 pt-1 text-xs text-fg-subtle border-t border-edge-soft">
                      {{ note }}
                    </p>
                  </app-actions-menu>
                } @else {
                  <span class="text-xs text-fg-subtle block max-w-[14rem] ml-auto text-right">{{
                    member.lockedReason
                  }}</span>
                }
              } @else if (row.invite; as invite) {
                @if (invite.canAct) {
                  <div class="inline-flex items-center gap-1">
                    @if (invite.deliveryFailed || invite.expired) {
                      <button
                        type="button"
                        data-inline-resend
                        [disabled]="busyId() !== null"
                        [attr.aria-label]="'Reenviar convite para ' + invite.title"
                        (click)="resend.emit(invite)"
                        class="min-h-[44px] px-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2
                               border border-edge bg-surface text-fg-soft hover:bg-surface-muted
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2
                               disabled:opacity-60"
                      >
                        <app-members-icon name="resend" [size]="16" />Reenviar
                      </button>
                    }
                    <app-actions-menu
                      data-invite-actions
                      [label]="'Ações do convite de ' + invite.title"
                      [menuWidth]="240"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        [disabled]="busyId() !== null"
                        (click)="resend.emit(invite)"
                        class="w-full flex items-center gap-2 px-3 py-3 text-sm text-fg-body hover:bg-surface-muted min-h-[44px] text-left focus:outline-none focus-visible:bg-surface-muted"
                      >
                        <app-members-icon name="resend" [size]="16" />Reenviar convite
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-copy-invite-link
                        [disabled]="busyId() !== null"
                        (click)="copyLink.emit(invite)"
                        class="w-full flex items-center gap-2 px-3 py-3 text-sm text-fg-body hover:bg-surface-muted min-h-[44px] text-left focus:outline-none focus-visible:bg-surface-muted"
                      >
                        <app-members-icon name="link" [size]="16" />Copiar link
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-whatsapp-invite-link
                        [disabled]="busyId() !== null"
                        (click)="sendWhatsApp.emit(invite)"
                        class="w-full flex items-center gap-2 px-3 py-3 text-sm text-fg-body hover:bg-surface-muted min-h-[44px] text-left focus:outline-none focus-visible:bg-surface-muted"
                      >
                        <app-members-icon name="message" [size]="16" />Enviar pelo WhatsApp
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        [disabled]="busyId() !== null"
                        (click)="cancel.emit(invite)"
                        class="w-full flex items-center gap-2 px-3 py-3 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 min-h-[44px] text-left focus:outline-none focus-visible:bg-rose-50 dark:focus-visible:bg-rose-500/10"
                      >
                        <app-members-icon name="xCircle" [size]="16" />Cancelar convite
                      </button>
                    </app-actions-menu>
                  </div>
                } @else {
                  <span class="text-xs text-fg-subtle block max-w-[14rem] ml-auto text-right">{{
                    invite.lockedReason
                  }}</span>
                }
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class PeopleTable {
  readonly rows = input.required<readonly PersonRow[]>();
  readonly busyId = input<string | null>(null);
  readonly remove = output<MemberRow>();
  readonly resend = output<InviteRow>();
  readonly copyLink = output<InviteRow>();
  readonly sendWhatsApp = output<InviteRow>();
  readonly cancel = output<InviteRow>();

  protected readonly chip = CHIP;
  protected readonly tone = CHIP_TONE;
  protected readonly validityTone = validityTextTone;
  protected readonly note = ROLE_CHANGE_NOTE;

  protected busyLabel(row: PersonRow): string {
    if (row.invite) return 'Atualizando…';
    return row.isSelf ? 'Saindo…' : 'Removendo…';
  }
}
