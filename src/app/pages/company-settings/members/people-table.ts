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
      <thead class="text-xs text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
        <tr>
          <th scope="col" class="px-3 py-3 font-medium text-left">Nome</th>
          <th scope="col" class="px-3 py-3 font-medium text-left w-full">E-mail</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">Nível de acesso</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">Status</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">Enviado em / Desde</th>
          <th scope="col" class="px-3 py-3 font-medium text-left">Aceite</th>
          <th scope="col" class="px-3 py-3 font-medium text-right">
            <span class="sr-only">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.key) {
          <tr
            class="border-b border-neutral-100 hover:bg-neutral-50 align-middle"
            [attr.data-member-row]="row.member ? '' : null"
            [attr.data-invite-row]="row.invite ? '' : null"
          >
            <td class="px-3 py-3 min-w-[10rem]">
              <div class="flex items-center gap-3">
                <div
                  class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold"
                  [class]="
                    row.invite
                      ? 'bg-white border-2 border-dashed border-neutral-300 text-neutral-500'
                      : 'bg-neutral-200 text-neutral-700'
                  "
                  aria-hidden="true"
                >
                  {{ row.initial }}
                </div>
                <p class="font-medium text-neutral-900 break-words min-w-0">
                  {{ row.name }}
                  @if (row.isSelf) {
                    <span class="font-normal text-neutral-500">(você)</span>
                  }
                </p>
              </div>
            </td>
            <td data-email class="px-3 py-3 text-neutral-700 break-all min-w-[14rem]">
              {{ row.email }}
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
            <td class="px-3 py-3 text-neutral-700 tabular-nums whitespace-nowrap">
              {{ row.date | date: 'dd/MM/yyyy' }}
            </td>
            <td class="px-3 py-3 whitespace-nowrap">
              @if (row.invite; as invite) {
                <span data-validity [class]="validityTone[invite.validity.tone]">{{
                  invite.validity.label
                }}</span>
              } @else {
                <span class="text-neutral-500">—</span>
              }
            </td>
            <td class="px-3 py-2 text-right">
              @if (busyId() === row.id) {
                <span role="status" class="text-xs text-neutral-500">
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
                      class="w-full flex items-center gap-2 px-3 py-3 text-sm text-rose-700 hover:bg-rose-50 min-h-[44px] text-left focus:outline-none focus-visible:bg-rose-50"
                    >
                      <app-members-icon name="userMinus" [size]="16" />{{ member.removeLabel }}
                    </button>
                    <p class="px-3 pb-2 pt-1 text-xs text-neutral-500 border-t border-neutral-100">
                      {{ note }}
                    </p>
                  </app-actions-menu>
                } @else {
                  <span class="text-xs text-neutral-500 block max-w-[14rem] ml-auto text-right">{{
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
                               border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50
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
                        class="w-full flex items-center gap-2 px-3 py-3 text-sm text-neutral-800 hover:bg-neutral-50 min-h-[44px] text-left focus:outline-none focus-visible:bg-neutral-50"
                      >
                        <app-members-icon name="resend" [size]="16" />Reenviar convite
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        [disabled]="busyId() !== null"
                        (click)="cancel.emit(invite)"
                        class="w-full flex items-center gap-2 px-3 py-3 text-sm text-rose-700 hover:bg-rose-50 min-h-[44px] text-left focus:outline-none focus-visible:bg-rose-50"
                      >
                        <app-members-icon name="xCircle" [size]="16" />Cancelar convite
                      </button>
                    </app-actions-menu>
                  </div>
                } @else {
                  <span class="text-xs text-neutral-500 block max-w-[14rem] ml-auto text-right">{{
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
