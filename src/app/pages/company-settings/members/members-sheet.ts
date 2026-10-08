import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextSheetId = 0;

/**
 * Bottom sheet below `sm`, centred card above it — the shell of the actions sheet and of
 * the invite flow on the Members page.
 *
 * Same focus contract as `DetailDialog` (the app's reference dialog): Tab/Shift+Tab stay
 * inside the panel, Escape closes, focus returns to whatever opened it, and the body does
 * not scroll behind it. It is local to this page because `DetailDialog` carries a fixed
 * "Fechar" footer and no back button, which the invite steps need.
 */
@Component({
  selector: 'app-members-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        (click)="closed.emit()"
        aria-hidden="true"
      ></div>
      <div
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        (keydown)="onKeydown($event)"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none"
      >
        <div
          #panel
          tabindex="-1"
          class="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-neutral-100 w-full
                 sm:max-w-md max-h-[calc(100dvh-1.5rem)] flex flex-col pointer-events-auto
                 overflow-hidden focus:outline-none"
        >
          <div class="flex items-start gap-2 p-4 pb-3">
            @if (showBack()) {
              <button
                type="button"
                aria-label="Voltar"
                (click)="back.emit()"
                class="w-11 h-11 -ml-2 shrink-0 inline-flex items-center justify-center rounded-lg
                       text-neutral-500 hover:bg-neutral-100 focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
            }
            <div class="flex-1 min-w-0" [class.pt-2]="showBack()">
              <h2 [id]="titleId" class="text-lg font-bold text-neutral-900 leading-snug">
                {{ title() }}
              </h2>
              @if (subtitle()) {
                <p class="mt-0.5 text-sm text-neutral-600">{{ subtitle() }}</p>
              }
            </div>
            <button
              type="button"
              aria-label="Fechar"
              (click)="closed.emit()"
              class="shrink-0 min-h-[44px] min-w-[44px] -mr-2 -mt-1 inline-flex items-center
                     justify-center rounded-xl text-neutral-500 hover:bg-neutral-50
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400
                     focus-visible:ring-offset-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <ng-content />
          </div>
          <ng-content select="[sheetFooter]" />
        </div>
      </div>
    }
  `,
})
export class MembersSheet {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly open = input.required<boolean>();
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly showBack = input(false);

  /** Backdrop, close button and Escape. */
  readonly closed = output<void>();
  readonly back = output<void>();

  protected readonly titleId = `members-sheet-title-${++nextSheetId}`;
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  private previouslyFocused: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;

  constructor() {
    effect(() => {
      const isOpen = this.open();
      const panel = this.panelRef();
      if (!isOpen) {
        this.teardown();
        return;
      }
      if (panel) this.setup(panel.nativeElement);
    });
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const index = items.indexOf(this.document.activeElement as HTMLElement);
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
      }
      return;
    }
    if (index === items.length - 1) {
      event.preventDefault();
      items[0].focus({ preventScroll: true });
    }
  }

  private setup(panel: HTMLElement): void {
    if (this.previouslyFocused === null) {
      const active = this.document.activeElement;
      this.previouslyFocused = active instanceof HTMLElement ? active : null;
    }
    if (this.isBrowser && this.previousBodyOverflow === null) {
      this.previousBodyOverflow = this.document.body.style.overflow;
      this.document.body.style.overflow = 'hidden';
    }
    // The panel, not the first button: the screen reader announces the title first.
    panel.focus({ preventScroll: true });
  }

  private teardown(): void {
    if (this.previousBodyOverflow !== null) {
      this.document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  private focusables(): HTMLElement[] {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }
}
