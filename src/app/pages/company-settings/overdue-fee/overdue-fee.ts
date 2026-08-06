import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import { formatBRL } from '../../../types/dashboard.types';
import {
  OverdueGraceExample,
  OverdueSettings,
  formatLocalDateTime,
  graceHoursLabel,
  multiplierBpsFromInput,
  multiplierInputValue,
  multiplierLabel,
  overdueDaysLabel,
  overdueGraceExample,
} from '../../../types/overdue.types';
import { OverdueSettingsService } from './overdue-settings.service';

const LOAD_FALLBACK = 'Não foi possível carregar a regra de multa por atraso.';
const SAVE_FALLBACK = 'Não foi possível salvar a regra de multa por atraso.';

/**
 * Faixa do multiplicador validada em basis-points, com os limites que vieram do
 * servidor. Deixa o campo vazio para `Validators.required` reclamar sozinho.
 */
function multiplierRangeValidator(minBps: number, maxBps: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw === null || raw === undefined || raw === '') return null;
    const bps = multiplierBpsFromInput(raw as string);
    if (bps === null) return null; // o `pattern` já cobre "não é número".
    if (bps < minBps || bps > maxBps) {
      return {
        multiplierRange: {
          min: multiplierLabel(minBps),
          max: multiplierLabel(maxBps),
        },
      };
    }
    return null;
  };
}

/**
 * Configurações → Devolução com atraso (`/configuracoes/atraso`).
 *
 * Define os dois números que decidem a multa automática: quantas vezes a diária
 * é cobrada por dia de atraso, e quantas horas de tolerância o motorista tem
 * depois do fim do prazo.
 *
 * Decisões que a tela precisa deixar visíveis, e por quê:
 *
 * 1. **A regra do prazo, escrita sem mentir.** O prazo vence no dia seguinte ao
 *    fim do aluguel, à meia-noite, mais a tolerância; está atrasado quem devolve
 *    ESTRITAMENTE depois disso. Devolver em cima do limite conta como no prazo.
 *    Os dias cobrados são dias de calendário, não frações de hora.
 * 2. **Os limites vêm do servidor** (`min/maxMultiplierBps`, `min/maxGraceHours`).
 *    Os validadores são montados a partir da resposta — não há cópia local da
 *    regra para divergir.
 * 3. **`customized` distingue "nunca configurou" de "configurou igual ao
 *    padrão"** — vira selo visível, como em Avisos de vencimento.
 *
 * O `roleGuard(['OWNER','MANAGER'])` da rota é quem controla o acesso; a tela
 * não repete a regra de papel. Membro comum não chega aqui — ele lê a regra em
 * vigor no popup de conclusão do aluguel, que mostra multiplicador e tolerância
 * junto da conta.
 */
@Component({
  selector: 'app-overdue-fee',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './overdue-fee.html',
})
export class OverdueFee implements OnInit {
  private readonly service = inject(OverdueSettingsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly settings = this.service.settings;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);

  /** Multiplicador em "x" (`1.5`) — a unidade que o usuário pensa. */
  protected readonly multiplier = new FormControl('', { nonNullable: true });
  protected readonly graceHours = new FormControl('', { nonNullable: true });

  /**
   * Contador tocado a cada digitação. Os `FormControl` do Reactive Forms não são
   * signals, então os `computed` abaixo precisam de uma dependência que mude —
   * sem ele "Salvar" ficaria desabilitado até um ciclo de detecção alheio.
   */
  private readonly formTick = signal(0);

  protected readonly multiplierMessages: Readonly<Record<string, string>> = {
    required: 'Informe quantas vezes a diária será cobrada por dia de atraso.',
    pattern: 'Use um número, com no máximo quatro casas decimais (ex.: 1,5 ou 1,05).',
    multiplierRange: 'Multiplicador fora da faixa aceita.',
  };

  protected readonly graceHoursMessages: Readonly<Record<string, string>> = {
    required: 'Informe a tolerância em horas (0 para não ter tolerância).',
    pattern: 'Use um número inteiro de horas.',
  };

  /** Selo "Personalizado" × "Padrão do sistema". */
  protected readonly customized = computed(() => this.settings()?.customized === true);

