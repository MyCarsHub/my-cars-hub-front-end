import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { NotificationService } from '../../services/notification.service';
import { applyPtBrMoneyMask } from '../../utils/ptbr-money-mask';
import { formatPtBrMoney, parsePtBrMoneyCents } from '../../utils/ptbr-number';
import { brl, brl0, ddmm, goalTargets } from './driver-finance.calc';
import { DriverFinanceClock } from './driver-finance.clock';
import { DriverFinanceSource } from './driver-finance.source';
import { DriverGoalsState, GoalProgress, LoadState } from './driver-finance.types';
import * as ui from './driver-finance.ui';
import { ArrowSelect } from './arrow-select';

/** The server's ceiling (`DriverGoalsRequestDto`): R$ 99.999,00 per day. */
const MAX_DAILY_GOAL_CENTS = 9_999_900;

/**
 * Metas — progress of today, the week and the month against the goal, the form that
 * defines it (daily goal + work days; weekly = daily × days, monthly = weekly × 4) and the
 * last four closed weeks. All the progress is the server's (`GET /v1/driver/goals`); the
 * form saves `{ dailyGoalCents, workDaysPerWeek }` and the answer brings the new progress.
 */
@Component({
  selector: 'app-driver-goals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, ArrowSelect],
  providers: [DriverFinanceClock],
  host: { class: 'block' },
  template: `
    <section [class]="ui.PAGE" aria-labelledby="goals-title">
      <div [class]="ui.STACK">
        <header class="flex flex-col gap-1">
          <h1 id="goals-title" [class]="ui.H1">Metas</h1>
          <p [class]="ui.LEAD">Quanto você quer ganhar.</p>
        </header>

        @switch (state()) {
          @case ('error') {
            <app-alert-banner variant="error" data-state="error">
              Não foi possível carregar suas metas.
              <button type="button" (click)="load()" [class]="ui.RETRY">Tentar novamente</button>
            </app-alert-banner>
          }
          @case ('loading') {
            <div aria-hidden="true" data-state="loading" class="flex flex-col gap-4">
              <div [class]="ui.SKELETON + ' h-36'"></div>
              <div [class]="ui.SKELETON + ' h-52'"></div>
              <div [class]="ui.SKELETON + ' h-60'"></div>
            </div>
            <span class="sr-only" role="status">Carregando metas…</span>
          }
          @default {
            <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
              @for (p of progress(); track p.label) {
                <div [class]="ui.CARD + ' px-4 sm:px-6 py-5 flex flex-col gap-3'" [attr.data-progress]="p.key">
                  <span [class]="ui.EYEBROW">{{ p.label }}</span>
                  <div class="flex items-baseline gap-1.5 flex-wrap">
                    <span class="text-2xl font-bold tabular-nums text-neutral-900">{{ p.value }}</span>
                    @if (p.goal) {
                      <span class="text-sm text-neutral-500">de {{ p.goal }}</span>
                    }
                  </div>
                  <div role="progressbar" [attr.aria-label]="p.label" aria-valuemin="0" aria-valuemax="100"
                    [attr.aria-valuenow]="p.pct" class="h-2 rounded bg-neutral-100">
                    <div class="h-2 rounded bg-success-500" [style.width.%]="p.pct"></div>
                  </div>
                  <span class="text-[13px] text-neutral-600">{{ p.status }}</span>
                </div>
              }
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              <div [class]="ui.CARD">
                <div class="px-4 sm:px-6 pt-5 pb-2">
                  <h2 [class]="ui.H2">Definir metas</h2>
                  <p class="mt-0.5 mb-0 text-[13px] text-neutral-500">Aparecem no seu Dashboard.</p>
                </div>
                <form novalidate (submit)="$event.preventDefault(); save()"
                  class="px-4 sm:px-6 pt-2 pb-6 flex flex-col gap-5">
                  <div class="flex flex-col gap-2">
                    <label for="goal-daily" class="text-sm font-medium text-neutral-800">Meta por dia (R$)</label>
                    <input id="goal-daily" data-field="daily" inputmode="decimal" autocomplete="off" placeholder="0,00"
                      [value]="daily()" (input)="onDaily($event)"
                      [attr.aria-invalid]="dailyError() ? 'true' : null"
                      [attr.aria-describedby]="dailyError() ? 'goal-daily-error' : null"
                      class="min-h-12 w-full rounded-xl border bg-white px-3 text-base text-neutral-800 tabular-nums
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      [class]="dailyError() ? 'border-rose-400' : 'border-neutral-200'" />
                    @if (dailyError(); as message) {
                      <span id="goal-daily-error" role="alert" class="text-xs text-rose-700">{{ message }}</span>
                    }
                  </div>
                  <div class="flex flex-col gap-2">
                    <span id="goal-days-label" class="text-sm font-medium text-neutral-800">Dias de trabalho por semana</span>
                    <div role="radiogroup" aria-labelledby="goal-days-label" appArrowSelect class="flex flex-wrap gap-2">
                      @for (n of dayOptions; track n) {
                        <button type="button" role="radio" [attr.data-days]="n" [attr.aria-checked]="days() === n" [attr.tabindex]="days() === n ? 0 : -1"
                          (click)="selectDays(n)" [class]="(days() === n ? ui.CHIP_ON : ui.CHIP_OFF) + ' min-w-11'">{{ n }}</button>
                      }
                    </div>
                  </div>
                  <dl class="m-0 rounded-xl bg-neutral-100 px-4 py-3 grid grid-cols-2 gap-3">
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <dt [class]="ui.EYEBROW">Meta semanal</dt>
                      <dd class="m-0 text-lg font-semibold tabular-nums text-neutral-900" data-week-goal>{{ preview().week }}</dd>
                    </div>
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <dt [class]="ui.EYEBROW">Meta mensal</dt>
                      <dd class="m-0 text-lg font-semibold tabular-nums text-neutral-900" data-month-goal>{{ preview().month }}</dd>
                    </div>
                  </dl>
                  @if (saveError()) {
                    <app-alert-banner variant="error" message="Não foi possível salvar. Tente novamente." />
                  }
                  <button type="submit" data-action="save" [disabled]="saving()"
                    [class]="ui.BTN_PRIMARY + ' w-full min-h-12 disabled:opacity-60'">Salvar metas</button>
                </form>
              </div>

              <div [class]="ui.CARD">
                <div class="px-4 sm:px-6 pt-5 pb-2">
                  <h2 [class]="ui.H2">Últimas semanas</h2>
                  <p class="mt-0.5 mb-0 text-[13px] text-neutral-500">Quanto você ganhou em relação à meta.</p>
                </div>
                <ul class="m-0 list-none px-4 sm:px-6 pt-1 pb-3">
                  @for (w of weeks(); track w.range) {
                    <li class="flex items-center gap-3 py-3 border-t border-neutral-100 min-h-14">
                      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span class="text-sm font-medium text-neutral-900">{{ w.range }}</span>
                        <span class="text-[13px] text-neutral-500 tabular-nums">{{ w.text }}</span>
                      </div>
                      @if (w.tag) {
                        <span class="text-sm font-semibold" [class]="w.hit ? 'text-success-900' : 'text-neutral-600'">{{ w.tag }}</span>
                      }
                    </li>
                  }
                </ul>
              </div>
            </div>
          }
        }
      </div>
    </section>
  `,
})
export class DriverGoalsPage {
  private readonly source = inject(DriverFinanceSource);
  /** A signal: the page re-reads when the day turns over with it open. */
  private readonly today = inject(DriverFinanceClock).today;
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ui = ui;
  protected readonly dayOptions = [1, 2, 3, 4, 5, 6, 7];

