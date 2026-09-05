import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { parsePtBrMoneyCents } from '../../../../utils/ptbr-number';
import { applyPtBrMoneyMask } from '../../../../utils/ptbr-money-mask';
import { CreateVehicleSaleRequest } from '../../../../types/vehicle.types';
import { saleReleasesSlotNote } from '../../vehicle-sale-copy';

/**
 * O que o diálogo devolve: exatamente o corpo do `POST /sale`, já em CENTAVOS.
 *
 * Os nomes são os do `SellVehicleRequestDto` de propósito — o diálogo entrega
 * algo que o service repassa SEM remapear. Um mapeamento no meio é onde um
 * `soldAt`/`amount` "mais bonito" se esconde e vira 400 em produção.
 */
export type SellVehicleFormValue = CreateVehicleSaleRequest;

/**
 * Diálogo de "vender veículo" (FEAT-0072).
 *
 * Segue o padrão de DIÁLOGO DE FORMULÁRIO do projeto (irmão do
 * `ConcludeMaintenanceDialog` e do `MarkPaidDialog`): `open` por
 * `input.required`, `confirmed`/`cancelled` por `output()`, standalone, e o PAI
 * é quem controla o `open` e quem chama a API. Não é um `ConfirmDialog` — aquele
 * só carrega texto e é o que a exclusão usa.
 *
 * Três campos, todos obrigatórios: comprador, data e valor. A validação é
 * INLINE, um erro por campo, no mesmo tom das outras telas — o usuário conserta
 * sem sair do diálogo, e a recusa do servidor (`errorMessage`) também é
 * renderizada aqui dentro, com o formulário preservado.
 */
@Component({
  selector: 'app-sell-vehicle-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sell-vehicle-dialog.html',
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('dialog', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        animate(
          '200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        ),
      ]),
    ]),
  ],
})
export class SellVehicleDialog {
  readonly open = input.required<boolean>();
  /** Linha de contexto (placa · marca modelo) mostrada sob o título. */
  readonly entityLabel = input<string>('');
  /**
   * Teto do seletor de data: a venda não pode ser no futuro. Vem do pai porque
   * o template não tem `new Date()` — mesma regra do sinistro
   * (`incident-form.maxOccurredAt`).
   */
  readonly maxSaleDate = input.required<string>();
  /** Recusa do servidor: renderizada DENTRO do diálogo, que continua aberto. */
  readonly errorMessage = input<string | null>(null);
  readonly busy = input<boolean>(false);

  readonly confirmed = output<SellVehicleFormValue>();
  readonly cancelled = output<void>();

  private readonly buyerRef = viewChild<ElementRef<HTMLInputElement>>('buyerInput');

  /**
   * O efeito da venda na vaga do plano (FIX-0262), dito ANTES de confirmar.
   * A frase mora em `vehicle-sale-copy` porque o banner de vendido diz a mesma
   * coisa — duas cópias divergem no primeiro ajuste de texto.
   */
  protected readonly slotNote = saleReleasesSlotNote;

  protected readonly buyerName = signal('');
  protected readonly saleDate = signal('');
  protected readonly amount = signal('');
  /** Só mostra erro depois que o usuário mexeu no campo (ou tentou confirmar). */
  protected readonly submitted = signal(false);

  protected readonly buyerInvalid = computed(
    () => this.submitted() && this.buyerName().trim() === '',
  );

  protected readonly dateInvalid = computed(() => {
    if (!this.submitted()) return false;
    const value = this.saleDate();
    // Vazio é inválido; futuro também (o backend recusa, e recusar aqui evita
    // a viagem). O `input[type=date]` já limita pelo `max`, mas teclado e
    // colagem passam por cima dele.
    return value === '' || value > this.maxSaleDate();
  });

  protected readonly dateErrorText = computed(() =>
    this.saleDate() === ''
      ? 'Informe a data da venda.'
      : 'A venda não pode ser no futuro.',
  );

