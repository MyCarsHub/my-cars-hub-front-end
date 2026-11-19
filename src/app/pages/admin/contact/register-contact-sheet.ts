import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { BottomSheet } from '../../../components/core/bottom-sheet/bottom-sheet';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import {
  FilterChipGroup,
  type FilterChipOption,
} from '../../../components/filter-chip-group/filter-chip-group';
import { ApiErrorService } from '../../../services/api-error.service';
import { nowHhMmInBusinessTz, todayInBusinessTz } from '../../../utils/business-clock';
import { parseServerTime } from '../../../utils/server-time';
import type {
  CompanyEngagement,
  ContactLogChannel,
  ContactLogResult,
  RegisterContactRequest,
  RegisterContactResponse,
} from '../../../types/admin-segments.types';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import {
  CHANNEL_LABELS,
  RESULT_LABELS,
  addDays,
  businessDay,
  dayMonth,
  deadlineText,
  fleetText,
  lastSignalText,
  segmentChip,
  weekdayName,
} from '../segments/segment-copy';

type FollowUp = 'D1' | 'D3' | 'D7' | 'CUSTOM' | 'NONE';

/** Dias da extensão oferecida junto com o contato (o mesmo atalho do "Estender teste"). */
export const CONTACT_EXTEND_DAYS = 7;

/** Teto do retorno no servidor (`CompanyContactService.MAX_FOLLOW_UP_AHEAD_DAYS`). */
export const MAX_FOLLOW_UP_AHEAD_DAYS = 366;

const NOTE_MAX = 500;

/** Brasília não tem horário de verão desde 2019: o deslocamento é fixo. */
const BUSINESS_OFFSET = '-03:00';

const CHANNEL_OPTIONS: readonly FilterChipOption<ContactLogChannel>[] = (
  ['WHATSAPP', 'PHONE', 'EMAIL', 'IN_PERSON'] as const
).map((value) => ({ value, label: CHANNEL_LABELS[value] }));

const RESULT_OPTIONS: readonly { value: ContactLogResult; label: string }[] = (
  ['ANSWERED', 'NO_ANSWER', 'WILL_SUBSCRIBE', 'NOT_INTERESTED'] as const
).map((value) => ({ value, label: RESULT_LABELS[value] }));

const FOLLOW_UP_OPTIONS: readonly FilterChipOption<FollowUp>[] = [
  { value: 'D1', label: 'Amanhã' },
  { value: 'D3', label: 'Em 3 dias' },
  { value: 'D7', label: 'Em 7 dias' },
  { value: 'CUSTOM', label: 'Escolher data' },
  { value: 'NONE', label: 'Sem retorno' },
];

const FIELD =
  'w-full min-h-12 rounded-xl border border-edge-field bg-surface px-3 text-base text-fg ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-400';

/**
 * "Registrar contato" (admin, 18/11/2026): folha de baixo no celular, diálogo no computador
 * (`app-bottom-sheet`). Canal, resultado, nota, próximo retorno e, para empresa em teste,
 * "também estender o teste" (o servidor chama o MESMO serviço do "Estender teste", na mesma
 * transação). A caixa de aviso diz o efeito antes de salvar: a empresa sai de "Hoje, para agir"
 * até o retorno, ou até o segmento mudar, ou de vez ("Não tem interesse").
 */
