import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { LayoutStore, SwitcherEntry } from '../core/layouts/layout.store';

/**
 * Body of 'Suas empresas': ACTIVE memberships (current one checked), memberships still in
 * onboarding ('Concluir cadastro') and the invites waiting for the person.
 *
 * Presentation only. It lives inside the sidebar on desktop and inside the bottom sheet on
 * phones; the choice of container is the sidebar's. Which row is 'current' comes from
 * `LayoutStore.currentCompanyId` (the session), never from the order of the list.
 */
@Component({
  selector: 'app-company-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-2 pb-3">
      <ul class="space-y-1" role="listbox" aria-label="Suas empresas">
        @for (entry of layout.switcherEntries(); track entry.id) {
          @if (entry.status === 'ACTIVE') {
            <li role="presentation">
              <button
                type="button"
                role="option"
                data-testid="switcher-active"
                [attr.aria-selected]="isCurrent(entry)"
                [attr.aria-busy]="layout.switchingTenantId() === entry.id ? 'true' : null"
                [disabled]="layout.switchingTenantId() !== null"
                (click)="select(entry)"
                class="w-full min-h-12 flex items-center gap-3 px-3 py-2 rounded-xl text-left
                       transition-colors hover:bg-gray-100 disabled:opacity-60 disabled:cursor-wait
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                [class.bg-primary-500/10]="isCurrent(entry)"
              >
                <span
                  class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold"
                  [class.bg-primary-500]="isCurrent(entry)"
                  [class.text-white]="isCurrent(entry)"
                  [class.bg-gray-200]="!isCurrent(entry)"
                  [class.text-gray-700]="!isCurrent(entry)"
                  >{{ entry.initial }}</span
                >
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-semibold text-gray-900 truncate">{{ entry.name }}</span>
                  <span
                    class="block text-xs truncate"
                    [class.text-primary-700]="isCurrent(entry)"
                    [class.text-gray-500]="!isCurrent(entry)"
                  >
                    @if (layout.switchingTenantId() === entry.id) {
                      Trocando…
                    } @else {
                      {{ entry.roleLabel }}{{ isCurrent(entry) ? ' · Empresa atual' : '' }}
                    }
                  </span>
                </span>
                @if (isCurrent(entry)) {
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-primary-700 shrink-0"
                    aria-hidden="true"
                    data-testid="current-check"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              </button>
            </li>
          } @else {
            <li role="presentation">
              <div
                class="w-full min-h-12 flex items-center gap-3 px-3 py-2"
                data-testid="switcher-onboarding"
              >
                <span
                  class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold bg-gray-200 text-gray-700"
                  >{{ entry.initial }}</span
                >
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-semibold text-gray-900 truncate">{{ entry.name }}</span>
                  <span class="block text-xs text-gray-500 truncate">{{ entry.roleLabel }}</span>
                </span>
                <button
                  type="button"
                  [disabled]="layout.switchingTenantId() !== null"
                  (click)="finishOnboarding(entry)"
                  class="shrink-0 min-h-11 px-3 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold
                         hover:bg-amber-200 disabled:opacity-60 disabled:cursor-wait focus:outline-none
                         focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                  Concluir cadastro
                </button>
              </div>
            </li>
          }
        }
      </ul>

      @if (layout.pendingInvites().length > 0) {
        <section class="mt-3 pt-3 border-t border-gray-100" aria-labelledby="switcher-invites-title">
          <h3
            id="switcher-invites-title"
            class="px-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
          >
            Convites para você
          </h3>
          <ul class="mt-1">
            @for (invite of layout.pendingInvites(); track $index) {
              <li class="min-h-12 flex items-center gap-3 px-3 py-2" data-testid="switcher-invite">
                <span
                  class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold border border-dashed border-gray-300 text-gray-500"
                  >{{ invite.companyName.charAt(0).toUpperCase() }}</span
                >
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-semibold text-gray-900 truncate">{{ invite.companyName }}</span>
                  <span class="block text-xs text-gray-500 truncate">{{ invite.roleLabel }}</span>
                </span>
              </li>
            }
          </ul>
          <p class="px-3 pt-1 text-xs text-gray-600">
            Abra o link do convite no seu e-mail para aceitar.
          </p>
        </section>
      }
    </div>
  `,
})
export class CompanySwitcher {
  protected readonly layout = inject(LayoutStore);

  protected isCurrent(entry: SwitcherEntry): boolean {
    return entry.id === this.layout.currentCompanyId();
  }

  protected select(entry: SwitcherEntry): void {
    this.layout.selectTenant({
      id: entry.id,
      name: entry.name,
      role: entry.role,
      initial: entry.initial,
    });
  }

  protected finishOnboarding(entry: SwitcherEntry): void {
    this.layout.resumeOnboarding(entry);
  }
}