  /**
   * CENTAVOS do valor digitado, ou `null` quando a gramática pt-BR recusa.
   *
   * DIVERGÊNCIA DELIBERADA COM O BACKEND, registrada: o `SellVehicleRequestDto`
   * aceita `@Min(0)` — venda de R$ 0 passa lá. Aqui exigimos `> 0`, porque no
   * formulário um zero é quase sempre campo esquecido ou vírgula errada, e
   * gravar uma venda de zero reais é um estrago silencioso no financeiro. Quem
   * precisar registrar doação/baixa por R$ 0 vai precisar de um nó próprio que
   * peça isso explicitamente.
   */
  protected readonly amountCents = computed(() => {
    const raw = this.amount().trim();
    if (raw === '') return null;
    const { scaled, error } = parsePtBrMoneyCents(raw);
    if (error !== null || scaled === null || scaled <= 0) return null;
    return scaled;
  });

  protected readonly amountInvalid = computed(
    () => this.submitted() && this.amountCents() === null,
  );

  protected readonly amountErrorText = computed(() =>
    this.amount().trim() === ''
      ? 'Informe o valor da venda.'
      : 'Informe um valor maior que zero (ex.: 45.000,00).',
  );

  constructor() {
    // Cada abertura começa limpa: um formulário que guarda a venda anterior
    // convida a registrar a mesma venda duas vezes.
    effect(() => {
      if (this.open()) return;
      this.buyerName.set('');
      this.saleDate.set('');
      this.amount.set('');
      this.submitted.set(false);
    });

    // Foco para dentro do diálogo (WCAG) no primeiro campo.
    effect(() => {
      if (!this.open()) return;
      this.buyerRef()?.nativeElement.focus();
    });

    // Recusa do servidor: o formulário fica como estava e o foco volta para o
    // início dele — o botão de confirmar perdeu o foco ao desabilitar.
    effect(() => {
      if (!this.errorMessage()) return;
      this.buyerRef()?.nativeElement.focus();
    });
  }

  protected onBuyerInput(event: Event): void {
    this.buyerName.set((event.target as HTMLInputElement).value);
  }

  protected onDateInput(event: Event): void {
    this.saleDate.set((event.target as HTMLInputElement).value);
  }

  /**
   * Máscara de milhar DURANTE a digitação (FIX-0261): o helper reescreve o
   * campo já agrupado ("45000" → "45.000") e devolve o caret para onde o
   * usuário estava. O signal guarda o valor FORMATADO — `amountCents` continua
   * parseando com `parsePtBrMoneyCents`, que aceita agrupamento, então o
   * caminho de parse/emit não muda.
   */
  protected onAmountInput(event: Event): void {
    this.amount.set(applyPtBrMoneyMask(event, this.amount()).value);
  }

  /**
   * O botão de confirmar NÃO fica desabilitado por formulário incompleto (só
   * por `busy`): é o clique que marca `submitted` e revela os erros inline. Um
   * botão morto sem explicação é o que faz o usuário achar que a tela travou.
   */
  protected onConfirm(): void {
    this.submitted.set(true);
    const cents = this.amountCents();
    if (this.busy() || cents === null) return;
    if (this.buyerName().trim() === '') return;
    if (this.saleDate() === '' || this.saleDate() > this.maxSaleDate()) return;

    this.confirmed.emit({
      buyerName: this.buyerName().trim(),
      saleDate: this.saleDate(),
      saleValueCents: cents,
    });
  }

  /** Há algo digitado que seria perdido ao fechar. */
  private readonly dirty = computed(
    () => this.buyerName().trim() !== '' || this.saleDate() !== '' || this.amount().trim() !== '',
  );

  protected onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }

  /**
   * Fechar pelo BACKDROP (ou por Escape) não pode jogar fora um formulário
   * preenchido: um toque fora do diálogo no celular é fácil demais de dar sem
   * querer. Com campo preenchido o clique no fundo é ignorado — sair continua
   * possível pelo botão "Voltar", que é explícito.
   */
  protected onDismiss(): void {
    if (this.busy() || this.dirty()) return;
    this.cancelled.emit();
  }

  protected onEscape(event: Event): void {
    if (!this.open() || this.busy() || this.dirty()) return;
    event.preventDefault();
    this.cancelled.emit();
  }
}
