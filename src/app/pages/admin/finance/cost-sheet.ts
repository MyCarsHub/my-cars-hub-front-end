import { HttpErrorResponse } from '@angular/common/http';
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
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Observable, concatMap, map, of } from 'rxjs';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { ApiErrorService } from '../../../services/api-error.service';
import {
  PlatformCost,
  PlatformVendor,
  PlatformVendorCategory,
  VENDOR_CATEGORY_LABEL,
} from '../../../types/admin-finance.types';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { applyPtBrMoneyMaskToControl } from '../../../utils/ptbr-money-mask';
import { ptBrMoneyCents, ptBrMoneyValidator } from '../../../utils/validators/ptbr-money.validator';
import { AdminFinanceService } from './admin-finance.service';

/** Valor do select que troca o fornecedor por "cadastrar outro". */
export const OTHER_VENDOR = '__other__';
/** Nome sugerido do fornecedor de aquisição quando ele ainda não existe. */
export const ACQUISITION_VENDOR_NAME = 'Aquisição';
const MAX_NOTE = 500;
const MAX_NAME = 80;
const MAX_LABEL = 60;

const CATEGORY_OPTIONS: readonly { value: PlatformVendorCategory; label: string }[] = (
  Object.keys(VENDOR_CATEGORY_LABEL) as PlatformVendorCategory[]
).map((value) => ({ value, label: VENDOR_CATEGORY_LABEL[value] }));

/** O que abriu a folha: o botão do cabeçalho, o convite do CAC ou o do dia de cobrança. */
export type CostSheetIntent = 'cost' | 'acquisition' | 'billing-day';

/** Resultado do lançamento, para a página recarregar só o que mudou. */
export interface CostSheetResult {
  readonly vendor: PlatformVendor;
  readonly cost: PlatformCost | null;
}

/** `2026-11` -> `novembro de 2026`. */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/**
 * "Lançar custo": valor de UM fornecedor em UM mês, e o dia em que ele cobra. Custo, lucro,
 * margem e "a pagar" da Visão geral só existem a partir daqui (a tabela começa vazia).
 *
 * Um fornecedor que ainda não existe é cadastrado no mesmo passo. Dinheiro é TEXTO mascarado
 * (contrato dos campos de dinheiro pt-BR): só vira centavos no envio. Todos os campos têm 16px,
 * para o iPhone não dar zoom no foco.
 */
