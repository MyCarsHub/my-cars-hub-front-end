import { ChangeDetectionStrategy, Component, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BottomSheet } from '../../../../components/core/bottom-sheet/bottom-sheet';
import { PaintedCard } from '../../../../components/core/painted-card/painted-card';
import { BlockReason } from '../create-server';
import { ConfirmModel } from '../create-summary';

/** Como a folha fechou: voltar a editar, ir a um card ("Mudar"), ou sem escolha (X, Esc, fundo). */
export type SheetExit = { kind: 'back' } | { kind: 'card'; card: number };

const SHARED_STYLES = `
  .sh { display: flex; flex-direction: column; gap: 14px; }
  .sh-act { display: flex; flex-direction: column; gap: 10px; }
  .sh-btn {
    display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; padding: 0 28px; border: 0;
    border-radius: 12px; background: var(--color-primary-500); color: #fff; font: inherit; font-size: 17px; font-weight: 600; cursor: pointer;
  }
  .sh-btn:disabled { opacity: 0.6; cursor: progress; }
  .sh-btn2 {
    display: flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; border: 0; border-radius: 12px;
    background: transparent; color: var(--color-fg-muted); font: inherit; font-size: 16px; font-weight: 600; cursor: pointer;
  }
  .sh-say { margin: 0; font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
  .sh-say b { font-weight: 600; color: var(--color-fg); }
  .sh-lnk { align-self: flex-start; min-height: 44px; padding: 0; border: 0; background: transparent; font: inherit; font-size: 16px; font-weight: 600; color: var(--color-primary-700); cursor: pointer; }
  :host-context(.dark) .sh-lnk, :host-context(.dark) .kv-mu { color: var(--color-primary-400); }
  .sh-btn:focus-visible, .sh-btn2:focus-visible, .sh-lnk:focus-visible, .kv-mu:focus-visible { outline: 2px solid var(--color-primary-400); outline-offset: 2px; }
  @media (min-width: 1024px) {
    .sh-act { flex-direction: row-reverse; justify-content: flex-start; align-items: center; gap: 12px; }
    .sh-btn, .sh-btn2 { width: auto; }
  }
`;

/**
 * "Confira antes de criar" (pranchas FimF3/F4, FimD2): os dois totais, os dados com "Mudar",
 * a lista do SERVIDOR em "Ver as N cobranças", a frase do que acontece ao criar e o botão.
 */
