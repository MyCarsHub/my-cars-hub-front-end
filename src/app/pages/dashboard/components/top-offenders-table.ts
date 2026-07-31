import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { formatBRL } from '../../../types/dashboard.types';

export interface OffenderRow {
    id: string;
    title: string;
    subtitle: string;
    count: number;
    totalAmountCents: number;
}

@Component({
    selector: 'app-top-offenders-table',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (rows().length === 0) {
            <p class="text-sm text-neutral-500 text-center py-6">
                Sem multas no período.
            </p>
        } @else {
            <!-- Cards (mobile / tablet) -->
            <div class="space-y-3 lg:hidden">
                @for (r of rows(); track r.id) {
                    <article
                        class="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 cursor-pointer
                               hover:border-primary-300 transition-colors"
                        (click)="rowClick.emit(r)"
                        (keydown.enter)="rowClick.emit(r)"
                        (keydown.space)="$event.preventDefault(); rowClick.emit(r)"
                        role="button"
                        tabindex="0"
                        [attr.aria-label]="'Ver detalhes de ' + r.title"
                    >
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                                <p class="text-sm font-semibold text-neutral-900 truncate">
                                    {{ r.title }}
                                </p>
                                <p class="text-xs text-neutral-500 mt-0.5 truncate">
                                    {{ r.subtitle }}
                                </p>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2 text-xs text-neutral-600">
                            <div>
                                <span class="text-neutral-500 uppercase tracking-wide text-[10px]">
                                    Multas
                                </span>
                                <p class="font-semibold text-neutral-900 tabular-nums">
                                    {{ r.count }}
                                </p>
                            </div>
                            <div>
                                <span class="text-neutral-500 uppercase tracking-wide text-[10px]">
                                    Total
                                </span>
                                <p class="font-semibold text-neutral-900 tabular-nums">
                                    {{ format(r.totalAmountCents) }}
                                </p>
                            </div>
                        </div>
                    </article>
                }
            </div>

            <!-- Table (desktop) -->
            <div class="hidden lg:block overflow-x-auto">
                <table class="min-w-full text-sm">
                    <thead>
                        <tr class="text-left text-xs text-neutral-500 uppercase border-b border-neutral-100">
                            <th class="py-2 pr-4 font-medium">Item</th>
                            <th class="py-2 pr-4 font-medium">Detalhe</th>
                            <th class="py-2 pr-4 font-medium">Multas</th>
                            <th class="py-2 pr-4 font-medium">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (r of rows(); track r.id) {
                            <tr
                                class="border-b border-neutral-50 hover:bg-neutral-50/60 cursor-pointer"
                                (click)="rowClick.emit(r)"
                                (keydown.enter)="rowClick.emit(r)"
                                (keydown.space)="$event.preventDefault(); rowClick.emit(r)"
                                tabindex="0"
                                [attr.aria-label]="'Ver detalhes de ' + r.title"
                            >
                                <td class="py-3 pr-4 font-semibold text-neutral-900">{{ r.title }}</td>
                                <td class="py-3 pr-4 text-neutral-500">{{ r.subtitle }}</td>
                                <td class="py-3 pr-4 text-neutral-700 tabular-nums">{{ r.count }}</td>
                                <td class="py-3 pr-4 font-semibold text-neutral-900 tabular-nums">
                                    {{ format(r.totalAmountCents) }}
                                </td>
                            </tr>
                        }
                    </tbody>
                </table>
            </div>
        }
    `,
})
export class TopOffendersTable {
    readonly rows = input.required<OffenderRow[]>();
    readonly rowClick = output<OffenderRow>();

    protected format(cents: number): string {
        return formatBRL(cents);
    }
}
