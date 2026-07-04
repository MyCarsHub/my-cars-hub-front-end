import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VehicleType } from '../../../types/vehicle.types';

export interface VehicleSummary {
  id: string;
  plate: string;
  brand: string;
  model: string;
  type?: VehicleType;
  hodometer?: number | null;
  licensingExpiration?: string | null;
}

export type VehicleSummaryChipLinkTo = 'detail' | 'gerencia' | 'none';

@Component({
  selector: 'app-vehicle-summary-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'block' },
  template: `
    @let v = vehicle();
    @if (linkTo() === 'none') {
      <div class="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
        <span
          class="flex-none inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary-50 text-primary-600"
          aria-hidden="true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/>
            <circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>
          </svg>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-neutral-900 tabular-nums tracking-wider truncate">
            {{ formattedPlate() }}
          </p>
          <p class="text-xs text-neutral-500 truncate">
            {{ v.brand }} {{ v.model }}@if (v.hodometer != null) { · {{ v.hodometer }} km }
          </p>
        </div>
        @if (typeChip(); as chip) {
          <span
            class="hidden xs:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide flex-none"
            [class]="chip.klass"
          >{{ chip.label }}</span>
        }
      </div>
    } @else {
      <a
        [routerLink]="routerTarget()"
        class="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 hover:border-primary-300 transition-colors"
      >
        <span
          class="flex-none inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary-50 text-primary-600"
          aria-hidden="true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/>
            <circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>
          </svg>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-neutral-900 tabular-nums tracking-wider truncate">
            {{ formattedPlate() }}
          </p>
          <p class="text-xs text-neutral-500 truncate">
            {{ v.brand }} {{ v.model }}@if (v.hodometer != null) { · {{ v.hodometer }} km }
          </p>
        </div>
        @if (typeChip(); as chip) {
          <span
            class="hidden xs:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide flex-none"
            [class]="chip.klass"
          >{{ chip.label }}</span>
        }
        <svg class="flex-none text-neutral-300" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </a>
    }
  `,
})
export class VehicleSummaryChip {
  vehicle = input.required<VehicleSummary>();
  /**
   * Where clicking the chip navigates.
   * - `detail` → `/veiculos/:id` (default)
   * - `gerencia` → `/veiculos/:id/gerencia`
   * - `none` renders a non-interactive chip (useful on the hub itself)
   */
  linkTo = input<VehicleSummaryChipLinkTo>('detail');

  protected readonly formattedPlate = computed(() => {
    const p = (this.vehicle().plate ?? '').toUpperCase();
    if (p.length === 7) return `${p.slice(0, 3)}-${p.slice(3)}`;
    return p || '—';
  });

  protected readonly routerTarget = computed(() => {
    const id = this.vehicle().id;
    return this.linkTo() === 'gerencia'
      ? ['/veiculos', id, 'gerencia']
      : ['/veiculos', id];
  });

  protected typeChip(): { label: string; klass: string } | null {
    const t = this.vehicle().type;
    if (t === 'CAR') return { label: 'Carro', klass: 'bg-blue-100 text-blue-700' };
    if (t === 'MOTORCYCLE') return { label: 'Moto', klass: 'bg-amber-100 text-amber-800' };
    return null;
  }
}
