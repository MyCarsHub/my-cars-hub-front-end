import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { PageCard } from '../../../components/core/page-card/page-card';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { AlertSettingsService } from '../../../services/alert-settings.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { AlertSettings } from '../../../types/alert-settings.types';
import {
  alertWindowLabel,
  formatAlertWindows,
  sameWindows,
  sortWindowsDesc,
} from '../../../utils/alert-windows';

const LOAD_FALLBACK = 'Não foi possível carregar as janelas de aviso.';
const SAVE_FALLBACK = 'Não foi possível salvar as janelas de aviso.';

/**
 * Seção "Janelas de aviso" da página `/alertas`.
 *
 * Edita as janelas de antecedência com que a empresa é avisada dos vencimentos.
 * Já foi a tela `/configuracoes/alertas`; virou seção porque a página de Alertas
 * é onde o assunto vive — navegar até Configurações para mudar dois números era
 * um salto sem motivo.
 *
 * **A regra de papel agora é da PÁGINA, não da rota.** `/alertas` é aberta a
 * qualquer membro autenticado, então quem renderiza esta seção é o
 * `@if (canConfigure)` de `alerts-page.html` (mesmos OWNER/MANAGER que o antigo
 * `roleGuard`). Membro comum continua vendo o estado em leitura, no resumo
 * "Avisos da empresa: …" logo acima.
 *
 * Três decisões que a interface precisa deixar visíveis:
 *
 * 1. **O `PUT` é substituição completa.** A tela mostra lado a lado o que está
 *    em vigor e o rascunho, e o botão diz "Substituir janelas" — não "adicionar".
 * 2. **`customized` distingue "nunca configurou" de "configurou igual ao
 *    padrão".** Vira um selo visível, não um detalhe escondido.
 * 3. **Os limites vêm do servidor** (`minWindowDays` / `maxWindowDays` /
 *    `maxWindowCount`). Os validadores são montados a partir da resposta, então
 *    não existe cópia local da regra para divergir.
 */
