import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface StatusBucketRow {
    status: string;
    count: number;
    label: string;
    color: string;
}

@Component({
    selector: 'app-status-bar-chart',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="space-y-3">
            @for (bar of bars(); track bar.status) {
                <div>
                    <div class="flex justify-between text-xs mb-1">
                        <span class="text-gray-600">{{ bar.label }}</span>
                        <span class="text-gray-900 font-medium tabular-nums">{{ bar.count }}</span>
                    </div>
                    <div class="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                            class="h-full rounded-full transition-all duration-500"
                            [style.width.%]="bar.percent"
                            [style.background-color]="bar.color"
                        ></div>
                    </div>
                </div>
            } @empty {
                <p class="text-sm text-gray-500 text-center py-6">Nada por aqui.</p>
            }
        </div>
    `,
})
export class StatusBarChart {
    readonly buckets = input.required<StatusBucketRow[]>();

    protected readonly bars = computed(() => {
        const rows = this.buckets();
        const total = rows.reduce((s, r) => s + r.count, 0);
        // Preserve the incoming order (zero-filled by backend in enum order) so
        // the visual sequence stays stable across reloads / filter changes.
        return rows.map((r) => ({
            ...r,
            percent: total > 0 ? (r.count / total) * 100 : 0,
        }));
    });
}
