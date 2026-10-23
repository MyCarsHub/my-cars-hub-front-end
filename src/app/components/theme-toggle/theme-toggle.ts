import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';

/**
 * Botão de tema ao lado do sino, em toda tela autenticada (dono, gerente e motorista).
 *
 * Um toque troca claro ↔ escuro (`ThemeService.toggle`). O Automático continua no cartão
 * "Aparência" do Perfil — ver o porquê em `toggle()`.
 *
 * Mesma caixa do sino (44×44, superfície, sombra, borda) para os dois lerem como um par.
 * O ícone é o tema ATUAL (sol no claro, lua no escuro) e se transforma girando; o rótulo
 * acessível diz o tema atual e o que o toque faz. Animação desligada com
 * `prefers-reduced-motion` (aqui e na troca de cores do app).
 */
@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .icon {
      position: absolute;
      inset: 0;
      margin: auto;
      transition:
        transform 300ms cubic-bezier(0.16, 1, 0.3, 1),
        opacity 200ms ease-out;
    }
    .icon[data-on='false'] {
      opacity: 0;
      transform: rotate(-90deg) scale(0.5);
    }
    .icon[data-on='true'] {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }
    @media (prefers-reduced-motion: reduce) {
      .icon {
        transition: none;
      }
    }
  `,
  template: `
    <button
      type="button"
      data-theme-toggle
      [attr.data-theme]="dark() ? 'dark' : 'light'"
      [attr.aria-label]="label()"
      [attr.title]="label()"
      (click)="theme.toggle()"
      class="relative flex items-center justify-center w-11 h-11 rounded-lg bg-surface shadow-md border border-gray-200 dark:border-edge text-gray-700 dark:text-fg-soft hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <!-- Sol: tema claro ativo. -->
      <svg
        class="icon"
        [attr.data-on]="!dark()"
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      <!-- Lua: tema escuro ativo. -->
      <svg
        class="icon"
        [attr.data-on]="dark()"
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </button>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly dark = computed(() => this.theme.resolved() === 'dark');
  protected readonly label = computed(() =>
    this.dark() ? 'Tema escuro ativo. Mudar para o tema claro' : 'Tema claro ativo. Mudar para o tema escuro',
  );
}
