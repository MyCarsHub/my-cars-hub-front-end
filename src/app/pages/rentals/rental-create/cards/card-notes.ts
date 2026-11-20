import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterRenderEffect,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { InfoTip } from '../../../../components/info-tip/info-tip';
import { NOTES_MAX, notesCounter } from './terms-rules';

/** Altura máxima do campo: daí para cima ele rola por dentro. */
const NOTES_MAX_HEIGHT = 240;

/**
 * Card 8 · Observações (pranchas ObsO1–O3 / ObsD1). Texto livre, só da equipe, com contador.
 * O campo cresce com o texto até `NOTES_MAX_HEIGHT` e depois rola por dentro. O estado é da
 * página (`RentalCreate`): aqui só se mostra e se avisa.
 */
@Component({
  selector: 'app-rc-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InfoTip],
  host: { class: 'rc-cb' },
  // Folha compartilhada pelos cards 5 a 8, sem encapsulamento (classes rt-*).
  styleUrl: './card-terms.css',
  encapsulation: ViewEncapsulation.None,
  styles: `
    .rt-ta {
      display: block; width: 100%; min-height: 120px; max-height: 240px; resize: none; overflow-y: hidden; margin: 0;
      padding: 12px 16px; border-radius: 12px; border: 1px solid var(--color-edge-field);
      background: var(--color-surface); color: var(--color-fg-body);
      font: inherit; font-size: 16px; line-height: 24px;
    }
    .rt-ta.cap { overflow-y: auto; overscroll-behavior: contain; }
    .rt-ta::placeholder { color: var(--color-fg-faint); }
    .rt-ta:focus-visible { outline: none; border-color: var(--color-primary-600); box-shadow: 0 0 0 1px var(--color-primary-600); }
    .rt-cnt { display: flex; justify-content: space-between; gap: 12px; margin-top: 6px; font-size: 14px; line-height: 20px; color: var(--color-fg-subtle); }
    .rt-cnt .n { flex: none; font-variant-numeric: tabular-nums; }
    .rt-cnt.w { color: var(--color-primary-700); font-weight: 600; }
    .dark .rt-cnt.w { color: var(--color-primary-400); }
  `,
  template: `
    <div class="rt-fld">
      <div class="rt-lbi">
        <label class="rt-lb" for="rt-notes">Observações</label>
        <app-info-tip #tNotes label="O que é observações" controls="rt-tip-notes" />
      </div>
      <p class="rt-tip" id="rt-tip-notes" role="note" [hidden]="!tNotes.expanded()">
        Só você e sua equipe veem. O motorista não vê.
      </p>
      <textarea
        #box
        id="rt-notes"
        class="rt-ta"
        rows="4"
        data-testid="notes"
        placeholder="Ex.: combinado de entrega, estado do carro, recado para a equipe"
        aria-describedby="rt-notes-cnt"
        [attr.maxlength]="max"
        [class.cap]="capped()"
        [value]="value()"
        (input)="onInput($event)"
      ></textarea>
      <p class="rt-cnt" id="rt-notes-cnt" [class.w]="counter().warn" data-testid="notes-counter">
        <span aria-live="polite">{{ counter().note }}</span>
        <span class="n">{{ counter().text }}</span>
      </p>
    </div>
  `,
})
export class CardNotes {
  /** O valor de agora de `notes`. */
  readonly value = input('');
  readonly valueChange = output<string>();

  protected readonly max = NOTES_MAX;
  protected readonly counter = computed(() => notesCounter(this.value()));
  /** Chegou na altura máxima: rola por dentro. */
  protected readonly capped = signal(false);

  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');

  constructor() {
    // Cresce com o texto (também quando o rascunho volta preenchido), até a altura máxima.
    afterRenderEffect(() => {
      this.value();
      this.fit();
    });
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value.slice(0, NOTES_MAX);
    this.fit();
    this.valueChange.emit(text);
  }

  private fit(): void {
    const el = this.box().nativeElement;
    el.style.height = 'auto';
    const h = Math.min(el.scrollHeight + 2, NOTES_MAX_HEIGHT);
    el.style.height = `${h}px`;
    this.capped.set(el.scrollHeight + 2 > NOTES_MAX_HEIGHT);
  }
}
