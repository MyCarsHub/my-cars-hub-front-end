import { Directive, ElementRef, inject } from '@angular/core';
import { resolveRovingKey } from '../../components/roving-focus/roving-focus';

/**
 * Arrow keys for a `radiogroup` / `tablist` of buttons (WAI-ARIA radio and tabs patterns):
 * ←/→/↑/↓, Home and End move to the sibling and select it. The group stays ONE Tab stop —
 * the template gives `tabindex="0"` only to the checked item (or the first, when none is).
 */
@Directive({
  selector: '[appArrowSelect]',
  host: { '(keydown)': 'onKeydown($event)' },
})
export class ArrowSelect {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') return;
    const items = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[role="radio"], [role="tab"]'),
    );
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    const action = resolveRovingKey(event.key, current, items.length);
    if (action?.kind !== 'move') return;
    event.preventDefault();
    const next = items[action.index];
    next.focus();
    next.click();
  }
}
