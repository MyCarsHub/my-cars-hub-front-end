import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { VehicleRoiItem } from '../../../types/reports.types';
import { formatBRL } from '../../../types/dashboard.types';

/**
 * ROI por veículo (FEAT-0103) — para cada carro: quanto já voltou, quanto já
 * custou, se já se pagou e quanto falta.
 *
 * O QUE FICA NO CARTÃO FECHADO, e por quê: são 13 campos por veículo numa lista
 * de N veículos, e num celular despejar tudo não é informar, é esconder. O
 * fechado responde as quatro perguntas do dono — retornou, custou, se pagou,
 * quanto falta — e mais nada. As cinco pontas de CUSTO (aquisição, manutenção,
 * seguro, multa, sinistro) vão para o detalhe: elas explicam um número que o
 * dono só quer abrir depois de decidir que aquele carro merece investigação.
 *
 * A separação aluguel/venda é a EXCEÇÃO que fica no fechado, porque ela muda a
 * leitura do próprio total: o carro que se pagou alugando e o que só se pagou
 * porque foi vendido pedem decisões opostas. Ela aparece quando `saleCents > 0`;
 * sem venda, todo o retorno é aluguel e repetir isso seria ruído.
 *
 * Os três casos que separam um card certo de um card que mente:
 *  1. `roiPercent`/`paybackMonth` nulos (custo zero) = INDETERMINADO. Em vez de
 *     "0%" ou "—", a linha diz que falta o preço de compra e leva à tela onde
 *     ele se cadastra — é a única saída acionável. E o CABEÇALHO segue a mesma
 *     regra: sem custo conhecido não se afirma lucro nem prejuízo, porque lucro
 *     é uma afirmação sobre retorno MENOS custo. O valor continua na tela (ele é
 *     um fato medido), mas rotulado como "retorno acumulado", em tom neutro — o
 *     julgamento é que sai. Suprimir o ROI e manter o "+R$ X · no lucro" em
 *     verde seria o mesmo cartão afirmando lucro e confessando ignorância três
 *     linhas abaixo, e errando para o lado otimista, que num produto de dinheiro
 *     é o pior dos dois lados.
 *  2. `netCents` negativo ganha cor, rótulo ("no prejuízo") e sinal, não só o
 *     menos: no celular o menos some na leitura rápida.
 *  3. `remainingToPaybackCents` é a informação mais útil da tela e por isso
 *     nunca fica atrás do expandir.
 */
