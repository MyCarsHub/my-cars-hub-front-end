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
            <p class="text-sm text-gray-500 text-center py-6">
                Sem multas no período.
            </p>
        } @else {
            <!-- Mobile: card list -->
            <ul class="space-y-2 lg:hidden">
                @for (r of rows(); track r.id) {
                    <li>
                        <button
                            type="button"
                            class="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200
                                   bg-white text-left min-h-[64px] focus:outline-none focus:ring-2
                                   focus:ring-primary-400 hover:border-primary-300 transition-colors"
                            (click)="rowClick.emit(r)"
                        >
                            <span
                                class="w-8 h-8 shrink-0 rounded-full bg-red-50 text-red-600
                                       flex items-center justify-center text-xs font-semibold tabular-nums"
                            >
                                {{ r.count }}
                            </span>
                            <span class="flex-1 min-w-0">
                                <span class="block text-sm font-medium text-gray-900 truncate">
                                    {{ r.title }}
                                </span>
                                <span class="block text-xs text-gray-500 truncate">
                                    {{ r.subtitle }}
                                </span>
                            </span>
                            <span class="text-sm font-semibold text-gray-900 tabular-nums">
                                {{ format(r.totalAmountCents) }}
                            </span>
                        </button>
                    </li>
                }
            </ul>

            <!-- Desktop: table -->
            <div class="hidden lg:block overflow-hidden rounded-xl border border-gray-200">
                <table class="w-full text-sm">
                    <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                            <th class="text-left px-4 py-2 font-medium">Item</th>
                            <th class="text-left px-4 py-2 font-medium">Detalhe</th>
                            <th class="text-right px-4 py-2 font-medium">Multas</th>
                            <th class="text-right px-4 py-2 font-medium">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (r of rows(); track r.id) {
                            <tr
                                class="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                                (click)="rowClick.emit(r)"
                            >
                                <td class="px-4 py-3 font-medium text-gray-900">{{ r.title }}</td>
                                <td class="px-4 py-3 text-gray-500">{{ r.subtitle }}</td>
                                <td class="px-4 py-3 text-right tabular-nums">{{ r.count }}</td>
                                <td class="px-4 py-3 text-right tabular-nums font-semibold">
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
