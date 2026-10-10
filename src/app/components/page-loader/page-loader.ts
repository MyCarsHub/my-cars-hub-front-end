import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The ONE full-page loading screen of the app: spinner ring + title + subtitle.
 *
 * It is the "Processando autenticação" screen of `/oauth-success`, extracted so every wait that
 * replaces a whole page (invite check, joining a company, payment confirmation, onboarding
 * load) looks and reads the same. Each caller keeps its own wording through the inputs; the
 * markup and classes are not configurable on purpose.
 *
 * `fullScreen` is the only knob: `true` fills the viewport (public pages, no shell around),
 * `false` fills the content area of the authenticated shell, where a 100vh block would add a
 * second scrollbar. The ring, title and subtitle are identical either way.
 *
 * Not for in-card skeletons or inline button spinners; those are not full-page waits.
 */
@Component({
  selector: 'app-page-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="w-full flex items-center justify-center bg-gradient-to-br from-neutral-50 via-white to-primary-50/40 px-6"
      [class]="fullScreen() ? 'min-h-screen' : 'min-h-[70dvh]'"
      role="status"
      aria-live="polite"
    >
      <section class="flex flex-col items-center text-center max-w-sm">
        <div class="relative w-16 h-16 mb-8" aria-hidden="true">
          <div class="absolute inset-0 rounded-full border-4 border-primary-100"></div>
          <div
            class="absolute inset-0 rounded-full border-4 border-transparent border-t-primary-500 animate-spin"
          ></div>
        </div>

        <h1 class="text-xl sm:text-2xl font-semibold text-neutral-900 tracking-tight">
          {{ title() }}
        </h1>

        @if (description()) {
          <p class="mt-3 text-sm sm:text-base text-neutral-500 leading-relaxed">
            {{ description() }}
          </p>
        }
      </section>
    </main>
  `,
})
export class PageLoader {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly fullScreen = input(true);
}