  protected readonly state = signal<LoadState>('loading');
  /** The server's goal + progress (`GET/PUT /v1/driver/goals`). */
  protected readonly goals = signal<DriverGoalsState | null>(null);
  /** Form state: the masked pt-BR text ("150,50"), parsed to cents — never whole reais. */
  protected readonly daily = signal('');
  protected readonly days = signal(6);
  protected readonly dailyError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);

  private readonly dailyCents = computed(() => parsePtBrMoneyCents(this.daily().trim()).scaled ?? 0);

  /** Preview of what the form would save (weekly = daily × days; monthly = weekly × 4). */
  protected readonly preview = computed(() => {
    const t = goalTargets(this.dailyCents(), this.days());
    return { week: brl(t.week), month: brl(t.month) };
  });

  /** Today / week / month: the server's progress, as is. */
  protected readonly progress = computed(() => {
    const g = this.goals();
    const set = !!g?.goal;
    const card = (key: 'day' | 'week' | 'month', label: string, p: GoalProgress | undefined) => {
      const income = p?.incomeCents ?? 0;
      const goal = set ? (p?.goalCents ?? 0) : 0;
      const pct = goal ? Math.min(100, p?.percent ?? 0) : 0;
      const status = !goal
        ? 'Defina uma meta.'
        : p?.reached
          ? 'Meta batida.'
          : `${p?.percent ?? 0}% da meta · faltam ${brl0(goal - income)}`;
      return { key, label, value: brl0(income), goal: goal ? brl0(goal) : '', pct, status };
    };
    return [
      card('day', 'Hoje', g?.today),
      card('week', 'Semana', g?.week),
      card('month', 'Mês', g?.month),
    ];
  });

  /** The four closed weeks before this one, newest first (the server sends oldest first). */
  protected readonly weeks = computed(() => {
    const g = this.goals();
    const set = !!g?.goal;
    return [...(g?.lastWeeks ?? [])].reverse().map((w) => ({
      range: `${ddmm(w.from)} a ${ddmm(w.to)}`,
      text: set ? `${brl0(w.incomeCents)} de ${brl0(w.goalCents)}` : brl0(w.incomeCents),
      tag: set ? (w.reached ? 'Atingida' : 'Abaixo') : '',
      hit: set && w.reached,
    }));
  });

  constructor() {
    // First load; when "hoje" turns over only the PROGRESS is re-read, in place: the
    // screen does not go back to "carregando" and a goal being typed is not overwritten.
    let first = true;
    effect(() => {
      this.today();
      untracked(() => (first ? this.load() : this.refreshProgress()));
      first = false;
    });
  }

  /** Re-reads the progress; the form follows only if the driver has not touched it. */
  private refreshProgress(): void {
    if (this.state() !== 'ready') return;
    this.source
      .goals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.goals.set(state);
          if (!this.dirty) this.fillForm(state);
        },
        error: () => undefined, // the progress on screen stays; the next turn retries
      });
  }

  private fillForm(state: DriverGoalsState): void {
    this.daily.set(state.goal ? formatPtBrMoney(state.goal.dailyGoal) : '');
    this.days.set(state.goal?.workDaysPerWeek ?? 6);
  }

  /** The driver changed the form since the last load or save. */
  private dirty = false;

  protected selectDays(n: number): void {
    this.days.set(n);
    this.dirty = true;
  }

  load(): void {
    this.dirty = false;
    this.state.set('loading');
    this.source
      .goals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.goals.set(state);
          this.fillForm(state);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected onDaily(event: Event): void {
    this.daily.set(applyPtBrMoneyMask(event, this.daily()).value);
    this.dailyError.set(null);
    this.dirty = true;
  }

  save(): void {
    if (this.saving()) return;
    const cents = this.dailyCents();
    if (!cents) {
      this.dailyError.set('Informe um valor maior que zero.');
      return;
    }
    if (cents > MAX_DAILY_GOAL_CENTS) {
      this.dailyError.set('Meta acima de R$ 99.999,00 por dia. Confira os zeros.');
      return;
    }
    this.saving.set(true);
    this.saveError.set(false);
    this.source
      .saveGoals({ dailyGoal: this.dailyCents(), workDaysPerWeek: this.days() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          this.goals.set(state);
          this.dirty = false;
          this.saving.set(false);
          this.notify.success('Metas salvas.');
        },
        error: () => {
          this.saving.set(false);
          this.saveError.set(true);
        },
      });
  }
}
