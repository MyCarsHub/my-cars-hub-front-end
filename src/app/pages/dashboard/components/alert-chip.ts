import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export type AlertVariant = 'danger' | 'warning' | 'info';

interface Palette {
    bg: string;
    text: string;
    border: string;
    iconBg: string;
    iconText: string;
}

const PALETTES: Record<AlertVariant, Palette> = {
    danger: {
        bg: 'bg-red-50',
        text: 'text-red-800',
        border: 'border-red-100',
        iconBg: 'bg-red-100',
        iconText: 'text-red-600',
    },
    warning: {
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-100',
        iconBg: 'bg-amber-100',
        iconText: 'text-amber-600',
    },
    info: {
        bg: 'bg-blue-50',
        text: 'text-blue-800',
        border: 'border-blue-100',
        iconBg: 'bg-blue-100',
        iconText: 'text-blue-600',
    },
};

@Component({
    selector: 'app-alert-chip',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button
            type="button"
            class="w-full flex items-center gap-3 min-h-[56px] px-3 py-2 rounded-xl border
                   text-left transition-colors hover:brightness-95 focus:outline-none
                   focus:ring-2 focus:ring-primary-400"
            [class]="chipClasses()"
            (click)="chipClick.emit()"
        >
            <span
                class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center"
                [class]="iconClasses()"
                aria-hidden="true"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
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
                <span class="block text-xs font-medium opacity-80 truncate">{{ label() }}</span>
                <span class="flex flex-wrap items-baseline gap-x-2 text-base font-semibold tabular-nums">
                    <span>{{ count() }}</span>
                    @if (amountLabel(); as a) {
                        <span class="text-xs font-normal opacity-80 truncate">{{ a }}</span>
                    }
                </span>
            </span>
        </button>
    `,
})
export class AlertChip {
    readonly variant = input<AlertVariant>('info');
    readonly label = input.required<string>();
    readonly count = input.required<number>();
    readonly amountLabel = input<string | null>(null);
    readonly icon = input.required<string>();

    readonly chipClick = output<void>();

    protected readonly palette = computed(() => PALETTES[this.variant()]);
    protected readonly chipClasses = computed(() => {
        const p = this.palette();
        return `${p.bg} ${p.text} ${p.border}`;
    });
    protected readonly iconClasses = computed(() => {
        const p = this.palette();
        return `${p.iconBg} ${p.iconText}`;
    });
}
