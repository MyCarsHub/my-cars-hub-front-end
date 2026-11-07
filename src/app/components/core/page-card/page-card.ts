import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { SessionService } from '../../../services/session.service';

/**
 * Card wrapper com header + slots (`[cardIcon]`, `[cardActions]`) e conteúdo.
 *
 * ## Modo colapsável (opt-in)
 *
 * Passe `[collapsible]="true"` para renderizar um chevron toggle no header.
 * O chevron é só ícone (sem texto), acessível via keyboard, com `aria-expanded`
 * e `aria-controls`. O estado inicial é `defaultOpen` (default `true`), e
 * pode ser persistido em sessionStorage passando `storageKey`.
 *
 * @example
 * ```html
 * <app-page-card
 *   title="Cronograma"
 *   [collapsible]="true"
 *   [defaultOpen]="true"
 *   storageKey="rental-detail:schedule"
 * >
 *   <div>Conteúdo</div>
 * </app-page-card>
 * ```
 */
@Component({
  selector: 'app-page-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-card.html',
  host: { class: 'block', '[class.h-full]': 'fill()' },
})
export class PageCard {
  private readonly session = inject(SessionService);
  private static instanceCounter = 0;

  title = input.required<string>();
  collapsible = input(false);
  defaultOpen = input(true);
  storageKey = input<string | null>(null);
  /** Fill the height the parent grid gives (side-by-side cards of equal height, no hole). */
  fill = input(false);
  /**
   * One-line title with an ellipsis (full text in the tooltip). Cards that sit side by side
   * use it so a long title never makes one header taller than its neighbours.
   */
  truncateTitle = input(false);
  /**
   * Reserve two title lines from md up and let the title wrap (no ellipsis): cards that sit side
   * by side keep the same header height and their bodies start on the same line, even when one
   * title needs a second line.
   */
  reserveTitleLines = input(false);
  readonly toggled = output<boolean>();

  /** ID único para o `aria-controls` do chevron. */
  protected readonly contentId = `page-card-content-${++PageCard.instanceCounter}`;

  private readonly _open = signal(true);
  protected readonly open = computed(() => (this.collapsible() ? this._open() : true));

  constructor() {
    // Sincroniza estado inicial com defaultOpen + sessionStorage quando inputs chegam.
    effect(() => {
      const key = this.storageKey();
      const def = this.defaultOpen();
      if (key) {
        const raw = this.session.getItem(key);
        if (raw === 'true' || raw === 'false') {
          this._open.set(raw === 'true');
          return;
        }
      }
      this._open.set(def);
    });
  }

  protected toggle(): void {
    const next = !this._open();
    this._open.set(next);
    const key = this.storageKey();
    if (key) this.session.setItem(key, String(next));
    this.toggled.emit(next);
  }
}