  protected readonly savedMultiplierLabel = computed(() =>
    multiplierLabel(this.settings()?.multiplierBps ?? 0),
  );
  protected readonly savedGraceLabel = computed(() =>
    graceHoursLabel(this.settings()?.graceHours ?? 0),
  );
  protected readonly defaultMultiplierLabel = computed(() =>
    multiplierLabel(this.settings()?.defaultMultiplierBps ?? 0),
  );
  protected readonly defaultGraceLabel = computed(() =>
    graceHoursLabel(this.settings()?.defaultGraceHours ?? 0),
  );

  /** Faixa aceita, em "x", para o hint do campo. */
  protected readonly minMultiplierLabel = computed(() =>
    multiplierLabel(this.settings()?.minMultiplierBps ?? 0),
  );
  protected readonly maxMultiplierLabel = computed(() =>
    multiplierLabel(this.settings()?.maxMultiplierBps ?? 0),
  );

  /**
   * Exemplo numérico com os valores em EDIÇÃO, não com os salvos: o operador
   * precisa ver o efeito de mudar o número antes de gravá-lo.
   *
   * O exemplo antigo fixava "2 dias de atraso" e IGNORAVA a tolerância, o que
   * escondia a metade importante da regra: a tolerância decide se cobra, mas
   * não é descontada da contagem de dias. Quem subia a tolerância achando que
   * estava sendo brando não via que estava aumentando a primeira cobrança.
   *
   * `formTick()` é a dependência que faz isto recalcular — os `FormControl` não
   * são signals, e um `computed` sem dependência nenhuma nunca reavalia (era o
   * caso antes: o exemplo ficava congelado no valor vazio do primeiro render).
   */
  protected readonly example = computed<OverdueGraceExample | null>(() => {
    this.formTick();
    const bps = multiplierBpsFromInput(this.multiplier.value);
    const hours = Number(this.graceHours.value);
    if (bps === null || bps <= 0) return null;
    if (!Number.isFinite(hours) || hours < 0) return null;
    return overdueGraceExample(bps, Math.trunc(hours));
  });

  /** `20/07/2026` — o fim de aluguel fictício do exemplo. */
  protected readonly exampleEndDateLabel = computed<string>(() => {
    const value = this.example()?.endDate;
    return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '';
  });

  /** `24/07/2026 às 00:00` — até aqui, devolver não custa nada. */
  protected readonly exampleDueAtLabel = computed<string>(() =>
    formatLocalDateTime(this.example()?.dueAt),
  );

  /** `4 diárias × R$ 100,00 × 1,5x = R$ 600,00` — a primeira cobrança possível. */
  protected readonly exampleFirstChargeLabel = computed<string>(() => {
    const example = this.example();
    if (!example) return '';
    const bps = multiplierBpsFromInput(this.multiplier.value) ?? 0;
    return (
      `${overdueDaysLabel(example.firstChargeDays)} × ${formatBRL(example.dailyRate)}` +
      ` × ${multiplierLabel(bps)} = ${formatBRL(example.firstChargeAmount)}`
    );
  });

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    // `force`: a tela de configuração mostra o servidor, não um cache de outra
    // visita — nem um valor que outra aba possa ter mudado.
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

  /** Rascunho difere do salvo — habilita salvar e desfazer. */
  protected readonly hasChanges = computed(() => {
    this.formTick();
    const settings = this.settings();
    if (!settings) return false;
    const bps = multiplierBpsFromInput(this.multiplier.value);
    const hours = Number(this.graceHours.value);
    if (bps === null || !Number.isFinite(hours)) return true;
    return bps !== settings.multiplierBps || hours !== settings.graceHours;
  });

  /**
   * `formTick()` é lido AQUI, e não só dentro de `hasChanges()`, de propósito.
   *
   * `FormControl.valid` não é signal: as únicas dependências rastreadas seriam
   * `hasChanges()` e `saving()`. Como `hasChanges()` compara por valor, corrigir
   * um multiplicador inválido (9x, fora da faixa) para um válido (1,05x) não
   * mudava o resultado dela — continuava `true` — e o `computed` nunca era
   * invalidado: o campo voltava a ser válido, o erro sumia da tela e "Salvar"
   * seguia desabilitado, sem nada explicando por quê.
   */
  protected readonly canSave = computed(() => {
    this.formTick();
    return this.hasChanges() && !this.saving() && this.multiplier.valid && this.graceHours.valid;
  });

