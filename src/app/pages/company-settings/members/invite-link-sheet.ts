import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { InviteShare } from '../../../components/invite-share/invite-share';
import { MembersSheet } from './members-sheet';

/**
 * The new link of an invite that was just resent from the list, on its own sheet.
 *
 * It opens when the page could not finish the action by itself — the clipboard refused or
 * the browser blocked the WhatsApp tab, both of which need a tap that the confirmation +
 * request chain no longer counts as. The tap on "Copiar link" / "Enviar pelo WhatsApp" in
 * here is a fresh gesture, so it works where the automatic attempt did not.
 *
 * The page holds the link only while this sheet is mounted: `closed` is its cue to drop it.
 */
@Component({
  selector: 'app-invite-link-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MembersSheet, InviteShare],
  template: `
    <app-members-sheet
      [open]="true"
      title="Link do convite"
      [subtitle]="'Novo link para ' + recipient() + '. O anterior deixou de valer.'"
      (closed)="closed.emit()"
    >
      <div class="px-4 pb-4">
        <app-invite-share [link]="link()" [companyName]="companyName()" />
      </div>
      <div sheetFooter>
        <div class="border-t border-neutral-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            data-link-done
            (click)="closed.emit()"
            class="min-h-12 w-full px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center
                   bg-primary-500 text-white hover:bg-primary-600 shadow-sm
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
          >
            Concluir
          </button>
        </div>
      </div>
    </app-members-sheet>
  `,
})
export class InviteLinkSheet {
  readonly link = input.required<string>();
  /** Who the invite is for (name or e-mail), for the subtitle. */
  readonly recipient = input.required<string>();
  readonly companyName = input<string | null>(null);
  readonly closed = output<void>();
}