@Component({
  selector: 'app-register-contact-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, FilterChipGroup, StatusChip, AlertBanner, ReactiveFormsModule],
  template: `
    <app-bottom-sheet
      #sheet
      title="Registrar contato"
      subtitle="Fica na atividade da empresa."
      size="lg"
      [busy]="saving()"
      (closed)="closed.emit()"
    >
      <form
        id="register-contact-form"
        class="flex flex-col gap-5"
        data-testid="register-contact-sheet"
        (submit)="$event.preventDefault(); submit()"
      >
        <div class="rounded-2xl bg-surface-muted px-4 py-3 flex flex-col items-start gap-1.5" data-testid="contact-context">
          <b class="text-base text-fg">{{ companyName() }}</b>
          @if (chip(); as c) {
            <app-status-chip size="sm" [tone]="c.tone">{{ c.label }}</app-status-chip>
          }
          <span class="text-xs text-fg-subtle">{{ contextLine() }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <span id="rc-channel" class="text-sm text-fg-muted">Canal</span>
          <app-filter-chip-group
            [options]="channelOptions"
            [value]="channel()"
            [scrollable]="true"
            ariaLabelledby="rc-channel"
            (selectionChange)="channel.set($event)"
          />
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm text-fg-muted mb-2">Resultado</legend>
          <div class="grid grid-cols-2 gap-2">
            @for (r of resultOptions; track r.value) {
              <label
                class="press relative flex min-h-[52px] cursor-pointer items-center justify-between gap-2 rounded-xl px-3.5
                       text-[15px] font-semibold text-fg transition-colors duration-200
                       has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-400"
                [class]="result() === r.value
                  ? 'border-2 border-primary-500 bg-primary-50 dark:bg-primary-500/15'
                  : 'border border-edge-field bg-surface hover:bg-canvas'"
                [attr.data-result]="r.value"
              >
                <input
                  type="radio"
                  name="rc-result"
                  class="sr-only"
                  [value]="r.value"
                  [checked]="result() === r.value"
                  (change)="pickResult(r.value)"
                />
                <span>{{ r.label }}</span>
                @if (result() === r.value) {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                       stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-primary-600 dark:text-primary-400" aria-hidden="true">
                    <path d="M5 12l5 5l9-10" />
                  </svg>
                }
              </label>
            }
          </div>
        </fieldset>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-fg-muted">Nota</span>
          <textarea
            rows="3"
            [maxLength]="noteMax"
            [formControl]="noteControl"
            data-testid="contact-note"
            placeholder="O que a pessoa disse e o que ficou combinado"
            class="w-full min-h-[104px] resize-none rounded-xl border border-edge-field bg-surface px-3 py-3 text-base text-fg
                   placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-primary-400"
          ></textarea>
        </label>

        @if (result() !== 'NOT_INTERESTED') {
          <div class="flex flex-col gap-2">
            <span id="rc-follow" class="text-sm text-fg-muted">Próximo retorno</span>
            <app-filter-chip-group
              [options]="followUpOptions"
              [value]="followUp()"
              [scrollable]="true"
              ariaLabelledby="rc-follow"
              (selectionChange)="followUp.set($event)"
            />
            @if (followUp() === 'CUSTOM') {
              <label class="flex flex-col gap-1.5 enter-up">
                <span class="text-sm text-fg-muted">Data do retorno</span>
                <input type="date" data-testid="contact-follow-date" [class]="field" [min]="minFollowUp()" [max]="maxFollowUp()" [formControl]="dateControl" />
              </label>
            }
          </div>
        }

        @if (canExtend()) {
          <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-muted px-3.5 py-3">
            <input
              type="checkbox"
              data-testid="contact-extend"
              class="mt-0.5 h-[22px] w-[22px] shrink-0 rounded accent-primary-500"
              [checked]="extend()"
              (change)="extend.set($any($event.target).checked)"
            />
            <span class="flex flex-col gap-0.5 text-[15px] font-semibold text-fg">
              Também estender o teste em {{ extendDays }} dias
              <small class="text-xs font-normal text-fg-subtle">{{ extendHint() }}</small>
            </span>
          </label>
        }

        <p class="m-0 rounded-xl bg-surface-muted px-3.5 py-3 text-sm text-fg" data-testid="contact-effect" aria-live="polite">
          {{ effectText() }}
        </p>

        <div class="flex flex-col gap-2">
          <p class="m-0 text-xs text-fg-subtle">
            {{ whenText() }}
            @if (!editingWhen()) {
              <button
                type="button"
                data-testid="contact-change-when"
                class="ml-1 min-h-11 font-semibold text-primary-700 dark:text-primary-400 underline underline-offset-2
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
                (click)="editingWhen.set(true)"
              >Mudar data</button>
            }
          </p>
          @if (editingWhen()) {
            <label class="flex flex-col gap-1.5 enter-up">
              <span class="text-sm text-fg-muted">Quando foi o contato</span>
              <input type="datetime-local" data-testid="contact-when" [class]="field" [max]="nowLocal()" [formControl]="whenControl" />
            </label>
          }
        </div>

        @if (error(); as err) {
          <app-alert-banner variant="error" [message]="err" />
        }
      </form>

      <div sheetFooter class="flex flex-col-reverse gap-2 lg:flex-row lg:justify-end lg:gap-3">
        <button
          type="button"
          class="press w-full lg:w-auto min-h-12 px-5 rounded-full border border-edge-field text-base font-semibold text-fg
                 hover:bg-canvas transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          [disabled]="saving()"
          (click)="sheet.requestClose()"
        >Cancelar</button>
        <button
          type="submit"
          form="register-contact-form"
          data-testid="contact-submit"
          class="press w-full lg:w-auto min-h-12 px-5 rounded-full bg-primary-500 text-base font-semibold text-white
                 hover:bg-primary-600 transition-colors disabled:opacity-60
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          [disabled]="!canSubmit()"
        >{{ saving() ? 'Salvando…' : 'Salvar contato' }}</button>
      </div>
    </app-bottom-sheet>
  `,
})
export class RegisterContactSheet {
  private readonly segments = inject(AdminSegmentsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sheet = viewChild.required<BottomSheet>('sheet');

  readonly companyId = input.required<string>();
  readonly companyName = input<string>('');
  readonly engagement = input<CompanyEngagement | null | undefined>(null);
  /** Mostra "também estender o teste": empresa em teste E quem registra pode estender. */
  readonly canExtend = input(false);
  /** Relógio injetável para os testes. */
  readonly now = input<Date>(new Date());

  readonly closed = output<void>();
  readonly saved = output<RegisterContactResponse>();

  protected readonly channelOptions = CHANNEL_OPTIONS;
  protected readonly resultOptions = RESULT_OPTIONS;
  protected readonly followUpOptions = FOLLOW_UP_OPTIONS;
  protected readonly extendDays = CONTACT_EXTEND_DAYS;
  protected readonly noteMax = NOTE_MAX;
  protected readonly field = FIELD;

  protected readonly channel = signal<ContactLogChannel>('WHATSAPP');
  protected readonly result = signal<ContactLogResult>('ANSWERED');
  protected readonly followUp = signal<FollowUp>('D1');
  protected readonly extend = signal(false);
  protected readonly editingWhen = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly noteControl = new FormControl<string>('', { nonNullable: true });
  protected readonly dateControl = new FormControl<string>('', { nonNullable: true });
  protected readonly whenControl = new FormControl<string>('', { nonNullable: true });
  private readonly customDate = toSignal(this.dateControl.valueChanges, { initialValue: '' });
  private readonly when = toSignal(this.whenControl.valueChanges, { initialValue: '' });

  protected readonly chip = computed(() => segmentChip(this.engagement()?.segment));

  /** "Teste acaba amanhã · último acesso 13/11 · Só cadastro". */
  protected readonly contextLine = computed(() => {
    const e = this.engagement();
    if (!e) return '';
    return [deadlineText(e, this.now()), lastSignalText(e, this.now()), fleetText(e)]
      .filter((part) => part && part !== '—')
      .join(' · ');
  });

  private readonly today = computed(() => todayInBusinessTz(this.now()));
  protected readonly minFollowUp = computed(() => addDays(this.today(), 1));
  protected readonly maxFollowUp = computed(() => addDays(this.today(), MAX_FOLLOW_UP_AHEAD_DAYS));
  protected readonly nowLocal = computed(() => `${this.today()}T${nowHhMmInBusinessTz(this.now())}`);

  /** O dia do retorno (`yyyy-MM-dd`), ou nulo para "Sem retorno" (e sempre para "Não tem interesse"). */
  protected readonly followUpDate = computed<string | null>(() => {
    if (this.result() === 'NOT_INTERESTED') return null;
    switch (this.followUp()) {
      case 'D1':
        return addDays(this.today(), 1);
      case 'D3':
        return addDays(this.today(), 3);
      case 'D7':
        return addDays(this.today(), 7);
      case 'CUSTOM':
        return this.customDate() || null;
      default:
        return null;
    }
  });

  private readonly customDateValid = computed(() => {
    const day = this.customDate();
    return !!day && day >= this.minFollowUp() && day <= this.maxFollowUp();
  });

  /** Instante do contato informado em "Mudar data" (hora de Brasília); nulo = agora. */
  private readonly contactedAt = computed<string | null>(() => {
    const value = this.when();
    if (!this.editingWhen() || !value) return null;
    const date = new Date(`${value.length === 16 ? `${value}:00` : value}${BUSINESS_OFFSET}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  });

  private readonly whenValid = computed(() => {
    if (!this.editingWhen() || !this.when()) return true;
    const at = this.contactedAt();
    return !!at && new Date(at).getTime() <= this.now().getTime();
  });

  protected readonly whenText = computed(() => {
    const at = this.contactedAt();
    if (at) {
      const day = businessDay(at);
      return `Contato de ${dayMonth(day, this.now())}, às ${this.when().slice(11, 16)}.`;
    }
    return `Contato de hoje, ${dayMonth(this.today(), this.now())}, às ${nowHhMmInBusinessTz(this.now())}.`;
  });

  /** Novo fim do teste, pela mesma regra do servidor: max(agora, fim atual) + dias. */
  protected readonly extendHint = computed(() => {
    const deadline = this.engagement()?.deadline;
    const end = deadline && deadline.kind === 'TRIAL_ENDS' ? parseServerTime(deadline.at) : null;
    const base = end && end.getTime() > this.now().getTime() ? end : this.now();
    const until = new Date(base.getTime() + CONTACT_EXTEND_DAYS * 86_400_000);
    return `Vai até ${dayMonth(todayInBusinessTz(until), this.now())}. É o mesmo “Estender teste” do menu ⋮, com aviso por e-mail.`;
  });

  protected readonly effectText = computed(() => {
    const name = this.companyName() || 'A empresa';
    if (this.result() === 'NOT_INTERESTED') {
      return `Ao salvar, ${name} sai de “Hoje, para agir” e das sugestões até alguém registrar um contato novo.`;
    }
    const day = this.followUpDate();
    if (this.followUp() === 'NONE') {
      return `Ao salvar, ${name} sai de “Hoje, para agir” e só volta se o segmento dela mudar.`;
    }
    if (!day) return `Ao salvar, ${name} sai de “Hoje, para agir” agora e volta no dia escolhido.`;
    const weekday = weekdayName(day);
    if (this.followUp() === 'D1') {
      return `Ao salvar, ${name} sai de “Hoje, para agir” agora e volta amanhã, ${weekday}, ${dayMonth(day, this.now())}.`;
    }
    const article = weekday === 'sábado' || weekday === 'domingo' ? 'no' : 'na';
    return `Ao salvar, ${name} sai de “Hoje, para agir” agora e volta ${article} ${weekday}, ${dayMonth(day, this.now())}.`;
  });

  protected readonly canSubmit = computed(() => {
    if (this.saving()) return false;
    if (this.result() !== 'NOT_INTERESTED' && this.followUp() === 'CUSTOM' && !this.customDateValid()) return false;
    return this.whenValid();
  });

  protected pickResult(value: ContactLogResult): void {
    this.result.set(value);
  }

  /** O corpo do POST: opcionais vazios ficam de fora (o servidor trata ausente como "sem"). */
  buildRequest(): RegisterContactRequest {
    const body: RegisterContactRequest = { channel: this.channel(), result: this.result() };
    const note = this.noteControl.value.trim();
    if (note) body.note = note;
    const follow = this.followUpDate();
    if (follow) body.followUpDate = follow;
    const at = this.contactedAt();
    if (at) body.contactedAt = at;
    if (this.canExtend() && this.extend()) {
      body.extendTrialDays = CONTACT_EXTEND_DAYS;
      body.extendTrialReason = 'NEGOTIATION';
    }
    return body;
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);
    this.segments
      .registerContact(this.companyId(), this.buildRequest())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.saved.emit(res);
          this.sheet().requestClose(true);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível registrar o contato.'));
        },
      });
  }
}