  /** Já está no padrão (salvo E em rascunho) — restaurar seria no-op. */
  protected readonly atDefault = computed(() => {
    this.formTick();
    const settings = this.settings();
    if (!settings) return false;
    return (
      !settings.customized &&
      settings.multiplierBps === settings.defaultMultiplierBps &&
      settings.graceHours === settings.defaultGraceHours &&
      multiplierBpsFromInput(this.multiplier.value) === settings.defaultMultiplierBps &&
      Number(this.graceHours.value) === settings.defaultGraceHours
    );
  });

  /** Região viva: salvar não move foco nem rota (WCAG 4.1.3). */
  protected readonly liveStatus = computed(() => {
    if (this.loading()) return 'Carregando a regra de multa por atraso.';
    if (this.saving()) return 'Salvando a regra de multa por atraso.';
    return `Em vigor: ${this.savedMultiplierLabel()} a diária, com ${this.savedGraceLabel()}.`;
  });

  protected onFieldInput(): void {
    this.saveError.set(null);
    this.formTick.update((n) => n + 1);
  }

  protected save(): void {
    if (!this.canSave()) return;
    const multiplierBps = multiplierBpsFromInput(this.multiplier.value);
    if (multiplierBps === null) return;
    this.persist(
      { multiplierBps, graceHours: Number(this.graceHours.value) },
      'Regra de multa por atraso atualizada.',
    );
  }

  protected discardChanges(): void {
    const settings = this.settings();
    if (!settings) return;
    this.adopt(settings);
    this.saveError.set(null);
  }

  protected restoreDefault(): void {
    const settings = this.settings();
    if (!settings || this.saving()) return;
    this.persist(
      {
        multiplierBps: settings.defaultMultiplierBps,
        graceHours: settings.defaultGraceHours,
      },
      `Regra restaurada para o padrão: ${multiplierLabel(settings.defaultMultiplierBps)} com ${graceHoursLabel(settings.defaultGraceHours)}.`,
    );
  }

  private persist(update: { multiplierBps: number; graceHours: number }, message: string): void {
    this.saving.set(true);
    this.saveError.set(null);

    this.service.save(update).subscribe({
      next: (settings) => {
        this.saving.set(false);
        this.adopt(settings);
        this.notifications.success(message);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        // 400 com `fieldErrors` e 403 (papel) chegam achatados pelo extrator.
        this.saveError.set(this.apiErrors.messageFor(err, SAVE_FALLBACK));
      },
    });
  }

  /**
   * Adota a resposta do servidor: campos voltam a espelhar o salvo e os
   * validadores passam a usar os limites que vieram com ela.
   */
  private adopt(settings: OverdueSettings): void {
    // Faixa validada sobre os BASIS-POINTS, não sobre o texto: `Validators.min`
    // usa `parseFloat`, que lê "5,5" como 5 e deixaria passar um valor acima do
    // teto. A conversão aqui é a mesma que vai para o servidor.
    // Quatro casas, não uma: o multiplicador viaja em basis-points e o servidor
    // aceita QUALQUER inteiro na faixa (`UpdateOverdueSettingsRequestDto`).
    // Com uma casa só, um 1,05x gravado por outro caminho voltava do servidor e
    // carregava o próprio campo já inválido — a tela recusando o que ela mesma
    // acabara de receber.
    this.multiplier.setValidators([
      Validators.required,
      Validators.pattern(/^\d+([.,]\d{1,4})?$/),
      multiplierRangeValidator(settings.minMultiplierBps, settings.maxMultiplierBps),
    ]);
    this.graceHours.setValidators([
      Validators.required,
      Validators.pattern(/^\d+$/),
      Validators.min(settings.minGraceHours),
      Validators.max(settings.maxGraceHours),
    ]);
    this.multiplier.setValue(multiplierInputValue(settings.multiplierBps));
    this.graceHours.setValue(String(settings.graceHours));
    this.multiplier.markAsPristine();
    this.multiplier.markAsUntouched();
    this.graceHours.markAsPristine();
    this.graceHours.markAsUntouched();
    this.formTick.update((n) => n + 1);
  }
}
