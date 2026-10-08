import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CHIP_TONE, InviteRow } from './members.model';
import { MembersIcon } from './members-icon';

const CHIP_MOBILE =
  'whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide';

/** One pending or expired invite on phones and tablets (< lg). */
@Component({
  selector: 'app-invite-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MembersIcon],
  host: { class: 'block' },
  template: `
    <article
      data-invite-row
      class="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <div class="flex items-start gap-3">
        <div
          class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-white border-2 border-dashed border-neutral-300 text-neutral-500"
          aria-hidden="true"
        >
          {{ row().initial }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-neutral-900 truncate">{{ row().title }}</p>
          @if (row().subtitle) {
            <p class="text-xs text-neutral-500 truncate">{{ row().subtitle }}</p>
          }
        </div>
        @if (row().canAct) {
          <button
            type="button"
            data-invite-actions
            [disabled]="busy()"
            [attr.aria-label]="'Ações do convite de ' + row().title"
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
        <span [class]="chip + ' ' + tone.neutral">{{ row().roleLabel }}</span>
        @if (row().delivery; as delivery) {
          <span data-delivery-chip [class]="chip + ' ' + tone[delivery.tone]">
            <app-members-icon [name]="delivery.icon === 'x' ? 'xCircle' : delivery.icon" [size]="12" />
            {{ delivery.label }}
          </span>
        }
        <span data-validity-chip [class]="chip + ' ' + tone[row().validity.tone]">{{
          row().validity.label
        }}</span>
      </div>
      <p class="text-xs text-neutral-500">
        Enviado em
        <span class="text-neutral-700 font-medium tabular-nums">{{
          row().sentAt | date: 'dd/MM/yyyy'
        }}</span>
      </p>
      @if (row().deliveryFailed) {
        <p class="text-xs text-rose-700 break-words">
          O e-mail não chegou a {{ row().email }}. Confira o endereço ou reenvie.
        </p>
      }
      @if (busy()) {
        <p role="status" class="text-xs text-neutral-500">Atualizando o convite…</p>
      } @else if (row().canAct && (row().deliveryFailed || row().expired)) {
        <button
          type="button"
          data-inline-resend
          (click)="resend.emit(row())"
          class="min-h-[44px] px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2
                 border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 w-full sm:w-auto
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
        >
          <app-members-icon name="resend" [size]="16" />Reenviar convite
        </button>
      } @else if (row().lockedReason) {
        <p class="text-xs text-neutral-500">{{ row().lockedReason }}</p>
      }
    </article>
  `,
})
export class InviteCard {
  readonly row = input.required<InviteRow>();
  readonly busy = input(false);
  readonly actions = output<InviteRow>();
  readonly resend = output<InviteRow>();

  protected readonly chip = CHIP_MOBILE;
  protected readonly tone = CHIP_TONE;
}
