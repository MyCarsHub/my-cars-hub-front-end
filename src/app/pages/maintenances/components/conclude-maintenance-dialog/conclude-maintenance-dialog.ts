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
import { HttpErrorResponse } from '@angular/common/http';
import { animate, style, transition, trigger } from '@angular/animations';

/** Só dígitos: `Number('51.000')` seria 51 e o usuário nunca saberia. */
const DIGITS_ONLY = /^\d+$/;

/**
 * Erros que o usuário consegue corrigir SEM sair do diálogo — recusa da leitura
 * enviada (`400`) ou payload inválido (`422`). Um `409` (status da manutenção já
 * não permite concluir) não é corrigível no campo e continua indo para o banner.
 */
export function isInputRejection(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 400 || error.status === 422);
}

/**
 * Diálogo de "concluir manutenção": confirmação + leitura do hodômetro.
 *
 * Não é uma variante do {@link ConfirmDialog} (aquele é só texto) e não reusa o
 * `MarkPaidDialog` (aquele é um seletor de data). O campo é sempre exibido, mesmo
 * quando a manutenção já tem leitura gravada: uma linha agendada costuma carregar
 * uma leitura planejada defasada e o backend rejeita leitura menor que a do veículo.
 */
@Component({
  selector: 'app-conclude-maintenance-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conclude-maintenance-dialog.html',
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
export class ConcludeMaintenanceDialog {
  readonly open = input.required<boolean>();
  /** Linha de contexto (placa · descrição) mostrada sob o título. */
  readonly entityLabel = input<string>('');
  /**
   * Valor sugerido no campo. Chega assíncrono na listagem (o hodômetro do
   * veículo é buscado ao abrir), por isso é adotado enquanto o usuário não digitou.
   */
  readonly defaultValue = input<number | null>(null);
  /** Hodômetro atual do veículo, apenas como dica textual. */
  readonly vehicleHodometer = input<number | null>(null);
  /** A leitura do veículo não pôde ser carregada: a dica passa a pedir o valor. */
  readonly vehicleLookupFailed = input<boolean>(false);
  /**
   * Recusa da leitura pelo backend. Renderizada dentro do diálogo, que continua
   * aberto com o valor digitado — o erro é corrigível aqui mesmo.
   */
  readonly errorMessage = input<string | null>(null);
  readonly busy = input<boolean>(false);

  readonly confirmed = output<number>();
  readonly cancelled = output<void>();

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('hodometerInput');

  protected readonly value = signal<string>('');
  /** Trava a adoção de `defaultValue` assim que o usuário edita o campo. */
  private readonly touched = signal(false);

  protected readonly parsed = computed(() => {
    const raw = this.value().trim();
    if (!raw || !DIGITS_ONLY.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    return n;
  });

  protected readonly invalid = computed(() => this.value().trim() !== '' && this.parsed() === null);
  protected readonly canConfirm = computed(() => !this.busy() && this.parsed() !== null);

  protected readonly hint = computed(() => {
    if (this.vehicleLookupFailed()) {
      return 'Não foi possível obter o hodômetro atual do veículo. Digite a leitura atual.';
    }
    const current = this.vehicleHodometer();
    if (current == null) return 'Informe a leitura do hodômetro no momento do serviço.';
    return `Hodômetro atual do veículo: ${new Intl.NumberFormat('pt-BR').format(current)} km.`;
  });

  /** Ordem de leitura para o screen reader: erro do campo → erro do servidor → dica. */
  protected readonly describedBy = computed(() => {
    const ids = [this.invalid() ? 'conclude-maint-error' : 'conclude-maint-hint'];
    if (this.errorMessage()) ids.push('conclude-maint-server-error');
    return ids.join(' ');
  });

  constructor() {
    // Reabrir sempre parte do valor sugerido; fechar destrava a sugestão para a
    // próxima abertura. Enquanto aberto e intocado, uma sugestão que chega
    // depois (fetch do veículo) substitui a anterior.
    effect(() => {
      if (!this.open()) {
        this.touched.set(false);
        return;
      }
      if (this.touched()) return;
      const suggested = this.defaultValue();
      this.value.set(suggested == null ? '' : String(suggested));
    });

    // O campo é o único conteúdo acionável relevante: leva o foco pra dentro do
    // diálogo (WCAG) e abre o teclado numérico no mobile.
    effect(() => {
      if (!this.open()) return;
      this.inputRef()?.nativeElement.focus();
    });

    // Recusa do backend: o valor digitado continua no campo e o foco volta pra
    // ele, pronto pra correção (o botão de confirmar ficou com o foco perdido).
    effect(() => {
      if (!this.errorMessage()) return;
      this.inputRef()?.nativeElement.focus();
    });
  }

  protected onInput(event: Event): void {
    this.touched.set(true);
    this.value.set((event.target as HTMLInputElement).value);
  }

  protected onConfirm(): void {
    const n = this.parsed();
    if (this.busy() || n === null) return;
    this.confirmed.emit(n);
  }

  protected onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }

  protected onEscape(event: Event): void {
    if (!this.open() || this.busy()) return;
    event.preventDefault();
    this.cancelled.emit();
  }
}