@Component({
  selector: 'app-alert-windows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ReactiveFormsModule, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './alert-windows.html',
})
export class AlertWindows implements OnInit {
  private readonly service = inject(AlertSettingsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly settings = this.service.settings;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** Falha do salvamento, incluindo o 400 com `fieldErrors.windows`. */
  protected readonly saveError = signal<string | null>(null);

  /** Lista em edição. Sempre decrescente, como o backend armazena. */
  protected readonly draft = signal<number[]>([]);

  protected readonly newWindow = new FormControl('', { nonNullable: true });

  /**
   * Cópias por validador. `min`/`max` ficam com a mensagem padrão porque ela já
   * cita o limite que veio do servidor ("Valor mínimo: 1.").
   */
  protected readonly newWindowMessages: Readonly<Record<string, string>> = {
    required: 'Informe de quantos dias de antecedência você quer ser avisado.',
    pattern: 'Use um número inteiro de dias.',
    duplicate: 'Essa janela já está na lista.',
  };

  protected readonly savedLabel = computed(() =>
    formatAlertWindows(this.settings()?.windows ?? []),
  );
  protected readonly draftLabel = computed(() => formatAlertWindows(this.draft()));
  protected readonly defaultLabel = computed(() =>
    formatAlertWindows(this.settings()?.defaultWindows ?? []),
  );

  /** Selo "Personalizado" × "Padrão do sistema" — vem de `customized`. */
  protected readonly customized = computed(() => this.settings()?.customized === true);

  protected readonly limitReached = computed(() => {
    const settings = this.settings();
    return settings !== null && this.draft().length >= settings.maxWindowCount;
  });

  /** Rascunho difere do que está salvo — habilita salvar e desfazer. */
  protected readonly hasChanges = computed(() => {
    const settings = this.settings();
    return settings !== null && !sameWindows(this.draft(), settings.windows);
  });

  /** Lista vazia não é salvável: uma empresa sem janela nenhuma nunca é avisada. */
  protected readonly canSave = computed(
    () => this.hasChanges() && this.draft().length > 0 && !this.saving(),
  );

  /** Já está no padrão (salvo E em rascunho) — restaurar seria um no-op. */
  protected readonly atDefault = computed(() => {
    const settings = this.settings();
    if (!settings) return false;
    return (
      !settings.customized &&
      sameWindows(settings.windows, settings.defaultWindows) &&
      sameWindows(this.draft(), settings.defaultWindows)
    );
  });

  /** Região viva: adicionar/remover não move foco nem rota (WCAG 4.1.3). */
  protected readonly liveStatus = computed(() => {
    if (this.loading()) return 'Carregando as janelas de aviso…';
    if (this.draft().length === 0) return 'Nenhuma janela selecionada.';
    const suffix = this.hasChanges() ? ' Alterações ainda não salvas.' : '';
    return `Rascunho: ${this.draftLabel()} antes do vencimento.${suffix}`;
  });

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    // `force`: o editor mostra o servidor, não o cache que a própria página
    // pode ter herdado de uma visita anterior (ou de outra aba).
    this.service.load(true).subscribe({
      next: (settings) => {
        this.adopt(settings);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.apiErrors.messageFor(err, LOAD_FALLBACK));
      },
    });
  }

  protected addWindow(): void {
    const settings = this.settings();
    if (!settings || this.limitReached()) return;

    this.newWindow.markAsTouched();
    if (this.newWindow.invalid) return;

    const days = Number(this.newWindow.value);
    if (this.draft().includes(days)) {
      this.newWindow.setErrors({ duplicate: true });
      return;
    }

    this.draft.update((list) => sortWindowsDesc([...list, days]));
    this.newWindow.reset('');
    this.saveError.set(null);
  }

  protected removeWindow(days: number): void {
    this.draft.update((list) => list.filter((value) => value !== days));
    this.saveError.set(null);
  }

  /** Volta o rascunho para o que está salvo — o inverso de "substituir". */
  protected discardChanges(): void {
    const settings = this.settings();
    if (!settings) return;
    this.draft.set(sortWindowsDesc(settings.windows));
    this.newWindow.reset('');
    this.saveError.set(null);
  }

  protected save(): void {
    if (!this.canSave()) return;
    this.persist(this.draft(), 'Janelas de aviso atualizadas.');
  }

  /**
   * Um clique volta ao padrão do sistema. Os números do padrão estão no rótulo
   * do botão para o usuário não precisar adivinhá-los.
   */
  protected restoreDefault(): void {
    const settings = this.settings();
    if (!settings || this.saving()) return;
    this.persist(
      sortWindowsDesc(settings.defaultWindows),
      `Janelas restauradas para o padrão: ${formatAlertWindows(settings.defaultWindows)}.`,
    );
  }

  protected windowLabel(days: number): string {
    return alertWindowLabel(days);
  }

  private persist(windows: number[], successMessage: string): void {
    this.saving.set(true);
    this.saveError.set(null);

    this.service.save(windows).subscribe({
      next: (settings) => {
        this.saving.set(false);
        this.adopt(settings);
        this.notifications.success(successMessage);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        // O 400 do backend chega com `fieldErrors.windows`; o extrator
        // compartilhado o achata na mensagem do banner.
        this.saveError.set(this.apiErrors.messageFor(err, SAVE_FALLBACK));
      },
    });
  }

  /**
   * Adota a resposta do servidor: rascunho volta a espelhar o salvo e os
   * validadores passam a usar os limites que vieram com ela.
   */
  private adopt(settings: AlertSettings): void {
    this.draft.set(sortWindowsDesc(settings.windows));
    this.newWindow.setValidators([
      Validators.required,
      Validators.pattern(/^\d+$/),
      Validators.min(settings.minWindowDays),
      Validators.max(settings.maxWindowDays),
    ]);
    this.newWindow.reset('');
  }
}
