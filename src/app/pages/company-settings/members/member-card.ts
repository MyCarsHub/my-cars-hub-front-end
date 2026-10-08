import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CHIP_TONE, MemberRow } from './members.model';
import { MembersIcon } from './members-icon';

const CHIP_MOBILE =
  'whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide';

/** One active member on phones and tablets (< lg). */
@Component({
  selector: 'app-member-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MembersIcon],
  host: { class: 'block' },
  template: `
    <article
      data-member-row
      class="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <div class="flex items-start gap-3">
        <div
          class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-neutral-200 text-neutral-700"
          aria-hidden="true"
        >
          {{ row().initial }}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-neutral-900 truncate">
            {{ row().name }}
            @if (row().isSelf) {
              <span class="font-normal text-neutral-500">(você)</span>
            }
          </p>
          <p class="text-xs text-neutral-500 truncate">{{ row().email }}</p>
        </div>
        @if (row().canRemove) {
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
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span [class]="chip + ' ' + tone.neutral">{{ row().roleLabel }}</span>
        <span [class]="chip + ' ' + tone.ok">Com acesso</span>
      </div>
      <p class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>
          Desde
          <span class="text-neutral-700 font-medium tabular-nums">{{
            row().memberSince | date: 'dd/MM/yyyy'
          }}</span>
        </span>
      </p>
      @if (busy()) {
        <p role="status" class="text-xs text-neutral-500">
          {{ row().isSelf ? 'Saindo…' : 'Removendo…' }}
        </p>
      } @else if (row().lockedReason) {
        <p class="text-xs text-neutral-500">{{ row().lockedReason }}</p>
      }
    </article>
  `,
})
export class MemberCard {
  readonly row = input.required<MemberRow>();
  readonly busy = input(false);
  readonly actions = output<MemberRow>();

  protected readonly chip = CHIP_MOBILE;
  protected readonly tone = CHIP_TONE;
}
