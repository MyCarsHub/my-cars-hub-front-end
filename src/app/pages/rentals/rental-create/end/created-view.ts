import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { PaintedCard } from '../../../../components/core/painted-card/painted-card';
import { CreatedModel } from '../create-summary';

/**
 * "Aluguel criado" (pranchas FimF6 / FimD3): no lugar da página (o título e a linha do motorista
 * são os da página). O que saiu, o que fazer antes de entregar o carro (os dois abrem o
 * aluguel, como no passo a passo) e os dois botões.
 */
@Component({
  selector: 'app-rc-created',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaintedCard],
  template: `
    <div class="dn" data-testid="create-done">
      <app-painted-card tone="green" class="dn-t hub">
        <span class="dn-k">Tudo certo</span>
        <span class="dn-v" data-testid="done-headline">{{ model().headline }}</span>
        <span class="dn-c" data-testid="done-caption">{{ model().caption }}</span>
      </app-painted-card>
      @if (model().syncFailed > 0) {
        <p class="dn-err text-rose-700 dark:text-rose-300" role="alert" data-testid="done-sync-failed">
          {{ model().syncFailed }} cobrança(s) não saíram agora. Abra o aluguel para ver e tentar de novo.
        </p>
      }
      <div class="dn-l">
        <span class="dn-s">Antes de entregar o carro</span>
        <button type="button" class="dn-r" (click)="open.emit()">
          <span class="dn-tx"><b>Mandar o contrato para assinar</b><span>Ele assina pelo celular.</span></span>
          <span class="dn-ch" aria-hidden="true">›</span>
        </button>
        <button type="button" class="dn-r" (click)="open.emit()">
          <span class="dn-tx"><b>Fazer a vistoria de retirada</b><span>Fotos do carro antes de sair.</span></span>
          <span class="dn-ch" aria-hidden="true">›</span>
        </button>
      </div>
      <div class="dn-act">
        <button type="button" class="dn-btn" data-testid="open-rental" (click)="open.emit()">Ver o aluguel</button>
        <button type="button" class="dn-btn2" data-testid="create-another" (click)="again.emit()">Criar outro aluguel</button>
      </div>
    </div>
  `,
  styles: `
    .dn { display: flex; flex-direction: column; gap: 20px; animation: dn-in 320ms cubic-bezier(0.32, 0.72, 0, 1) both; }
    @keyframes dn-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    /* Verde principal (Hub Green, success-500), pedido do dono: só aqui; o tom verde do painted-card não muda. */
    .hub { background: var(--color-success-500) !important; }
    .dn-t { gap: 4px !important; }
    .dn-k { font-size: 13px; line-height: 20px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .dn-v { font-size: 22px; line-height: 30px; font-weight: 700; }
    .dn-c { font-size: 15px; line-height: 22px; }
    .dn-err { margin: 0; font-size: 15px; line-height: 22px; font-weight: 500; }
    .dn-l { display: flex; flex-direction: column; gap: 8px; }
    .dn-s { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--color-fg-soft); }
    .dn-r {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 14px 16px; border: 0; border-radius: 16px;
      background: var(--color-surface); font: inherit; text-align: left; color: var(--color-fg); cursor: pointer;
    }
    .dn-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .dn-tx b { font-size: 16px; line-height: 24px; font-weight: 600; }
    .dn-tx span { font-size: 14px; line-height: 20px; color: var(--color-fg-subtle); }
    .dn-ch { color: var(--color-fg-muted); font-size: 22px; }
    .dn-act { display: flex; flex-direction: column; gap: 10px; }
    .dn-btn {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; padding: 0 28px; border: 0;
      border-radius: 12px; background: var(--color-primary-500); color: #fff; font: inherit; font-size: 17px; font-weight: 600; cursor: pointer;
    }
    .dn-btn2 {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; border: 0; border-radius: 12px;
      background: transparent; color: var(--color-fg-muted); font: inherit; font-size: 16px; font-weight: 600; cursor: pointer;
    }
    .dn-r:focus-visible, .dn-btn:focus-visible, .dn-btn2:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
    @media (min-width: 1024px) {
      .dn-act { flex-direction: row-reverse; justify-content: flex-end; align-items: center; gap: 12px; }
      .dn-btn, .dn-btn2 { width: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .dn { animation: none; } }
  `,
})
export class CreatedView {
  readonly model = input.required<CreatedModel>();
  readonly open = output<void>();
  readonly again = output<void>();
}
