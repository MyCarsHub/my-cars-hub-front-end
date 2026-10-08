import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { CHIP_TONE, InviteRow } from './members.model';
import { MembersIcon } from './members-icon';

const CHIP =
  'whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium';

/** Pending and expired invites as a table on desktop (lg+). */
@Component({
  selector: 'app-invites-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ActionsMenu, MembersIcon],
  host: { class: 'block' },
  template: `
    <table class="min-w-full text-sm">
      <thead class="text-xs text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
        <tr>
          <th scope="col" class="px-4 py-3 font-medium text-left">Pessoa</th>
          <th scope="col" class="px-4 py-3 font-medium text-left">Acesso</th>
          <!-- Only when the API reports delivery for at least one invite. -->
          @if (hasDelivery()) {
            <th scope="col" class="px-4 py-3 font-medium text-left">Entrega</th>
          }
          <th scope="col" class="px-4 py-3 font-medium text-left">Validade</th>
          <th scope="col" class="px-4 py-3 font-medium text-right">
            <span class="sr-only">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.id) {
          <tr data-invite-row class="border-b border-neutral-100 hover:bg-neutral-50">
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <div
                  class="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-white border-2 border-dashed border-neutral-300 text-neutral-500"
                  aria-hidden="true"
                >
                  {{ row.initial }}
                </div>
                <div class="min-w-0">
                  <p class="font-medium text-neutral-900 truncate">{{ row.title }}</p>
                  @if (row.subtitle) {
                    <p class="text-xs text-neutral-500 truncate">{{ row.subtitle }}</p>
                  }
                </div>
              </div>
            </td>
            <td class="px-4 py-3">
              <span [class]="chip + ' ' + tone.neutral">{{ row.roleLabel }}</span>
            </td>
            @if (hasDelivery()) {
              <td class="px-4 py-3">
                @if (row.delivery; as delivery) {
                  <span data-delivery-chip [class]="chip + ' ' + tone[delivery.tone]">
                    <app-members-icon
                      [name]="delivery.icon === 'x' ? 'xCircle' : delivery.icon"
                      [size]="12"
                    />{{ delivery.label }}
                  </span>
                }
              </td>
            }
            <td class="px-4 py-3">
              <span data-validity-chip [class]="chip + ' ' + tone[row.validity.tone]">{{
                row.validity.label
              }}</span>
              <p class="text-xs text-neutral-500 mt-1 tabular-nums">
                Enviado em {{ row.sentAt | date: 'dd/MM/yyyy' }}
              </p>
            </td>
            <td class="px-4 py-2 text-right">
              @if (busyId() === row.id) {
                <span role="status" class="text-xs text-neutral-500">Atualizando…</span>
              } @else if (row.canAct) {
                <div class="inline-flex items-center gap-1">
                  @if (row.deliveryFailed || row.expired) {
                    <button
                      type="button"
                      data-inline-resend
                      [disabled]="busyId() !== null"
                      [attr.aria-label]="'Reenviar convite para ' + row.title"
                      (click)="resend.emit(row)"
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
                    [label]="'Ações do convite de ' + row.title"
                    [menuWidth]="240"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      [disabled]="busyId() !== null"
                      (click)="resend.emit(row)"
                      class="w-full flex items-center gap-2 px-3 py-3 text-sm text-neutral-800 hover:bg-neutral-50 min-h-[44px] text-left focus:outline-none focus-visible:bg-neutral-50"
                    >
                      <app-members-icon name="resend" [size]="16" />Reenviar convite
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      [disabled]="busyId() !== null"
                      (click)="cancel.emit(row)"
                      class="w-full flex items-center gap-2 px-3 py-3 text-sm text-rose-700 hover:bg-rose-50 min-h-[44px] text-left focus:outline-none focus-visible:bg-rose-50"
                    >
                      <app-members-icon name="xCircle" [size]="16" />Cancelar convite
                    </button>
                  </app-actions-menu>
                </div>
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
export class InvitesTable {
  readonly rows = input.required<readonly InviteRow[]>();
  readonly busyId = input<string | null>(null);
  readonly resend = output<InviteRow>();
  readonly cancel = output<InviteRow>();

  protected readonly hasDelivery = computed(() => this.rows().some((r) => r.delivery !== null));
  protected readonly chip = CHIP;
  protected readonly tone = CHIP_TONE;
}
