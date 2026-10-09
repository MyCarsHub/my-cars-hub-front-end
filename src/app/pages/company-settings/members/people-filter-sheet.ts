import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { FilterChipGroup } from '../../../components/filter-chip-group/filter-chip-group';
import { ACCESS_OPTIONS, AccessFilter, STATUS_OPTIONS, StatusFilter } from './members.model';
import { MembersSheet } from './members-sheet';

export interface PeopleFilterChoice {
  access: AccessFilter;
  status: StatusFilter;
}

/**
 * Phone filters: a bottom sheet with Acesso and Status as radio chips. The choice is a DRAFT
 * until "Aplicar" (the list does not move while the person is still choosing); "Limpar"
 * clears both and applies at once.
 */
@Component({
  selector: 'app-people-filter-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MembersSheet, FilterChipGroup],
  template: `
    <app-members-sheet [open]="open()" title="Filtrar" (closed)="closed.emit()">
      <div class="px-4 pb-4 space-y-5">
        <div class="space-y-2">
          <p id="filter-access-label" class="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Acesso
          </p>
          <app-filter-chip-group
            [options]="accessOptions"
            [value]="draftAccess()"
            ariaLabelledby="filter-access-label"
            (selectionChange)="draftAccess.set($event)"
          />
        </div>
        <div class="space-y-2">
          <p id="filter-status-label" class="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Status
          </p>
          <app-filter-chip-group
            [options]="statusOptions"
            [value]="draftStatus()"
            ariaLabelledby="filter-status-label"
            (selectionChange)="draftStatus.set($event)"
          />
        </div>
      </div>
      <div sheetFooter>
        <div
          class="border-t border-neutral-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-2"
        >
          <button
            type="button"
            data-filter-clear
            (click)="cleared.emit()"
            class="min-h-12 flex-1 px-5 rounded-xl text-sm font-semibold border border-neutral-200 bg-white
                   text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2
                   focus-visible:ring-primary-400 focus-visible:ring-offset-2"
          >
            Limpar
          </button>
          <button
            type="button"
            data-filter-apply
            (click)="applied.emit({ access: draftAccess(), status: draftStatus() })"
            class="min-h-12 flex-1 px-5 rounded-xl text-sm font-semibold bg-primary-500 text-white
                   hover:bg-primary-600 shadow-sm focus:outline-none focus-visible:ring-2
                   focus-visible:ring-primary-400 focus-visible:ring-offset-2"
          >
            Aplicar
          </button>
        </div>
      </div>
    </app-members-sheet>
  `,
})
export class PeopleFilterSheet {
  readonly open = input.required<boolean>();
  readonly access = input<AccessFilter>('');
  readonly status = input<StatusFilter>('');
  readonly closed = output<void>();
  readonly applied = output<PeopleFilterChoice>();
  readonly cleared = output<void>();

  protected readonly accessOptions = ACCESS_OPTIONS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly draftAccess = signal<AccessFilter>('');
  protected readonly draftStatus = signal<StatusFilter>('');

  constructor() {
    // Every opening starts from what is APPLIED, not from an abandoned draft.
    effect(() => {
      if (this.open()) {
        this.draftAccess.set(this.access());
        this.draftStatus.set(this.status());
      }
    });
  }
}
