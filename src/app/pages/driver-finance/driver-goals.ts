import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { NotificationService } from '../../services/notification.service';
import {
  addDays,
  brl0,
  ddmm,
  goalTargets,
  minIso,
  mondayOf,
  monthStart,
  percent,
  totals,
} from './driver-finance.calc';
import { DRIVER_FINANCE_TODAY, DriverFinanceSource } from './driver-finance.source';
import { DriverGoals, LedgerItem, LoadState } from './driver-finance.types';
import * as ui from './driver-finance.ui';

/**
 * Metas — progress of today, the week and the month against the goal, the form that
 * defines it (daily goal + work days; weekly = daily × days, monthly = weekly × 4) and the
 * last four closed weeks. The progress is derived from the ledger: the server stores only
 * `{ dailyGoal, workDaysPerWeek }`.
 */
@Component({
  selector: 'app-driver-goals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner],
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
                    <input id="goal-daily" data-field="daily" inputmode="numeric" autocomplete="off"
                      [value]="daily()" (input)="onDaily($event)"
                      [attr.aria-invalid]="dailyError() ? 'true' : null"
                      [attr.aria-describedby]="dailyError() ? 'goal-daily-error' : null"
                      class="min-h-12 w-full rounded-xl border bg-white px-3 text-base text-neutral-800 tabular-nums
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      [class]="dailyError() ? 'border-rose-400' : 'border-neutral-200'" />
                    @if (dailyError()) {
                      <span id="goal-daily-error" role="alert" class="text-xs text-rose-700">
                        Informe um valor maior que zero.
                      </span>
                    }
                  </div>
                  <div class="flex flex-col gap-2">
                    <span id="goal-days-label" class="text-sm font-medium text-neutral-800">Dias de trabalho por semana</span>
                    <div role="radiogroup" aria-labelledby="goal-days-label" class="flex flex-wrap gap-2">
                      @for (n of dayOptions; track n) {
                        <button type="button" role="radio" [attr.data-days]="n" [attr.aria-checked]="days() === n"
                          (click)="days.set(n)" [class]="(days() === n ? ui.CHIP_ON : ui.CHIP_OFF) + ' min-w-11'">{{ n }}</button>
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
  private readonly today = inject(DRIVER_FINANCE_TODAY);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ui = ui;
  protected readonly dayOptions = [1, 2, 3, 4, 5, 6, 7];

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<LedgerItem[]>([]);
  /** Saved goals; drive the progress cards. */
  protected readonly goals = signal<DriverGoals | null>(null);
  /** Form state, in whole reais (the prototype's field). */
  protected readonly daily = signal('');
  protected readonly days = signal(6);
  protected readonly dailyError = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);

  private readonly dailyCents = computed(() => (Number(this.daily()) || 0) * 100);

  protected readonly preview = computed(() => {
    const t = goalTargets(this.dailyCents(), this.days());
    return { week: brl0(t.week), month: brl0(t.month) };
  });

  protected readonly progress = computed(() => {
    const today = this.today();
    const items = this.items();
    const g = this.goals();
    const t = g ? goalTargets(g.dailyGoal, g.workDaysPerWeek) : null;
    const done = {
      day: totals(items, today, today, today).gross,
      week: totals(items, mondayOf(today), today, today).gross,
      month: totals(items, monthStart(today), today, today).gross,
    };
    const card = (key: 'day' | 'week' | 'month', label: string, goal: number | null) => {
      const pct = goal ? percent(done[key], goal) : 0;
      const status = !goal
        ? 'Defina uma meta.'
        : done[key] >= goal
          ? 'Meta batida.'
          : `${pct}% da meta · faltam ${brl0(goal - done[key])}`;
      return { key, label, value: brl0(done[key]), goal: goal ? brl0(goal) : '', pct, status };
    };
    return [
      card('day', 'Hoje', t?.day ?? null),
      card('week', 'Semana', t?.week ?? null),
      card('month', 'Mês', t?.month ?? null),
    ];
  });

  /** The four closed weeks before this one, newest first. */
  protected readonly weeks = computed(() => {
    const today = this.today();
    const g = this.goals();
    const weekGoal = g ? goalTargets(g.dailyGoal, g.workDaysPerWeek).week : 0;
    const thisMonday = mondayOf(today);
    return [1, 2, 3, 4].map((n) => {
      const from = addDays(thisMonday, -7 * n);
      const to = addDays(from, 6);
      const got = totals(this.items(), from, to, today).gross;
      const hit = weekGoal > 0 && got >= weekGoal;
      return {
        range: `${ddmm(from)} a ${ddmm(to)}`,
        text: weekGoal ? `${brl0(got)} de ${brl0(weekGoal)}` : brl0(got),
        tag: weekGoal ? (hit ? 'Atingida' : 'Abaixo') : '',
        hit,
      };
    });
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.state.set('loading');
    const today = this.today();
    const from = minIso(monthStart(today), addDays(mondayOf(today), -28));
    forkJoin({
      goals: this.source.goals(),
      items: this.source.list({ from, to: today, type: 'INCOME' }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ goals, items }) => {
          this.items.set(items);
          this.goals.set(goals);
          this.daily.set(goals ? String(Math.round(goals.dailyGoal / 100)) : '');
          this.days.set(goals?.workDaysPerWeek ?? 6);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected onDaily(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(0, 5);
    input.value = value;
    this.daily.set(value);
    this.dailyError.set(false);
  }

  save(): void {
    if (this.saving()) return;
    if (!this.dailyCents()) {
      this.dailyError.set(true);
      return;
    }
    this.saving.set(true);
    this.saveError.set(false);
    this.source
      .saveGoals({ dailyGoal: this.dailyCents(), workDaysPerWeek: this.days() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (goals) => {
          this.goals.set(goals);
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
