import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ApiErrorService } from '../../../services/api-error.service';
import type { PlatformVendor } from '../../../types/admin-finance.types';
import { AdminFinanceService } from '../finance/admin-finance.service';
import { costErrorMessage } from './costs-copy';
import { VendorFields, VendorForm } from './vendor-fields';

/**
 * "Novo fornecedor" / "Editar fornecedor": só nome e categoria. Valores e dias ficam nos custos
 * fixos; ativar e desativar ficam no ⋮ da linha.
 */
@Component({
  selector: 'app-vendor-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, BottomSheet, VendorFields],
  template: `
    <app-bottom-sheet [title]="title()" [subtitle]="subtitle" [busy]="saving()" (closed)="closed.emit()">
      <form class="flex flex-col gap-4" data-testid="vendor-sheet" (submit)="$event.preventDefault(); submit()" novalidate>
        <app-vendor-fields [form]="form" />
        @if (error(); as msg) {
          <app-alert-banner variant="error" [message]="msg" data-testid="vendor-error" />
        }
        <button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Salvar</button>
      </form>
      <div sheetFooter class="pt-3 flex flex-col-reverse gap-2 lg:flex-row lg:justify-end">
        <button type="button" data-testid="vendor-cancel" (click)="cancel()"
                class="press min-h-12 rounded-xl border border-edge px-5 text-base font-semibold text-fg hover:bg-surface-muted
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          Cancelar
        </button>
        <button type="button" data-testid="vendor-save" [disabled]="saving()" (click)="submit()"
                class="press min-h-12 rounded-xl bg-primary-500 px-5 text-base font-semibold text-white hover:bg-primary-600
                       disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          {{ saving() ? 'Salvando…' : 'Salvar fornecedor' }}
        </button>
      </div>
    </app-bottom-sheet>
  `,
})
export class VendorSheet implements OnInit {
  private readonly service = inject(AdminFinanceService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly sheet = viewChild.required(BottomSheet);

  /** Nulo = novo fornecedor. */
  readonly vendor = input<PlatformVendor | null>(null);
  readonly saved = output<PlatformVendor>();
  readonly closed = output<void>();

  protected readonly form = new VendorForm();
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly title = computed(() => (this.vendor() ? 'Editar fornecedor' : 'Novo fornecedor'));
  protected readonly subtitle = 'Só quem cobra: nome e categoria. Valores e dias ficam nos custos fixos.';

  ngOnInit(): void {
    this.form.fill(this.vendor());
  }

  protected cancel(): void {
    this.sheet().requestClose();
  }

  protected submit(): void {
    this.error.set(null);
    const invalid = this.form.validate();
    if (invalid) {
      this.error.set(invalid);
      return;
    }
    const v = this.vendor();
    const body = this.form.request(v?.active ?? true);
    this.saving.set(true);
    (v ? this.service.updateVendor(v.id, body) : this.service.createVendor(body)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
        this.sheet().requestClose(true);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.apiErrors.claim(err);
        this.error.set(costErrorMessage(err, 'Não foi possível salvar. Já existe um fornecedor com esse nome?'));
      },
    });
  }
}
