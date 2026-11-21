import { ChangeDetectionStrategy, Component, input, output, viewChild } from '@angular/core';

import { BottomSheet } from '../../../../components/core/bottom-sheet/bottom-sheet';
import { PaintedCard, PaintedTone } from '../../../../components/core/painted-card/painted-card';

export interface PreviewRow {
  key: string;
  /** "24/11" */
  day: string;
  /** "terça" */
  weekday: string;
  title: string;
  sub: string | null;
  amount: string;
  /** "− R$ 100,00" embaixo do valor, em verde. */
  discount: string | null;
}

export interface PreviewModel {
  tone: PaintedTone;
  label: string;
  total: string;
  caption: string;
  rows: PreviewRow[];
  /** Vazio = sem nota (RenCobK5). */
  note: string;
}

/**
 * Prévia de um card (pranchas CauC5/CauD4 e CobK4/CobD4): folha de baixo no celular, janela
 * no centro no computador (`app-bottom-sheet`). Total pintado, uma linha por cobrança, a nota e
 * "Entendi". A conta é a local (na hora); a do servidor fica para o fim da página.
 */
@Component({
  selector: 'app-rc-preview-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, PaintedCard],
  template: `
    <app-bottom-sheet #sheet [title]="title()" size="lg" (closed)="closed.emit()">
      <div class="pv-body" [attr.data-testid]="testId()">
        <app-painted-card [tone]="model().tone" class="pv-tot" [class.hub]="model().tone === 'green'">
          <span class="pv-k">{{ model().label }}</span>
          <span class="pv-v">{{ model().total }}</span>
          <span class="pv-c">{{ model().caption }}</span>
        </app-painted-card>
        <ul class="pv-rows">
          @for (r of model().rows; track r.key) {
            <li class="pv-rw">
              <span class="pv-dt"><b>{{ r.day }}</b><span>{{ r.weekday }}</span></span>
              <span class="pv-ds">{{ r.title }}
                @if (r.sub) {
                  <span>{{ r.sub }}</span>
                }
              </span>
              <span class="pv-am">{{ r.amount }}
                @if (r.discount) {
                  <span class="pv-gd">{{ r.discount }}</span>
                }
              </span>
            </li>
          }
        </ul>
        @if (model().note) {
          <p class="pv-note">{{ model().note }}</p>
        }
      </div>
      <div sheetFooter class="pv-ft">
        <button type="button" class="pv-ok" (click)="close()">Entendi</button>
      </div>
    </app-bottom-sheet>
  `,
  styles: `
    /* Verde principal (Hub Green, success-500), pedido do dono: só aqui; o tom verde do painted-card não muda. */
    .hub { background: var(--color-success-500) !important; }
    .pv-body { display: flex; flex-direction: column; gap: 16px; }
    .pv-tot { gap: 4px !important; padding: 16px !important; }
    .pv-k { font-size: 13px; line-height: 20px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .pv-v { font-size: 30px; line-height: 38px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pv-c { font-size: 15px; line-height: 22px; }
    .pv-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pv-rw { display: flex; align-items: center; gap: 14px; background: var(--color-canvas); border-radius: 14px; padding: 12px 14px; }
    .pv-dt { flex: none; width: 56px; display: flex; flex-direction: column; }
    .pv-dt b { font-size: 18px; line-height: 24px; font-weight: 700; color: var(--color-fg); font-variant-numeric: tabular-nums; }
    .pv-dt span, .pv-ds span { font-size: 13px; line-height: 18px; color: var(--color-fg-subtle); }
    .pv-ds { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
    .pv-am { flex: none; display: flex; flex-direction: column; align-items: flex-end; font-size: 17px; line-height: 24px; font-weight: 700; color: var(--color-fg); font-variant-numeric: tabular-nums; }
    .pv-gd { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--color-success-800); }
    :host-context(.dark) .pv-gd { color: var(--color-success-500); }
    .pv-note { margin: 0; font-size: 14px; line-height: 20px; color: var(--color-fg-subtle); }
    .pv-ft { display: flex; justify-content: flex-end; }
    .pv-ok {
      width: 100%; min-height: 52px; padding: 0 28px; border: 0; border-radius: 12px; cursor: pointer;
      background: var(--color-primary-500); color: #fff; font: inherit; font-size: 16px; font-weight: 600;
    }
    .pv-ok:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
    @media (min-width: 1024px) { .pv-ok { width: auto; } }
  `,
})
export class PreviewSheet {
  readonly title = input.required<string>();
  readonly model = input.required<PreviewModel>();
  readonly testId = input('');
  readonly closed = output<void>();

  private readonly sheet = viewChild.required<BottomSheet>('sheet');

  protected close(): void {
    this.sheet().requestClose();
  }
}