@Component({
  selector: 'app-rc-confirm-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, PaintedCard],
  template: `
    <app-bottom-sheet #sheet title="Confira antes de criar" size="lg" [busy]="saving()" (closed)="closed.emit(exit)">
      <div class="sh" data-testid="confirm-sheet">
        <!-- Sem caução, o cartão verde não aparece e o Aluguel ocupa a largura toda. -->
        <div class="tt" [class.one]="!model().showCaucao">
          <app-painted-card tone="orange" class="tt-c">
            <span class="tt-k">Aluguel</span><span class="tt-v" data-testid="confirm-rent">{{ model().rentTotal }}</span>
            <span class="tt-s">{{ model().rentCaption }}</span>
          </app-painted-card>
          @if (model().showCaucao) {
            <app-painted-card tone="green" class="tt-c hub">
              <span class="tt-k">Caução</span><span class="tt-v" data-testid="confirm-caucao">{{ model().caucaoTotal }}</span>
              <span class="tt-s" data-testid="confirm-caucao-caption">{{ model().caucaoCaption }}</span>
            </app-painted-card>
          }
        </div>
        <div class="kv">
          @for (r of model().rows; track r.label) {
            <div class="kv-r">
              <span class="kv-tx"><span>{{ r.label }}</span><b>{{ r.value }}</b></span>
              <button type="button" class="kv-mu" [attr.aria-label]="'Mudar ' + r.label.toLowerCase()"
                [attr.data-testid]="'confirm-change-' + r.card" [disabled]="saving()" (click)="leave({ kind: 'card', card: r.card })">Mudar</button>
            </div>
          }
        </div>
        <button type="button" class="sh-lnk" [attr.aria-expanded]="listOpen()" data-testid="confirm-lines-toggle"
          (click)="listOpen.set(!listOpen())">
          {{ listOpen() ? 'Esconder as cobranças' : 'Ver as ' + model().count + ' cobranças' }}
        </button>
        @if (listOpen()) {
          <ul class="ln" data-testid="confirm-lines">
            @for (l of model().lines; track l.key) {
              <li><span class="ln-tx"><b>{{ l.title }}</b><span>{{ l.date }}</span></span><span class="ln-v">{{ l.value }}</span></li>
            }
          </ul>
        }
        @if (model().automatic) {
          <p class="sh-say" data-testid="confirm-say">Ao criar, as <b>{{ model().countText }}</b> ({{ model().detail }}) vão para a sua conta Asaas agora.</p>
        } @else {
          <!-- Por fora, o servidor só anota as cobranças quando o aluguel começa (Marcar como ativo). -->
          <p class="sh-say" data-testid="confirm-say">Ao criar, nada é enviado para ele. As {{ model().countText }} ficam anotadas quando o aluguel começar (Marcar como ativo), e você marca cada uma quando receber.</p>
        }
      </div>
      <div sheetFooter class="sh-act">
        <button type="button" class="sh-btn" data-testid="confirm-create" [disabled]="saving()" (click)="create.emit()">
          {{ saving() ? 'Criando…' : model().automatic ? 'Criar aluguel e cobranças' : 'Criar aluguel' }}
        </button>
        <button type="button" class="sh-btn2" data-testid="confirm-back" [disabled]="saving()" (click)="leave({ kind: 'back' })">Voltar e editar</button>
      </div>
    </app-bottom-sheet>
  `,
  styles: `
    ${SHARED_STYLES}
    /* Verde principal (Hub Green, success-500), pedido do dono: só aqui; o tom verde do painted-card não muda. */
    .hub { background: var(--color-success-500) !important; }
    .tt { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tt.one { grid-template-columns: 1fr; }
    .tt-c { gap: 2px !important; padding: 14px !important; }
    .tt-k { font-size: 13px; line-height: 20px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .tt-v { font-size: 22px; line-height: 30px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .tt-s { font-size: 14px; line-height: 20px; }
    .kv { display: flex; flex-direction: column; gap: 8px; }
    .kv-r { display: flex; align-items: center; gap: 12px; background: var(--color-canvas); border-radius: 12px; padding: 12px 14px; }
    .kv-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .kv-tx span { font-size: 13px; line-height: 18px; color: var(--color-fg-subtle); }
    .kv-tx b { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--color-fg); }
    .kv-mu { flex: none; min-height: 44px; padding: 0 4px; border: 0; background: transparent; font: inherit; font-size: 15px; font-weight: 600; color: var(--color-primary-700); cursor: pointer; }
    .ln { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .ln li { display: flex; align-items: center; gap: 12px; min-height: 52px; }
    .ln-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .ln-tx b { font-size: 16px; line-height: 22px; font-weight: 500; color: var(--color-fg); }
    .ln-tx span { font-size: 14px; line-height: 20px; color: var(--color-fg-subtle); }
    .ln-v { flex: none; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
  `,
})
export class ConfirmSheet {
  readonly model = input.required<ConfirmModel>();
  readonly saving = input(false);
  readonly create = output<void>();
  /** Depois da animação de saída. */
  readonly closed = output<SheetExit | null>();

  private readonly sheet = viewChild.required<BottomSheet>('sheet');
  protected readonly listOpen = signal(false);
  protected exit: SheetExit | null = null;

  protected leave(exit: SheetExit): void {
    this.exit = exit;
    this.sheet().requestClose();
  }

  /** Fecha sem escolha (o aluguel foi criado: a página troca pelo "Aluguel criado"). */
  close(): void {
    this.exit = null;
    this.sheet().requestClose(true);
  }
}

/** "Não dá para criar ainda" (prancha FimF5): o motivo em palavras, "Nada foi criado." e só "Voltar e editar". */
@Component({
  selector: 'app-rc-blocked-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, RouterLink],
  template: `
    <app-bottom-sheet #sheet title="Não dá para criar ainda" size="lg" (closed)="closed.emit(exit)">
      <div class="sh" data-testid="blocked-sheet">
        @for (r of reasons(); track r.key) {
          <div class="bad">
            <p>{{ r.text }}</p>
            @if (r.link; as link) {
              <a class="sh-lnk" [routerLink]="link.commands">{{ link.label }}</a>
            }
          </div>
        }
        <p class="sh-say">Nada foi criado.</p>
      </div>
      <div sheetFooter class="sh-act">
        <button type="button" class="sh-btn" data-testid="blocked-back" (click)="back()">Voltar e editar</button>
      </div>
    </app-bottom-sheet>
  `,
  styles: `
    ${SHARED_STYLES}
    .bad { display: flex; flex-direction: column; gap: 4px; background: var(--color-canvas); border-radius: 14px; padding: 14px 16px; }
    .bad p { margin: 0; font-size: 15px; line-height: 22px; color: var(--color-fg-body); }
  `,
})
export class BlockedSheet {
  readonly reasons = input.required<readonly BlockReason[]>();
  readonly closed = output<SheetExit | null>();

  private readonly sheet = viewChild.required<BottomSheet>('sheet');
  protected exit: SheetExit | null = null;

  /** Volta ao card do primeiro motivo que tem card; senão, só fecha. */
  protected back(): void {
    const card = this.reasons().find((r) => r.card !== null)?.card ?? null;
    this.exit = card !== null ? { kind: 'card', card } : { kind: 'back' };
    this.sheet().requestClose();
  }
}
