import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContractAiService } from './contract-ai.service';
import { fieldLabel } from './contract-ai.messages';

interface FieldRow {
  field: string;
  label: string;
  count: number;
  ids: string[];
}

/**
 * Tela 5 (opcional) — escolher o que entra. Chave por campo, com "usado em N lugares".
 * Desligar manda `accept:false` para as sugestões do campo: o texto original fica ali.
 */
@Component({
  selector: 'app-contract-ai-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="space-y-4">
      <p class="text-sm text-neutral-600">
        Desligue o que você prefere deixar como está escrito no contrato.
      </p>

      <ul class="space-y-2">
        @for (row of rows(); track row.field) {
          <li class="flex items-center gap-3 min-h-[56px] rounded-xl border border-neutral-200 bg-white px-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-neutral-900 break-words">{{ row.label }}</p>
              <p class="text-xs text-neutral-500">
                usado em {{ row.count }} {{ row.count === 1 ? 'lugar' : 'lugares' }}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              class="relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
              [class.bg-primary-600]="isOn(row.field)"
              [class.bg-neutral-300]="!isOn(row.field)"
              [attr.aria-checked]="isOn(row.field)"
              [attr.aria-label]="row.label"
              (click)="toggle(row.field)"
            >
              <span
                class="absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform"
                [class.translate-x-6]="isOn(row.field)"
              ></span>
            </button>
          </li>
        } @empty {
          <li class="text-sm text-neutral-500">Nenhum campo encontrado neste contrato.</li>
        }
      </ul>

      <div class="flex flex-col-reverse sm:flex-row gap-2">
        <button type="button" (click)="svc.showFields.set(false)" [disabled]="svc.busy()"
          class="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          Voltar
        </button>
        <button type="button" (click)="apply()" [disabled]="svc.busy()"
          class="w-full min-h-[48px] rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-[1.2rem] font-bold shadow-sm disabled:opacity-60">
          @if (svc.busy()) { Aplicando… } @else { Aplicar e ver como fica }
        </button>
      </div>
    </div>
  `,
})
export class ContractAiFields {
  protected readonly svc = inject(ContractAiService);

  /** Campos que estavam ligados ao abrir a tela (alguma sugestão aceita). */
  private readonly initiallyOn: ReadonlySet<string>;
  private readonly off = signal<ReadonlySet<string>>(new Set());

  /** Todas as sugestões agrupadas pelo campo efetivo, aceitas ou não. */
  protected readonly rows = computed<FieldRow[]>(() => {
    const d = this.svc.draft();
    if (!d) return [];
    const decisions = this.svc.decisions();
    const byField = new Map<string, FieldRow>();
    for (const s of [...d.certain, ...d.doubts]) {
      const field = decisions[s.id]?.field ?? s.field;
      const row = byField.get(field) ?? {
        field,
        label: fieldLabel(field, field === s.field ? s.fieldLabel : null),
        count: 0,
        ids: [],
      };
      row.count += 1;
      row.ids.push(s.id);
      byField.set(field, row);
    }
    return [...byField.values()];
  });

  constructor() {
    const d = this.svc.draft();
    const decisions = this.svc.decisions();
    const on = new Set<string>();
    const all = new Set<string>();
    for (const s of d?.certain ?? []) {
      const dec = decisions[s.id];
      const field = dec?.field ?? s.field;
      all.add(field);
      if (!dec || dec.accept) on.add(field);
    }
    for (const s of d?.doubts ?? []) {
      const dec = decisions[s.id];
      const field = dec?.field ?? s.field;
      all.add(field);
      if (dec?.accept) on.add(field);
    }
    this.initiallyOn = on;
    this.off.set(new Set([...all].filter((f) => !on.has(f))));
  }

  protected isOn(field: string): boolean {
    return !this.off().has(field);
  }

  protected toggle(field: string): void {
    this.off.update((cur) => {
      const next = new Set(cur);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  protected apply(): void {
    if (this.svc.busy()) return;
    const d = this.svc.draft();
    if (!d) return;
    const off = this.off();
    const decisions = this.svc.decisions();
    for (const s of [...d.certain, ...d.doubts]) {
      const dec = decisions[s.id];
      const field = dec?.field ?? s.field;
      let accept: boolean;
      if (off.has(field)) accept = false;
      else if (this.initiallyOn.has(field)) accept = dec ? dec.accept : true;
      else accept = true; // campo religado nesta tela: aceita todas as suas sugestões
      this.svc.setDecision({ id: s.id, field, accept });
    }
    this.svc.commitDecisions(() => this.svc.showFields.set(false));
  }
}
