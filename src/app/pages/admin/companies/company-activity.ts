import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { StatusChip } from '../../../components/core/status-chip/status-chip';
import {
  FilterChipGroup,
  type FilterChipOption,
} from '../../../components/filter-chip-group/filter-chip-group';
import { ApiErrorService } from '../../../services/api-error.service';
import type { PagedResponse } from '../../../types/paged.types';
import type { ActivityFilter, ActivityItem } from '../../../types/admin-segments.types';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { activityLine } from '../segments/segment-copy';

const PAGE_SIZE = 20;

const FILTERS: readonly FilterChipOption<ActivityFilter>[] = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'ACTION', label: 'Ações da empresa' },
  { value: 'CONTACT', label: 'Contatos' },
  { value: 'SUBSCRIPTION', label: 'Assinatura' },
];

/**
 * Atividade da empresa (detalhe, 18/11/2026): ações reais, acessos, contatos e assinatura, do
 * mais novo para o mais antigo. A primeira página vem dentro do detalhe (`activity`); trocar o
 * filtro ou "Ver mais" pede `GET /activity`. As ações da equipe (modo edição, cancelamentos do
 * admin) nunca entram aqui: moram na auditoria.
 */
@Component({
  selector: 'app-company-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, FilterChipGroup, StatusChip, AlertBanner],
  host: { class: 'block min-w-0' },
  template: `
    <app-page-card title="Atividade" [fill]="true">
      <div class="p-4 sm:p-5 flex flex-col gap-4" data-testid="company-activity">
        <p class="m-0 text-xs text-fg-subtle">Ações reais da empresa e contatos da equipe</p>
        <app-filter-chip-group
          [options]="filters"
          [value]="filter()"
          [scrollable]="true"
          ariaLabel="Filtrar atividade"
          (selectionChange)="setFilter($event)"
        />

        @if (error(); as err) {
          <app-alert-banner variant="error" [message]="err" />
        }

        @if (loading() && items().length === 0) {
          <div class="flex flex-col gap-3" aria-hidden="true">
            @for (n of [1, 2, 3]; track n) {
              <div class="h-10 rounded-xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            }
          </div>
        } @else if (lines().length === 0) {
          <p class="m-0 text-sm text-fg-subtle" data-testid="activity-empty">Nada registrado neste filtro.</p>
        } @else {
          <ol class="flex flex-col gap-4" aria-label="Linha do tempo">
            @for (line of lines(); track $index) {
              <li class="enter-up grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3" [style.--stagger-i]="$index" data-testid="activity-item">
                <span class="pt-0.5 text-xs text-fg-subtle tabular-nums">{{ line.day }}</span>
                <span class="flex flex-col items-start gap-1.5 text-sm text-fg">
                  <span>{{ line.text }}</span>
                  @if (line.note) {
                    <span class="rounded-xl bg-surface-muted px-3 py-2 text-xs text-fg-soft" data-testid="activity-note">“{{ line.note }}”</span>
                  }
                  @if (line.chip; as chip) {
                    <app-status-chip size="sm" [tone]="chip.tone">{{ chip.label }}</app-status-chip>
                  }
                </span>
              </li>
            }
          </ol>
        }

        @if (hasMore()) {
          <button
            type="button"
            data-testid="activity-more"
            class="press self-start min-h-11 px-4 rounded-full border border-edge-field text-sm font-semibold text-fg
                   hover:bg-canvas transition-colors disabled:opacity-60
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            [disabled]="loading()"
            (click)="more()"
          >{{ loading() ? 'Carregando…' : 'Ver mais' }}</button>
        }

        <p class="m-0 text-xs text-fg-subtle">
          Fora desta lista: o que a equipe fez na conta (modo edição, cobranças canceladas pelo admin).
        </p>
      </div>
    </app-page-card>
  `,
})
export class CompanyActivity {
  private readonly segments = inject(AdminSegmentsService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly companyId = input.required<string>();
  /** Primeira página que veio no detalhe (`category=ALL`). */
  readonly initial = input<PagedResponse<ActivityItem> | null | undefined>(null);

  protected readonly filters = FILTERS;
  protected readonly filter = signal<ActivityFilter>('ALL');
  protected readonly items = signal<ActivityItem[]>([]);
  private readonly page = signal(0);
  private readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly lines = computed(() => this.items().map((item) => activityLine(item)));
  protected readonly hasMore = computed(() => this.items().length < this.total());

  constructor() {
    // O detalhe recarregou (contato novo, teste estendido): volta para "Tudo" com o que chegou.
    effect(() => {
      const first = this.initial();
      untracked(() => {
        this.filter.set('ALL');
        this.items.set(first?.content ?? []);
        this.page.set(first?.page ?? 0);
        this.total.set(first?.total ?? first?.content?.length ?? 0);
        this.error.set(null);
      });
    });
  }

  protected setFilter(value: ActivityFilter): void {
    if (value === this.filter()) return;
    this.filter.set(value);
    this.items.set([]);
    this.total.set(0);
    this.fetch(0);
  }

  protected more(): void {
    this.fetch(this.page() + 1);
  }

  private fetch(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    const filter = this.filter();
    this.segments
      .activity(this.companyId(), filter, page, PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (filter !== this.filter()) return;
          this.loading.set(false);
          this.items.update((list) => (page === 0 ? res.content : [...list, ...res.content]));
          this.page.set(res.page);
          this.total.set(res.total);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.apiErrors.messageFor(err, 'Não foi possível carregar a atividade.'));
        },
      });
  }
}
