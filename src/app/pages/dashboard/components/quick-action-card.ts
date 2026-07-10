import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-quick-action-card',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    template: `
        <a
            [routerLink]="route()"
            class="group flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-white
                   hover:border-primary-400 hover:shadow-sm transition-all min-h-[64px]
                   focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
            <span
                class="w-10 h-10 shrink-0 rounded-lg bg-primary-50 text-primary-500
                       flex items-center justify-center group-hover:bg-primary-100 transition-colors"
                aria-hidden="true"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path [attr.d]="icon()" />
                </svg>
            </span>
            <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold text-gray-900">{{ label() }}</span>
                @if (description(); as d) {
                    <span class="block text-xs text-gray-500 truncate">{{ d }}</span>
                }
            </span>
        </a>
    `,
})
export class QuickActionCard {
    readonly route = input.required<string>();
    readonly label = input.required<string>();
    readonly icon = input.required<string>();
    readonly description = input<string | null>(null);
}
