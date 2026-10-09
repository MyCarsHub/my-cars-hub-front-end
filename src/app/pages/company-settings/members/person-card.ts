import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CHIP_TONE, PersonRow, validityTextTone } from './members.model';
import { MembersIcon } from './members-icon';

const CHIP =
  'whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide';

/** One line of the unified list on phones and tablets (< lg): a member or an invite. */
@Component({
  selector: 'app-person-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MembersIcon],
  host: { class: 'block' },
  template: `
    <article
      class="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
      [attr.data-member-row]="row().member ? '' : null"
      [attr.data-invite-row]="row().invite ? '' : null"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <div class="flex items-start gap-3">
        <div
          class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold"
          [class]="
            row().invite
              ? 'bg-white border-2 border-dashed border-neutral-300 text-neutral-500'
              : 'bg-neutral-200 text-neutral-700'
          "
          aria-hidden="true"
        >
          {{ row().initial }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-neutral-900 break-words">
            {{ row().name }}
            @if (row().isSelf) {
              <span class="font-normal text-neutral-500">(você)</span>
            }
          </p>
          @if (row().invite?.subtitle || row().member) {
            <p class="text-xs text-neutral-500 break-all">{{ row().email }}</p>
          }
        </div>
        @if (row().member?.canRemove) {
          <button
            type="button"
            data-member-actions
            [disabled]="busy()"
            [attr.aria-label]="'Ações para ' + row().name"
            aria-haspopup="dialog"
            (click)="actions.emit(row())"
            class="w-11 h-11 -mt-2 -mr-2 inline-flex items-center justify-center rounded-lg text-neutral-500
                   hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                   focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <app-members-icon name="kebab" [size]="18" />
          </button>
        }
        @if (row().invite?.canAct) {
          <button
            type="button"
            data-invite-actions
            [disabled]="busy()"
            [attr.aria-label]="'Ações do convite de ' + row().name"
            aria-haspopup="dialog"
            (click)="actions.emit(row())"
            class="w-11 h-11 -mt-2 -mr-2 inline-flex items-center justify-center rounded-lg text-neutral-500
                   hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                   focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <app-members-icon name="kebab" [size]="18" />
          </button>
        }
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span data-role-chip [class]="chip + ' ' + tone.neutral">{{ row().roleLabel }}</span>
        <span data-status-chip [class]="chip + ' ' + tone[row().statusChip.tone]">{{
          row().statusChip.label
        }}</span>
        @if (row().invite?.delivery; as delivery) {
          <span data-delivery-chip [class]="chip + ' ' + tone[delivery.tone]">
            <app-members-icon [name]="delivery.icon === 'x' ? 'xCircle' : delivery.icon" [size]="12" />
            {{ delivery.label }}
          </span>
        }
      </div>
      @if (row().invite; as invite) {
        <p class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span data-validity [class]="validityTone[invite.validity.tone]">{{
            invite.validity.label
          }}</span>
          <span>
            Enviado em
            <span class="text-neutral-700 font-medium tabular-nums">{{
              row().date | date: 'dd/MM/yyyy'
            }}</span>
          </span>
        </p>
        @if (invite.deliveryFailed) {
          <p class="text-xs text-rose-700 break-words">
            O e-mail não chegou a {{ invite.email }}. Confira o endereço ou reenvie.
          </p>
        }
        @if (busy()) {
          <p role="status" class="text-xs text-neutral-500">Atualizando o convite…</p>
        } @else if (invite.canAct && (invite.deliveryFailed || invite.expired)) {
          <button
            type="button"
            data-inline-resend
            (click)="resend.emit(invite)"
            class="min-h-[44px] px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2
                   border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 w-full sm:w-auto
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
          >
            <app-members-icon name="resend" [size]="16" />Reenviar convite
          </button>
        } @else if (invite.lockedReason) {
          <p class="text-xs text-neutral-500">{{ invite.lockedReason }}</p>
        }
      } @else if (row().member; as member) {
        <p class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span>
            Desde
            <span class="text-neutral-700 font-medium tabular-nums">{{
              member.memberSince | date: 'dd/MM/yyyy'
            }}</span>
          </span>
        </p>
        @if (busy()) {
          <p role="status" class="text-xs text-neutral-500">
            {{ member.isSelf ? 'Saindo…' : 'Removendo…' }}
          </p>
        } @else if (member.lockedReason) {
          <p class="text-xs text-neutral-500">{{ member.lockedReason }}</p>
        }
      }
    </article>
  `,
})
export class PersonCard {
  readonly row = input.required<PersonRow>();
  readonly busy = input(false);
  readonly actions = output<PersonRow>();
  readonly resend = output<NonNullable<PersonRow['invite']>>();

  protected readonly chip = CHIP;
  protected readonly tone = CHIP_TONE;
  protected readonly validityTone = validityTextTone;
}
