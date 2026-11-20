import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { MissingRow, missingTitle } from '../create-summary';

/**
 * O fim da página (pranchas FimF1/F2, FimD1): "Criar aluguel" e "Cancelar"; tocar em Criar com
 * algo faltando mostra, acima dos botões, o que falta e um "Ir" para cada card.
 */
@Component({
  selector: 'app-rc-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ca' },
  template: `
    @if (showMissing() && missing().length > 0) {
      <div class="ca-miss" role="alert" tabindex="-1" data-testid="create-missing">
        <h3>{{ title() }}</h3>
        @for (m of missing(); track m.card) {
          <button type="button" class="ca-row" [attr.data-testid]="'missing-' + m.card" (click)="go.emit(m.card)">
            <span class="ca-tx"><b>{{ m.name }}</b><span>{{ m.text }}</span></span>
            <span class="ca-go">Ir</span>
          </button>
        }
      </div>
    }
    @if (stale()) {
      <p class="ca-stale" role="status" data-testid="check-stale">
        Algo mudou enquanto conferíamos. Toque em Criar aluguel de novo.
      </p>
    }
    @if (checkFailed()) {
      <div class="ca-fail" role="alert" data-testid="check-failed">
        <p>Não foi possível conferir as cobranças agora. Nada foi criado.</p>
        <button type="button" class="ca-link" data-testid="retry-check" (click)="create.emit()">Tentar de novo</button>
      </div>
    }
    <div class="ca-act">
      <button type="button" class="ca-btn" data-testid="create-submit" [disabled]="busy()" (click)="create.emit()">
        {{ busy() ? 'Conferindo…' : 'Criar aluguel' }}
      </button>
      <button type="button" class="ca-btn2" data-testid="create-cancel" (click)="cancel.emit()">Cancelar</button>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .ca-miss { background: var(--color-surface); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 8px; outline: none; }
    .ca-miss h3 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 700; color: var(--color-primary-700); }
    :host-context(.dark) .ca-miss h3, :host-context(.dark) .ca-go, :host-context(.dark) .ca-link { color: var(--color-primary-400); }
    .ca-row {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 12px 14px; border: 0;
      border-radius: 12px; background: var(--color-canvas); font: inherit; text-align: left; color: var(--color-fg-body); cursor: pointer;
    }
    .ca-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .ca-tx b { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--color-fg); }
    .ca-tx span { font-size: 14px; line-height: 20px; color: var(--color-fg-subtle); }
    .ca-go, .ca-link { font-size: 15px; font-weight: 600; color: var(--color-primary-700); }
    .ca-stale { margin: 0; font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
    .ca-fail { display: flex; flex-direction: column; gap: 4px; }
    .ca-fail p { margin: 0; font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
    .ca-link { align-self: flex-start; min-height: 44px; padding: 0; border: 0; background: transparent; font-family: inherit; cursor: pointer; }
    .ca-act { display: flex; flex-direction: column; gap: 10px; }
    .ca-btn {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; padding: 0 28px; border: 0;
      border-radius: 12px; background: var(--color-primary-500); color: #fff; font: inherit; font-size: 17px; line-height: 24px;
      font-weight: 600; cursor: pointer; transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .ca-btn:active { transform: scale(0.98); }
    .ca-btn:disabled { opacity: 0.6; cursor: progress; }
    .ca-btn2 {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; border: 0; border-radius: 12px;
      background: transparent; color: var(--color-fg-muted); font: inherit; font-size: 16px; font-weight: 600; cursor: pointer;
    }
    .ca-row:focus-visible, .ca-btn:focus-visible, .ca-btn2:focus-visible, .ca-link:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
    @media (min-width: 1024px) {
      .ca-act { flex-direction: row-reverse; justify-content: flex-start; align-items: center; gap: 12px; }
      .ca-btn, .ca-btn2 { width: auto; padding: 0 28px; }
    }
    @media (prefers-reduced-motion: reduce) { .ca-btn { transition: none; } }
  `,
})
export class CreateActions {
  readonly missing = input<readonly MissingRow[]>([]);
  readonly showMissing = input(false);
  readonly busy = input(false);
  readonly checkFailed = input(false);
  /** O corpo mudou durante a conferência ou com o Confira aberto. */
  readonly stale = input(false);

  readonly create = output<void>();
  readonly cancel = output<void>();
  readonly go = output<number>();

  protected readonly title = computed(() => missingTitle(this.missing().length));
}
