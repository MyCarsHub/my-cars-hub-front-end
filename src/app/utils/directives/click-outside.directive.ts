import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  output,
} from '@angular/core';

/**
 * Emits `appClickOutside` when the user taps/clicks outside the host element.
 * Bind on the popover/menu container. Listens on `pointerdown` (fires on both
 * mouse and touch) so it plays nice with mobile menus.
 */
@Directive({
  selector: '[appClickOutside]',
})
export class ClickOutsideDirective implements OnInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly appClickOutside = output<Event>();

  private readonly listener = (event: Event) => {
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.appClickOutside.emit(event);
    }
  };

  ngOnInit(): void {
    document.addEventListener('pointerdown', this.listener, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointerdown', this.listener, true);
  }
}
