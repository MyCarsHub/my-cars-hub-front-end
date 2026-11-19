import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import {
  VENDOR_CATEGORY_LABEL,
  type PlatformVendor,
  type PlatformVendorCategory,
  type PlatformVendorRequest,
} from '../../../types/admin-finance.types';

/** Campo das folhas de Custos: 48px de altura e 16px de fonte (o iPhone não dá zoom no foco). */
export const FIELD =
  'min-h-12 w-full rounded-xl border border-edge-field bg-surface px-3 text-base text-fg ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-60';

export const MAX_VENDOR_NAME = 80;
export const MAX_VENDOR_LABEL = 60;

/** Valor do select de fornecedor que troca a escolha por "cadastrar um novo". */
export const NEW_VENDOR = '__new__';

export const CATEGORY_OPTIONS: readonly { value: PlatformVendorCategory; label: string }[] = (
  Object.keys(VENDOR_CATEGORY_LABEL) as PlatformVendorCategory[]
).map((value) => ({ value, label: VENDOR_CATEGORY_LABEL[value] }));

/** Nome, categoria e rótulo (quando "Outro") de um fornecedor: o mesmo em toda folha. */
export class VendorForm {
  readonly name = new FormControl('', { nonNullable: true });
  readonly category = new FormControl<PlatformVendorCategory>('BACKEND', { nonNullable: true });
  readonly label = new FormControl('', { nonNullable: true });
  /** A categoria escolhida, para o template mostrar o rótulo de "Outro" (OnPush). */
  readonly categoryValue = signal<PlatformVendorCategory>('BACKEND');

  constructor() {
    // A assinatura morre com o controle: os dois vivem só enquanto a folha existe.
    this.category.valueChanges.subscribe((v) => this.categoryValue.set(v));
  }

  fill(v: PlatformVendor | null, category: PlatformVendorCategory = 'BACKEND', name = ''): void {
    this.name.setValue(v?.name ?? name);
    this.category.setValue(v?.category ?? category);
    this.label.setValue(v?.categoryLabel ?? '');
  }

  /** Mensagem do primeiro problema; nulo = pode enviar. */
  validate(): string | null {
    const name = this.name.value.trim();
    if (!name || name.length > MAX_VENDOR_NAME) {
      return `Informe o nome do fornecedor (até ${MAX_VENDOR_NAME} caracteres).`;
    }
    if (this.category.value === 'OTHER') {
      const label = this.label.value.trim();
      if (!label || label.length > MAX_VENDOR_LABEL) {
        return `Diga que tipo de custo é (até ${MAX_VENDOR_LABEL} caracteres).`;
      }
    }
    return null;
  }

  request(active: boolean): PlatformVendorRequest {
    const other = this.category.value === 'OTHER';
    return {
      name: this.name.value.trim(),
      category: this.category.value,
      categoryLabel: other ? this.label.value.trim() : null,
      active,
    };
  }
}

/**
 * Os campos de um fornecedor (nome, categoria e, em "Outro", o rótulo). Sem dia de cobrança: ele
 * mora no custo fixo agora.
 */
@Component({
  selector: 'app-vendor-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium text-fg-muted">Nome do fornecedor</span>
      <input type="text" autocomplete="off" [attr.maxlength]="maxName" [formControl]="form().name"
             data-testid="vendor-name" [class]="field" />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium text-fg-muted">Categoria</span>
      <select [formControl]="form().category" data-testid="vendor-category" [class]="field">
        @for (c of categories; track c.value) {
          <option [value]="c.value">{{ c.label }}</option>
        }
      </select>
    </label>
    @if (form().categoryValue() === 'OTHER') {
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium text-fg-muted">Que custo é esse</span>
        <input type="text" autocomplete="off" [attr.maxlength]="maxLabel" [formControl]="form().label"
               data-testid="vendor-label" [class]="field" />
      </label>
    }
  `,
})
export class VendorFields {
  readonly form = input.required<VendorForm>();
  protected readonly field = FIELD;
  protected readonly categories = CATEGORY_OPTIONS;
  protected readonly maxName = MAX_VENDOR_NAME;
  protected readonly maxLabel = MAX_VENDOR_LABEL;
}
