import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../../components/core/actions-menu/actions-menu';
import { PageCard } from '../../../components/core/page-card/page-card';
import { StatusChip, type StatusChipTone } from '../../../components/core/status-chip/status-chip';
import { DataListMenuItem } from '../../../components/lists/data-list/data-list-menu-item';
import type { CompanyEngagement, TodayList } from '../../../types/admin-segments.types';
import {
  dayMonth,
  deadlineText,
  isTrialSegment,
  lastContactHead,
  nextActionTitle,
  segmentChip,
  trialActionLabel,
  whatsAppMessage,
} from '../segments/segment-copy';

/** Quem a ação do menu atinge: o bastante para WhatsApp, Registrar contato e Estender teste. */
export interface CompanyActionTarget {
  companyId: string;
  name: string;
  ownerName: string | null;
  engagement: CompanyEngagement | null;
}

interface TodayTile extends CompanyActionTarget {
  title: string;
  deadline: string;
  chipLabel: string | null;
  chipTone: StatusChipTone;
  message: string | null;
  trial: boolean;
  trialLabel: string;
}

/** Cartões visíveis com a faixa fechada (pedido do dono, 19/11: curta e acionável). */
export const TODAY_STRIP_TOP = 5;

interface SnoozedRow extends CompanyActionTarget {
  contact: string | null;
  back: string;
}

/**
 * "Hoje, para agir" (Empresas, 18/11/2026): a fila do dia vinda do servidor, na ordem dele
 * (prazo e dinheiro primeiro), e logo abaixo "Com contato registrado" — quem saiu da fila por um
 * contato e volta na data do retorno. Cada cartão tem o mesmo ⋮ da linha da lista; nenhuma ação
 * fica solta na tela.
 */
@Component({
  selector: 'app-today-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageCard, StatusChip, ActionsMenu, DataListMenuItem, AlertBanner, RouterLink],
  host: { class: 'block' },
  template: `
    <app-page-card title="Hoje, para agir" class="enter-up">
      <div class="p-3 sm:p-4 flex flex-col gap-4" data-testid="today-strip">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p class="m-0 text-sm text-fg-subtle" data-testid="today-summary">{{ summary() }}</p>
          @if (tiles().length > top) {
            <button
              type="button"
              class="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-fg-soft underline-offset-4
                     hover:text-fg hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              [attr.aria-expanded]="expanded()"
              aria-controls="today-row"
              (click)="expanded.set(!expanded())"
              data-testid="today-toggle"
            >{{ expanded() ? 'Ver só as ' + top + ' primeiras' : 'Ver todas (' + tiles().length + ')' }}</button>
          }
        </div>

        @if (error(); as err) {
          <app-alert-banner variant="error" [message]="err" />
        }

        @if (loading() && !data()) {
          <div class="flex gap-2.5 overflow-hidden" aria-hidden="true">
            @for (n of skeleton; track n) {
              <div class="h-24 w-[272px] shrink-0 rounded-2xl bg-surface-sunken animate-pulse motion-reduce:animate-none"></div>
            }
          </div>
        } @else if (tiles().length > 0) {
          <ol
            class="-mx-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]
                   sm:-mx-4 sm:px-4 lg:[scrollbar-width:thin]"
            id="today-row"
            aria-label="Empresas para agir hoje"
            data-testid="today-row"
          >
            @for (t of shownTiles(); track t.companyId) {
              <li
                class="enter-up relative flex w-[272px] shrink-0 snap-start items-start gap-2.5 rounded-2xl bg-surface-muted p-3"
                [style.--stagger-i]="$index"
                data-testid="today-tile"
              >
                <span class="grid size-[26px] shrink-0 place-items-center rounded-full bg-surface-strong text-xs font-bold text-fg tabular-nums">{{ $index + 1 }}</span>
                <span class="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <a
                    [routerLink]="['/admin/companies', t.companyId]"
                    class="max-w-full text-sm font-semibold text-fg [overflow-wrap:anywhere] hover:underline rounded-sm
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >{{ t.name }}</a>
                  <span class="text-xs text-fg-subtle">{{ t.title }}</span>
                  @if (t.deadline !== '—') {
                    <span class="text-xs text-fg-subtle">{{ t.deadline }}</span>
                  }
                  @if (t.chipLabel) {
                    <app-status-chip size="sm" class="whitespace-nowrap" [tone]="t.chipTone">{{ t.chipLabel }}</app-status-chip>
                  }
                </span>
                <span class="-mr-2 -mt-2 shrink-0">
                  <app-actions-menu [label]="'Ações da empresa ' + t.name" [menuWidth]="300">
                    @if (canContact()) {
                      <button type="button" dataListMenuItem (click)="whatsApp.emit(t)" data-testid="today-whatsapp">
                        <span class="flex min-w-0 flex-col">
                          <span class="font-semibold text-fg">WhatsApp com mensagem pronta</span>
                          <small class="line-clamp-2 text-xs text-fg-subtle">{{ t.message ?? 'Sem mensagem pronta' }}</small>
                        </span>
                      </button>
                      <button type="button" dataListMenuItem (click)="contact.emit(t)" data-testid="today-contact">
                        <span class="flex flex-col">
                          <span class="font-semibold text-fg">Registrar contato</span>
                          <small class="text-xs text-fg-subtle">Tira de “Hoje, para agir” até o retorno</small>
                        </span>
                      </button>
                    }
                    @if (t.trial && canExtend()) {
                      <button type="button" dataListMenuItem (click)="extend.emit(t)" data-testid="today-extend">
                        <span class="font-semibold text-fg">{{ t.trialLabel }}</span>
                      </button>
                    }
                    <a dataListMenuItem [routerLink]="['/admin/companies', t.companyId]">
                      <span class="font-semibold text-fg">Ver detalhe</span>
                    </a>
                  </app-actions-menu>
                </span>
              </li>
            }
          </ol>
        } @else if (data()) {
          <p class="m-0 rounded-2xl bg-surface-muted px-4 py-6 text-center text-sm text-fg-subtle" data-testid="today-empty">
            Ninguém para chamar hoje. Quem tem retorno marcado aparece aqui no dia.
          </p>
        }

        @if (snoozed().length > 0) {
          <div class="flex flex-col gap-2 rounded-2xl bg-surface-muted px-4 py-3" data-testid="today-snoozed">
            <span class="text-xs text-fg-subtle">Com contato registrado · saem daqui e voltam na data do retorno</span>
            @for (s of snoozed(); track s.companyId) {
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm" data-testid="snoozed-row">
                <a
                  [routerLink]="['/admin/companies', s.companyId]"
                  class="font-semibold text-fg hover:underline rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >{{ s.name }}</a>
                @if (s.contact) {
                  <span class="text-fg-soft">{{ s.contact }}</span>
                }
                <app-status-chip size="sm" tone="blue">{{ s.back }}</app-status-chip>
              </div>
            }
          </div>
        }

        @if (optedOut() > 0) {
          <p class="m-0 text-xs text-fg-subtle" data-testid="today-opted-out">{{ optedOutText() }}</p>
        }

        @if ((data()?.notInterestedCount ?? 0) > 0) {
          <p class="m-0 text-xs text-fg-subtle" data-testid="today-not-interested">
            {{ notInterestedText() }}
          </p>
        }
      </div>
    </app-page-card>
  `,
})
export class TodayStrip {
  readonly data = input<TodayList | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** `contato.ver`: WhatsApp e Registrar contato. */
  readonly canContact = input(false);
  /** `empresa.teste`: Estender/Reabrir teste. */
  readonly canExtend = input(false);
  /** Relógio injetável para os testes. */
  readonly now = input<Date>(new Date());

