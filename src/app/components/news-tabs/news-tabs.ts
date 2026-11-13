import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../services/session.service';

/** Papéis que leem Novidades — os mesmos do `roleGuard` da rota `/novidades`. */
const NEWS_ROLES: readonly string[] = ['OWNER', 'MANAGER', 'DRIVER'];

/**
 * Abas **Novidades | Roadmap** no topo das duas páginas (menu novo, prancha 4): o Roadmap
 * deixou de ser item do menu e virou a aba ao lado de Novidades. Cada aba é um LINK para a
 * URL de sempre (`/novidades`, `/roadmap`), então favoritos e o voltar do navegador seguem
 * funcionando; a aba atual leva `aria-current="page"`.
 *
 * Quem não lê Novidades (sessão sem papel de empresa) não vê as abas: para ele o Roadmap
 * continua sendo uma página sozinha.
 */
@Component({
  selector: 'app-news-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'block' },
  template: `
    @if (visible()) {
      <nav
        aria-label="Novidades e Roadmap"
        class="grid w-full max-w-sm grid-cols-2 rounded-xl bg-surface-sunken p-[3px]"
        data-news-tabs
      >
        <a
          routerLink="/novidades"
          [attr.aria-current]="active() === 'novidades' ? 'page' : null"
          [class]="tabClass('novidades')"
        >
          Novidades
        </a>
        <a
          routerLink="/roadmap"
          [attr.aria-current]="active() === 'roadmap' ? 'page' : null"
          [class]="tabClass('roadmap')"
        >
          Roadmap
        </a>
      </nav>
    }
  `,
})
export class NewsTabs {
  readonly active = input.required<'novidades' | 'roadmap'>();

  private readonly session = inject(SessionService);

  protected readonly visible = computed(() => {
    const role = this.session.getCompanyRoleFromToken();
    return !!role && NEWS_ROLES.includes(role);
  });

  protected tabClass(tab: 'novidades' | 'roadmap'): string {
    const base =
      'flex min-h-11 items-center justify-center rounded-[9px] text-[15px] font-semibold ' +
      'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ' +
      'focus-visible:ring-primary-400 motion-reduce:transition-none';
    return this.active() === tab
      ? `${base} bg-primary-500 text-white`
      : `${base} text-fg-muted hover:text-fg`;
  }
}
