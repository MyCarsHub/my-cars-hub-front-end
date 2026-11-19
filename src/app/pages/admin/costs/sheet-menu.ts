import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';

let nextId = 0;

/**
 * O ⋮ de dentro de uma folha. O `app-actions-menu` usa `position: fixed`, e a folha anima com
 * `transform`: lá dentro o painel ficaria preso e cortado pela folha. Aqui o menu abre NO FLUXO,
 * logo abaixo do botão, empurrando o formulário (altura e opacidade, curva de mola).
 *
 * Itens com `dataListMenuItem` (44px, sem linhas entre eles); acionar um item fecha o menu.
 */
@Component({
  selector: 'app-sheet-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '(keydown.escape)': 'onEscape($event)' },
  styles: `
    .panel {
      animation: sm-open 260ms cubic-bezier(0.32, 0.72, 0, 1) both;
      transform-origin: top right;
    }
    @keyframes sm-open {
      from { opacity: 0; transform: translateY(-4px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { animation: none; }
    }
  `,
  template: `
    <div class="flex items-center justify-between gap-3 min-w-0">
      <div class="min-w-0 flex flex-wrap gap-1.5"><ng-content select="[sheetMenuLead]" /></div>
      <button
        #trigger
        type="button"
        class="press inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg-subtle
               hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        [attr.aria-label]="label()"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? menuId : null"
        data-testid="sheet-menu"
        (click)="toggle()"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
    </div>
    @if (open()) {
      <div
        [id]="menuId"
        role="menu"
        [attr.aria-label]="label()"
        class="panel mt-2 flex flex-col overflow-hidden rounded-2xl bg-surface-muted py-1 [&>*]:shrink-0"
        (click)="onMenuClick($event)"
      >
        <ng-content />
      </div>
    }
  `,
})
export class SheetMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly label = input('Mais opções');

  protected readonly menuId = `sheet-menu-${++nextId}`;
  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) {
      queueMicrotask(() =>
        this.host.nativeElement.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus(),
      );
    }
  }

  protected onMenuClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[role="menuitem"]')) this.open.set(false);
  }

  /** Esc fecha só o menu, não a folha inteira. */
  protected onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
    this.host.nativeElement.querySelector<HTMLElement>('[data-testid="sheet-menu"]')?.focus();
  }
}
