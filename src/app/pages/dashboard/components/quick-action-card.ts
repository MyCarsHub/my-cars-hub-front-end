import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-quick-action-card',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink],
    template: `
        <a
            [routerLink]="route()"
            class="group flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3 p-3 rounded-xl bg-surface-muted
                   hover:bg-surface-sunken transition-colors min-h-[64px]
                   focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
            <span
                class="w-11 h-11 shrink-0 rounded-xl bg-primary-500 text-white flex items-center justify-center"
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
            <span class="w-full min-w-0 sm:w-auto sm:flex-1">
                <span class="block text-sm font-semibold text-gray-900 dark:text-fg truncate" [attr.title]="label()">{{ label() }}</span>
                @if (description(); as d) {
                    <span class="block text-xs text-gray-500 dark:text-fg-subtle truncate">{{ d }}</span>
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