  readonly whatsApp = output<CompanyActionTarget>();
  readonly contact = output<CompanyActionTarget>();
  readonly extend = output<CompanyActionTarget>();

  protected readonly skeleton = [1, 2, 3, 4, 5];
  /** Quantos cartões a faixa mostra fechada; "Ver todas (N)" abre o resto na mesma fileira. */
  protected readonly top = TODAY_STRIP_TOP;
  protected readonly expanded = signal(false);

  /**
   * Quem pediu para não receber mensagem de retenção (`retentionEmailOptOut`, FEAT-0078) não é
   * sugestão de contato: sai da faixa e vira só um número, como "não tem interesse". Conta interna
   * (de teste) já não vem do servidor (`today.status = INTERNAL`); marcar como interna é o caminho.
   */
  private readonly suggested = computed(() =>
    (this.data()?.items ?? []).filter((item) => !item.engagement?.retentionEmailOptOut),
  );
  protected readonly optedOut = computed(
    () => (this.data()?.items.length ?? 0) - this.suggested().length,
  );

  /** Na ordem do servidor; o número do cartão é a posição na faixa (sem buraco de quem saiu). */
  protected readonly tiles = computed<TodayTile[]>(() =>
    this.suggested().map((item) => {
      const chip = segmentChip(item.engagement?.segment);
      return {
        companyId: item.companyId,
        name: item.name,
        ownerName: item.ownerName,
        engagement: item.engagement,
        title: nextActionTitle(item.engagement) ?? '—',
        deadline: deadlineText(item.engagement, this.now()),
        chipLabel: chip?.label ?? null,
        chipTone: chip?.tone ?? 'neutral',
        message: whatsAppMessage(item.engagement, item.name, item.ownerName, this.now()),
        trial: isTrialSegment(item.engagement?.segment),
        trialLabel: trialActionLabel(item.engagement?.segment),
      };
    }),
  );

  protected readonly shownTiles = computed(() =>
    this.expanded() ? this.tiles() : this.tiles().slice(0, TODAY_STRIP_TOP),
  );

  protected readonly snoozed = computed<SnoozedRow[]>(() =>
    (this.data()?.snoozed ?? []).map((s) => {
      const back = s.engagement?.today?.hiddenUntil;
      return {
        companyId: s.companyId,
        name: s.name,
        ownerName: s.ownerName,
        engagement: s.engagement,
        contact: lastContactHead(s.engagement, this.now()),
        back: back ? `volta em ${dayMonth(back, this.now())}` : 'volta se o segmento mudar',
      };
    }),
  );

  protected readonly summary = computed(() => {
    const n = this.tiles().length;
    if (!this.data()) return 'Quem chamar hoje, prazo e dinheiro primeiro.';
    if (n === 0) return 'Nenhuma empresa na fila hoje.';
    return `${n} ${n === 1 ? 'empresa' : 'empresas'}, prazo e dinheiro primeiro.`;
  });

  protected readonly optedOutText = computed(() => {
    const n = this.optedOut();
    return n === 1
      ? '1 empresa pediu para não receber mensagens de retenção e ficou fora das sugestões.'
      : `${n} empresas pediram para não receber mensagens de retenção e ficaram fora das sugestões.`;
  });

  protected readonly notInterestedText = computed(() => {
    const n = this.data()?.notInterestedCount ?? 0;
    return n === 1
      ? '1 empresa disse que não tem interesse e saiu das sugestões.'
      : `${n} empresas disseram que não têm interesse e saíram das sugestões.`;
  });
}
