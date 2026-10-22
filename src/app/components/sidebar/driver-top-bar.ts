import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LayoutStore } from '../core/layouts/layout.store';

/**
 * Barra de topo do MOTORISTA abaixo de `lg` (protótipo do dono): 56px, fundo branco, borda
 * inferior e só o ☰. O logo NÃO entra aqui (pedido do dono): ele mora no cabeçalho do
 * sidebar/drawer, e repeti-lo na barra o mostrava duas vezes com o menu aberto. Fica NO FLUXO, acima do conteúdo — não flutua sobre o título como o
 * botão ☰ do menu do dono. Quem a monta é o shell (`AppShell`, e a demo), só quando
 * `LayoutStore.driverTopBar()` é verdadeiro; o `Sidebar` então não desenha o ☰ flutuante.
 */
@Component({
  selector: 'app-driver-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block shrink-0' },
  template: `
    <header
      class="flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b
             border-neutral-200 bg-white px-2 pt-[env(safe-area-inset-top)]"
      data-driver-top-bar
    >
      <button
        type="button"
        (click)="layout.openMobile()"
        [attr.aria-expanded]="layout.isMobileOpen()"
        aria-label="Abrir menu"
        class="flex h-11 w-11 items-center justify-center rounded-xl text-neutral-800
               hover:bg-neutral-100 focus:outline-none focus-visible:ring-2
               focus-visible:ring-primary-500"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </header>
  `,
})
export class DriverTopBar {
  protected readonly layout = inject(LayoutStore);
}
