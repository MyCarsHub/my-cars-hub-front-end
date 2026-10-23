import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PageCard } from '../core/page-card/page-card';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '../segmented-toggle/segmented-toggle';
import { ThemePreference, ThemeService } from '../../services/theme.service';

/*
 * Pílula ativa em primary-700, não 500: o texto dela é branco e pequeno (14px/600), e
 * branco sobre #F63B04 dá 3,79:1 (reprova AA); sobre #C22F00 dá 5,67:1 — nos dois temas,
 * porque a pílula é preenchida e não muda com o fundo.
 */
const ACTIVE = 'var(--color-primary-700)';

const OPTIONS: readonly SegmentedToggleOption<ThemePreference>[] = [
  { value: 'light', label: 'Claro', activeBackground: ACTIVE },
  { value: 'dark', label: 'Escuro', activeBackground: ACTIVE },
  { value: 'system', label: 'Automático', activeBackground: ACTIVE },
];

/**
 * Cartão "Aparência" do Perfil (dono, gerente e motorista): Claro, Escuro ou Automático.
 * A escolha vale para ESTE aparelho — ver `ThemeService`.
 */
@Component({
  selector: 'app-theme-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, SegmentedToggle],
  template: `
    <app-page-card title="Aparência">
      <div class="space-y-3 px-4 pb-5 sm:px-6">
        <!-- Largura cheia e segmentos iguais: na coluna estreita do Perfil (≈290px no
             desktop, 311px a 375) os três rótulos cabem sem cortar «Automático». -->
        <app-segmented-toggle
          class="w-full"
          containerClass="w-full bg-surface-sunken border border-edge"
          textClass="flex-1 justify-center px-2! text-sm"
          [options]="options"
          [value]="theme.preference()"
          ariaLabel="Tema do app"
          (selectionChange)="theme.setPreference($event)"
        />
        <p class="text-xs text-fg-subtle" aria-live="polite">{{ hint() }}</p>
      </div>
    </app-page-card>
  `,
})
export class ThemePicker {
  protected readonly theme = inject(ThemeService);
  protected readonly options = OPTIONS;

  protected readonly hint = computed(() =>
    this.theme.preference() === 'system'
      ? `Segue o tema do seu aparelho (agora: ${this.theme.resolved() === 'dark' ? 'escuro' : 'claro'}). Vale só neste aparelho.`
      : 'Vale só neste aparelho.',
  );
}