@Component({
  selector: 'app-vehicle-roi-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (items().length === 0) {
      <p class="text-sm text-neutral-500 text-center py-6">
        Nenhum veículo para calcular retorno ainda.
      </p>
    } @else {
      <ul class="space-y-3" role="list">
        @for (v of rows(); track v.item.vehicleId) {
          <li
            class="rounded-xl border bg-white p-4 space-y-3"
            [class.border-neutral-200]="v.tone !== 'negative'"
            [class.border-rose-200]="v.tone === 'negative'"
          >
            <!-- Identificação -->
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-neutral-900 tabular-nums">
                  {{ v.item.plate }}
                </p>
                <p class="text-xs text-neutral-500 truncate">
                  {{ v.item.brand }} {{ v.item.model }}
                </p>
              </div>

              <!--
                Caso 2: prejuízo tem cor e rótulo, não só um sinal de menos.
                Caso 1: custo desconhecido não recebe cor NENHUMA — nem emerald
                nem rose, porque "no prejuízo" também seria uma afirmação.
              -->
              <div class="shrink-0 text-right">
                <p
                  class="text-sm font-semibold tabular-nums"
                  [class.text-emerald-700]="v.tone === 'positive'"
                  [class.text-rose-700]="v.tone === 'negative'"
                  [class.text-neutral-900]="v.tone === 'neutral'"
                >
                  {{ v.headline }}
                </p>
                <p
                  class="text-[11px] font-medium"
                  [class.text-emerald-700]="v.tone === 'positive'"
                  [class.text-rose-700]="v.tone === 'negative'"
                  [class.text-neutral-500]="v.tone === 'neutral'"
                >
                  {{ v.caption }}
                </p>
              </div>
            </div>

            <!-- Retornou x custou -->
            <div class="grid grid-cols-2 gap-2">
              <div class="min-w-0">
                <span class="text-neutral-500 uppercase tracking-wide text-[10px]">
                  Já voltou
                </span>
                <p class="text-sm font-semibold text-neutral-900 tabular-nums">
                  {{ v.returned }}
                </p>
                @if (v.showSplit) {
                  <p class="text-[11px] text-neutral-500 tabular-nums">
                    aluguel {{ v.rental }} · venda {{ v.sale }}
                  </p>
                }
              </div>
              <div class="min-w-0">
                <span class="text-neutral-500 uppercase tracking-wide text-[10px]">
                  Já custou
                </span>
                <p class="text-sm font-semibold text-neutral-900 tabular-nums">
                  {{ v.cost }}
                </p>
              </div>
            </div>

            <!-- Payback: o dado mais útil da tela, nunca atrás do expandir -->
            @if (v.indeterminate) {
              <!-- Caso 1: custo zero. Acionável em vez de "—". -->
              <div class="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                <p class="text-xs text-amber-900">
                  Sem o preço de compra não dá para dizer se este carro já se pagou.
                </p>
                <a
                  [routerLink]="['/veiculos', v.item.vehicleId, 'editar']"
                  class="inline-flex items-center min-h-[44px] text-xs font-semibold
                         text-amber-900 underline hover:no-underline outline-none
                         focus-visible:ring-2 focus-visible:ring-amber-500 rounded-sm"
                >
                  Informar preço de compra
                </a>
              </div>
            } @else if (v.item.paybackReached) {
              <p class="text-xs font-medium text-emerald-700">
                Já se pagou{{ v.paybackWhen }}
              </p>
            } @else {
              <p class="text-xs font-medium text-neutral-700">
                Falta
                <span class="font-semibold tabular-nums text-neutral-900">{{ v.remaining }}</span>
                para se pagar
              </p>
            }

            <!-- Detalhe: as cinco pontas de custo -->
            <button
              type="button"
              class="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs
                     font-medium text-neutral-600 hover:text-neutral-900 outline-none
                     focus-visible:ring-2 focus-visible:ring-primary-400 rounded-lg px-1"
              [attr.aria-expanded]="isOpen(v.item.vehicleId)"
              [attr.aria-label]="
                (isOpen(v.item.vehicleId) ? 'Ocultar' : 'Ver') + ' composição de ' + v.item.plate
              "
              (click)="toggle(v.item.vehicleId)"
            >
              <span>Composição do custo</span>
              <span aria-hidden="true">{{ isOpen(v.item.vehicleId) ? '−' : '+' }}</span>
            </button>

            @if (isOpen(v.item.vehicleId)) {
              <dl class="text-xs text-neutral-600 space-y-1 border-t border-neutral-100 pt-2">
                @for (line of v.costLines; track line.label) {
                  <div class="flex items-baseline justify-between gap-3">
                    <dt class="text-neutral-500">{{ line.label }}</dt>
                    <dd class="tabular-nums text-neutral-900">{{ line.value }}</dd>
                  </div>
                }
              </dl>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class VehicleRoiList {
  readonly items = input.required<readonly VehicleRoiItem[]>();

  /** Ids com a composição de custo aberta. */
  private readonly open = signal<ReadonlySet<string>>(new Set());

  /**
   * Tudo que o template exibe sai pronto daqui — formatar dentro do template
   * significaria reformatar 13 campos por veículo a cada detecção de mudança.
   */
  protected readonly rows = computed(() =>
    this.items().map((item) => {
      const indeterminate = item.costCents === 0;
      // Sem custo conhecido não há julgamento a emitir: o tom é neutro e o
      // número deixa de ser "lucro" para ser o que ele comprovadamente é.
      const tone: 'positive' | 'negative' | 'neutral' = indeterminate
        ? 'neutral'
        : item.netCents < 0
          ? 'negative'
          : 'positive';
      const roi =
        indeterminate || item.roiPercent === null ? '' : ` · ${this.percent(item.roiPercent)}`;
      return {
        item,
        indeterminate,
        tone,
        headline: indeterminate
          ? formatBRL(item.returnedCents)
          : this.signed(item.netCents),
        caption: indeterminate
          ? 'retorno acumulado'
          : `${item.netCents < 0 ? 'no prejuízo' : 'no lucro'}${roi}`,
        returned: formatBRL(item.returnedCents),
        cost: formatBRL(item.costCents),
        remaining: formatBRL(item.remainingToPaybackCents),
        rental: formatBRL(item.returnBreakdown.rentalCents),
        sale: formatBRL(item.returnBreakdown.saleCents),
        // Sem venda o total JA e o aluguel: repetir viraria ruido no celular.
        showSplit: item.returnBreakdown.saleCents > 0,
        paybackWhen: item.paybackMonth ? ` em ${this.month(item.paybackMonth)}` : '',
        costLines: [
          { label: 'Compra', value: formatBRL(item.costBreakdown.acquisitionCents) },
          { label: 'Manutenção', value: formatBRL(item.costBreakdown.maintenanceCents) },
          { label: 'Seguro', value: formatBRL(item.costBreakdown.insuranceCents) },
          { label: 'Multas', value: formatBRL(item.costBreakdown.fineCents) },
          { label: 'Sinistros', value: formatBRL(item.costBreakdown.incidentCents) },
        ],
      };
    }),
  );

  protected isOpen(id: string): boolean {
    return this.open().has(id);
  }

  protected toggle(id: string): void {
    this.open.update((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** `formatBRL` já emite o "-"; o "+" é explícito para o lucro não ficar mudo. */
  private signed(cents: number): string {
    const formatted = formatBRL(cents);
    return cents > 0 ? `+${formatted}` : formatted;
  }

  private percent(value: number): string {
    return `${value.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })}%`;
  }

  /** "2026-03" → "mar/2026". Sem `new Date`: o mês não tem dia nem fuso. */
  private month(iso: string): string {
    const [year, month] = iso.split('-');
    const names = [
      'jan',
      'fev',
      'mar',
      'abr',
      'mai',
      'jun',
      'jul',
      'ago',
      'set',
      'out',
      'nov',
      'dez',
    ];
    const name = names[Number(month) - 1];
    return name ? `${name}/${year}` : iso;
  }
}