@Component({
  selector: 'app-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner, BottomSheet],
  templateUrl: './cost-sheet.html',
})
export class CostSheet implements OnInit {
  private readonly service = inject(AdminFinanceService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly sheet = viewChild.required(BottomSheet);

  /** Fornecedores já carregados pela página (evita uma ida ao servidor). */
  readonly vendors = input<readonly PlatformVendor[]>([]);
  readonly intent = input<CostSheetIntent>('cost');
  /** Fornecedor já escolhido (o convite do dia de cobrança abre no fornecedor certo). */
  readonly vendorId = input<string | null>(null);
  readonly saved = output<CostSheetResult>();
  readonly closed = output<void>();

  protected readonly otherVendor = OTHER_VENDOR;
  protected readonly categoryOptions = CATEGORY_OPTIONS;
  protected readonly maxNote = MAX_NOTE;

  protected readonly vendorControl = new FormControl('', { nonNullable: true });
  protected readonly nameControl = new FormControl('', { nonNullable: true });
  protected readonly categoryControl = new FormControl<PlatformVendorCategory>('BACKEND', { nonNullable: true });
  protected readonly labelControl = new FormControl('', { nonNullable: true });
  protected readonly monthControl = new FormControl(todayInBusinessTz().slice(0, 7), { nonNullable: true });
  protected readonly amountControl = new FormControl('', {
    nonNullable: true,
    validators: [ptBrMoneyValidator({ optional: true })],
  });
  protected readonly dayControl = new FormControl('', { nonNullable: true });
  protected readonly noteControl = new FormControl('', { nonNullable: true });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal(false);
  private readonly vendorValue = signal('');
  private readonly categoryValue = signal<PlatformVendorCategory>('BACKEND');

  protected readonly creating = computed(() => this.vendorValue() === OTHER_VENDOR);
  protected readonly selectedVendor = computed(
    () => this.vendors().find((v) => v.id === this.vendorValue()) ?? null,
  );
  protected readonly needsLabel = computed(() => this.creating() && this.categoryValue() === 'OTHER');
  protected readonly title = computed(() =>
    this.intent() === 'acquisition'
      ? 'Gasto com aquisição'
      : this.intent() === 'billing-day'
        ? 'Dia de cobrança'
        : 'Lançar custo',
  );
  protected readonly subtitle = computed(() =>
    this.intent() === 'acquisition'
      ? 'Anúncios, indicações, eventos: o que foi gasto para conquistar clientes no mês. É a base do CAC.'
      : 'Um valor por fornecedor a cada mês. Lançar de novo o mesmo mês corrige o valor.',
  );

  ngOnInit(): void {
    this.vendorControl.valueChanges.subscribe((v) => {
      this.vendorValue.set(v);
      this.syncDay();
    });
    this.categoryControl.valueChanges.subscribe((v) => this.categoryValue.set(v));
    this.vendorControl.setValue(this.initialVendor());
    if (this.creating() && this.intent() === 'acquisition') {
      this.nameControl.setValue(ACQUISITION_VENDOR_NAME);
      this.categoryControl.setValue('ACQUISITION');
    }
  }

  /** Aquisição abre no fornecedor ACQUISITION (ou no cadastro dele); o resto, no pedido ou no primeiro. */
  private initialVendor(): string {
    const list = this.vendors().filter((v) => v.active);
    const preset = this.vendorId();
    if (preset && list.some((v) => v.id === preset)) return preset;
    if (this.intent() === 'acquisition') {
      return list.find((v) => v.category === 'ACQUISITION')?.id ?? OTHER_VENDOR;
    }
    return list[0]?.id ?? OTHER_VENDOR;
  }

  /** O dia já informado aparece no campo, para não ser apagado sem querer. */
  private syncDay(): void {
    const day = this.selectedVendor()?.billingDay ?? null;
    this.dayControl.setValue(day === null ? '' : String(day));
  }

  protected activeVendors(): PlatformVendor[] {
    return this.vendors().filter((v) => v.active);
  }

  protected vendorOptionLabel(v: PlatformVendor): string {
    return `${v.name} · ${v.categoryLabel || VENDOR_CATEGORY_LABEL[v.category]}`;
  }

  protected onAmountInput(event: Event): void {
    applyPtBrMoneyMaskToControl(event, this.amountControl);
  }

  protected amountError(): string | null {
    if (!this.submitted()) return null;
    const e = this.amountControl.errors;
    if (!e) return null;
    return e['moneyFormat'] ? 'Valor inválido. Use o formato 1.234,56.' : 'Valor inválido.';
  }

  protected monthLabel(): string {
    return monthName(this.monthControl.value);
  }

  /** Erros do formulário, na ordem em que aparecem; nulo = pode enviar. */
  private validate(): string | null {
    if (this.creating()) {
      const name = this.nameControl.value.trim();
      if (!name || name.length > MAX_NAME) return `Informe o nome do fornecedor (até ${MAX_NAME} caracteres).`;
      if (this.needsLabel()) {
        const label = this.labelControl.value.trim();
        if (!label || label.length > MAX_LABEL) return `Diga que tipo de custo é (até ${MAX_LABEL} caracteres).`;
      }
    }
    if (!/^\d{4}-\d{2}$/.test(this.monthControl.value)) return 'Escolha o mês.';
    if (this.amountControl.invalid) return 'Confira o valor.';
    const day = this.parsedDay();
    if (day === 'invalid') return 'O dia de cobrança vai de 1 a 31.';
    if (this.noteControl.value.length > MAX_NOTE) return `A nota passa de ${MAX_NOTE} caracteres.`;
    const cents = ptBrMoneyCents(this.amountControl.value);
    const dayChanged = this.creating() ? day !== null : day !== (this.selectedVendor()?.billingDay ?? null);
    if (cents === null && !dayChanged) return 'Informe o valor do mês ou o dia de cobrança.';
    return null;
  }

  private parsedDay(): number | null | 'invalid' {
    const raw = this.dayControl.value.trim();
    if (!raw) return null;
    if (!/^\d{1,2}$/.test(raw)) return 'invalid';
    const n = Number(raw);
    return n >= 1 && n <= 31 ? n : 'invalid';
  }

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    const invalid = this.validate();
    if (invalid) {
      this.error.set(invalid);
      return;
    }
    const day = this.parsedDay() as number | null;
    const cents = ptBrMoneyCents(this.amountControl.value);
    const month = this.monthControl.value;
    const note = this.noteControl.value.trim() || null;

    this.saving.set(true);
    this.resolveVendor(day)
      .pipe(
        concatMap((vendor) =>
          cents === null
            ? of<CostSheetResult>({ vendor, cost: null })
            : this.service
                .setCost(vendor.id, month, { amountCents: cents, note })
                .pipe(map((cost) => ({ vendor, cost }))),
        ),
      )
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.saved.emit(result);
          this.sheet().requestClose(true);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.apiErrors.claim(err);
          this.error.set(this.messageOf(err));
        },
      });
  }

  /** Cadastra o fornecedor novo, ou grava o dia de cobrança se ele mudou; senão, segue com o escolhido. */
  private resolveVendor(day: number | null): Observable<PlatformVendor> {
    if (this.creating()) {
      return this.service.createVendor({
        name: this.nameControl.value.trim(),
        category: this.categoryControl.value,
        categoryLabel: this.needsLabel() ? this.labelControl.value.trim() : null,
        billingDay: day,
        active: true,
      });
    }
    const vendor = this.selectedVendor();
    if (!vendor) throw new Error('fornecedor ausente');
    if (day === vendor.billingDay) return of(vendor);
    return this.service.updateVendor(vendor.id, {
      name: vendor.name,
      category: vendor.category,
      categoryLabel: vendor.categoryLabel,
      billingDay: day,
      active: vendor.active,
    });
  }

  private messageOf(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 403) return 'Só o Dono da plataforma lança custos.';
      if (err.status === 409) return 'Já existe um fornecedor com esse nome. Escolha-o na lista.';
      const msg = (err.error as { message?: unknown } | null)?.message;
      if (err.status === 400 && typeof msg === 'string' && msg) return msg;
    }
    return 'Não foi possível salvar. Tente de novo.';
  }
}
