import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ApiErrorService } from '../../../services/api-error.service';
import {
  AdminTrialService,
  TRIAL_EXTENSION_MAX_DAYS,
  TRIAL_EXTENSION_MIN_DAYS,
  TRIAL_EXTENSION_REASONS,
  TrialExtensionReason,
  TrialExtensionResponse,
} from '../../../services/admin-trial.service';

/** Atalhos de dias. O campo numérico cobre qualquer valor de 1 a 60. */
const QUICK_PICKS = [7, 14, 30] as const;

/**
 * "Estender teste" — folha inferior (celular) / diálogo (desktop).
 *
 * Mobile-first: atalhos +7/+14/+30 com alvo de 48px, campos com fonte de 16px
 * (abaixo disso o iOS dá zoom no foco e desloca a folha), botões em largura
 * total no celular. O motivo é uma LISTA: o backend grava só o código na
 * auditoria (regra da V45); a observação livre fica fora da trilha.
 *
 * O e-mail ao cliente é enviado pelo backend depois de gravar — o aviso aqui
 * só diz quantos destinatários ele terá.
 */
@Component({
  selector: 'app-trial-extension-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertBanner],
  template: `
    <div
      class="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm"
      (click)="cancel()"
      aria-hidden="true"
    ></div>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-extension-title"
      class="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4 pointer-events-none"
    >
      <form
        class="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border border-edge-soft w-full sm:max-w-md
               pointer-events-auto max-h-[90dvh] overflow-y-auto"
        (submit)="$event.preventDefault(); submit()"
        data-testid="trial-extension-sheet"
      >
        <div class="p-4 sm:p-6">
          <div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-surface-strong sm:hidden" aria-hidden="true"></div>
          <h2 id="trial-extension-title" class="text-lg font-semibold text-fg">Estender teste</h2>
          <p class="mt-1 text-base text-fg-subtle">
            {{ companyName() }} · {{ currentEndLabel() }}
          </p>

          <fieldset class="mt-4">
            <legend class="text-sm font-medium text-fg-muted">Quantos dias a mais?</legend>
            <div class="mt-2 grid grid-cols-3 gap-2">
              @for (pick of quickPicks; track pick) {
                <button
                  type="button"
                  class="min-h-12 rounded-xl border text-base font-semibold transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  [class]="days() === pick
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-edge bg-surface text-fg hover:bg-canvas'"
                  [attr.aria-pressed]="days() === pick"
                  [attr.data-testid]="'trial-pick-' + pick"
                  (click)="pickDays(pick)"
                >
                  +{{ pick }}
                </button>
              }
            </div>
            <label class="mt-3 flex flex-col gap-1">
              <span class="text-sm text-fg-muted">Ou digite (1 a 60 dias)</span>
              <input
                type="number"
                inputmode="numeric"
                [min]="minDays"
                [max]="maxDays"
                [formControl]="daysControl"
                data-testid="trial-days-input"
                class="min-h-12 rounded-xl border border-edge-field bg-surface px-3 text-base text-fg tabular-nums
                       focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </label>
          </fieldset>

          <label class="mt-4 flex flex-col gap-1">
            <span class="text-sm font-medium text-fg-muted">Motivo</span>
            <select
              [formControl]="reasonControl"
              data-testid="trial-reason-select"
              class="min-h-12 rounded-xl border border-edge-field bg-surface px-3 text-base text-fg
                     focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option [ngValue]="null" disabled>Escolha o motivo</option>
              @for (r of reasons; track r.value) {
                <option [ngValue]="r.value">{{ r.label }}</option>
              }
            </select>
          </label>

          <label class="mt-4 flex flex-col gap-1">
            <span class="text-sm font-medium text-fg-muted">Observação interna (opcional)</span>
            <textarea
              rows="2"
              maxlength="500"
              [formControl]="noteControl"
              data-testid="trial-note-input"
              class="rounded-xl border border-edge-field bg-surface px-3 py-2 text-base text-fg
                     focus:outline-none focus:ring-2 focus:ring-primary-400"
            ></textarea>
            <span class="text-xs text-fg-subtle">
              Não vai para o cliente nem para a trilha de auditoria.
            </span>
          </label>

          <p class="mt-4 text-sm text-fg-subtle" data-testid="trial-extension-preview">
            @if (daysValid()) {
              O teste passa a valer até <strong class="text-fg">{{ previewEndLabel() }}</strong>.
              A empresa recebe um e-mail avisando.
            } @else {
              Escolha de 1 a 60 dias.
            }
          </p>

          @if (error(); as err) {
            <div class="mt-3">
              <app-alert-banner variant="error" [message]="err" />
            </div>
          }
        </div>

        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 p-4 sm:p-6 pt-0 sm:pt-0">
          <button
            type="button"
            class="w-full sm:w-auto min-h-12 px-4 rounded-xl text-base font-medium text-fg-muted
                   bg-surface-sunken hover:bg-surface-strong transition-colors"
            (click)="cancel()"
            [disabled]="saving()"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="w-full sm:w-auto min-h-12 px-4 rounded-xl text-base font-semibold text-white
                   bg-primary-500 hover:bg-primary-600 transition-colors disabled:opacity-60
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [disabled]="!canSubmit()"
            data-testid="trial-extension-submit"
          >
            {{ saving() ? 'Estendendo…' : 'Estender teste' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class TrialExtensionSheet {
  private readonly trialService = inject(AdminTrialService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly companyId = input.required<string>();
  readonly companyName = input<string>('');
  /** Fim atual do teste (ISO, UTC) — pode estar no passado (teste vencido). */
  readonly trialEndsAt = input<string | null>(null);
  /** Relógio injetável para os testes. */
  readonly now = input<number>(Date.now());

  readonly closed = output<void>();
  readonly extended = output<TrialExtensionResponse>();

  protected readonly quickPicks = QUICK_PICKS;
  protected readonly reasons = TRIAL_EXTENSION_REASONS;
  protected readonly minDays = TRIAL_EXTENSION_MIN_DAYS;
  protected readonly maxDays = TRIAL_EXTENSION_MAX_DAYS;

  protected readonly daysControl = new FormControl<number | null>(7, {
    validators: [
      Validators.required,
      Validators.min(TRIAL_EXTENSION_MIN_DAYS),
      Validators.max(TRIAL_EXTENSION_MAX_DAYS),
    ],
  });
  protected readonly reasonControl = new FormControl<TrialExtensionReason | null>(null, {
    validators: [Validators.required],
  });
  protected readonly noteControl = new FormControl<string>('', { nonNullable: true });

  protected readonly days = signal<number | null>(7);
  private readonly reason = signal<TrialExtensionReason | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.daysControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.days.set(v === null || v === undefined ? null : Number(v)));
    this.reasonControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.reason.set(v));
  }

  protected readonly daysValid = computed(() => {
    const d = this.days();
    return (
      d !== null &&
      Number.isInteger(d) &&
      d >= TRIAL_EXTENSION_MIN_DAYS &&
      d <= TRIAL_EXTENSION_MAX_DAYS
    );
  });

  protected readonly canSubmit = computed(
    () => this.daysValid() && this.reason() !== null && !this.saving(),
  );

  /** Mesma regra do backend: max(agora, fim atual) + dias. */
  protected readonly previewEnd = computed<number | null>(() => {
    const d = this.days();
    if (!this.daysValid() || d === null) return null;
    const end = this.trialEndsAt() ? parseUtc(this.trialEndsAt() as string) : NaN;
    const base = Number.isNaN(end) ? this.now() : Math.max(this.now(), end);
    return base + d * 24 * 60 * 60 * 1000;
  });

  protected readonly previewEndLabel = computed(() => {
    const t = this.previewEnd();
    return t === null ? '' : formatSaoPaulo(t);
  });

  protected readonly currentEndLabel = computed(() => {
    const raw = this.trialEndsAt();
    const end = raw ? parseUtc(raw) : NaN;
    if (Number.isNaN(end)) return 'sem data de fim do teste';
    return end > this.now()
      ? `teste até ${formatSaoPaulo(end)}`
      : `teste vencido em ${formatSaoPaulo(end)}`;
  });

  protected pickDays(value: number): void {
    this.daysControl.setValue(value);
  }

  protected cancel(): void {
    if (this.saving()) return;
    this.closed.emit();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const days = this.days() as number;
    const reason = this.reason() as TrialExtensionReason;
    const note = this.noteControl.value.trim();
    this.saving.set(true);
    this.error.set(null);
    this.trialService
      .extend(this.companyId(), { days, reason, note: note.length > 0 ? note : null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.extended.emit(res);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível estender o teste.'));
        },
      });
  }
}

/**
 * `trial_ends_at` chega como LocalDateTime em UTC, sem sufixo de fuso. Sem o
 * `Z`, `Date.parse` leria como hora local do navegador.
 */
export function parseUtc(raw: string): number {
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
}

function formatSaoPaulo(epochMs: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(epochMs);
}
