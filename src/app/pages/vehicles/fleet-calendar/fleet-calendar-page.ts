import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { FleetCalendarService } from '../../../services/fleet-calendar.service';
import { VehiclesService } from '../../../services/vehicles.service';
import { FleetCalendarResponse } from '../../../types/fleet-calendar.types';
import { VehicleListItem } from '../../../types/vehicle.types';
import {
  FleetGrid,
  GridBlock,
  GridLane,
  MAX_WINDOW_DAYS,
  addDays,
  buildGrid,
  exceedsWindowLimit,
  longDate,
  shortDate,
  toEpochDay,
  windowDays,
} from './fleet-calendar.grid';

/** Período pré-definido. `CUSTOM` libera as duas datas — e o teto de 366 dias. */
export type PeriodMode = 'WEEK' | 'MONTH' | 'QUARTER' | 'CUSTOM';

export const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodMode; label: string }> = [
  { value: 'WEEK', label: 'Semana' },
  { value: 'MONTH', label: 'Mês' },
  { value: 'QUARTER', label: 'Trimestre' },
  { value: 'CUSTOM', label: 'Personalizado' },
];

/**
 * A mensagem NOMEIA o limite. "Erro de requisição" deixaria o usuário sem saber
 * o que encurtar; o backend recusa a janela **antes** de consultar, então essa é
 * a única informação acionável que existe.
 */
export const WINDOW_TOO_WIDE_MESSAGE =
  `O período máximo é de ${MAX_WINDOW_DAYS} dias (um ano). ` +
  'Escolha um intervalo menor para ver a ocupação.';

export const INVERTED_WINDOW_MESSAGE =
  'A data inicial precisa ser anterior ou igual à final.';

export const INCOMPLETE_WINDOW_MESSAGE = 'Informe as duas datas do período personalizado.';

const LOAD_FAILURE_MESSAGE = 'Não foi possível carregar o calendário da frota.';
const VEHICLE_NOT_FOUND_MESSAGE =
  'Veículo não encontrado nesta empresa. Limpe o filtro para ver a frota inteira.';

/** Altura de uma sub-faixa e o respiro entre elas, em px. */
const SUBLANE_HEIGHT = 26;
const SUBLANE_GAP = 4;

/**
 * Largura mínima da barra em % a partir da qual o rótulo textual cabe dentro
 * dela. Abaixo disso só o ícone é desenhado e o texto vive no nome acessível.
 */
const LABEL_MIN_PERCENT = 14;

// -------------------------------------------------------------- período

function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Soma meses ao dia 1 de `iso`. Só é chamado com âncoras já no dia 1. */
function addMonths(iso: string, months: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + months;
  const target = new Date(Date.UTC(year, month, 1));
  return target.toISOString().slice(0, 10);
}

/** Segunda-feira da semana que contém `iso` (epoch day 0 = quinta-feira). */
function startOfWeek(iso: string): string {
  const weekday = (((toEpochDay(iso) + 3) % 7) + 7) % 7;
  return addDays(iso, -weekday);
}

interface DateWindow {
  readonly from: string;
  readonly to: string;
}

/** Janela `[from, to]` de um modo + âncora. `null` quando o custom está incompleto. */
function windowFor(
  mode: PeriodMode,
  anchor: string,
  customFrom: string,
  customTo: string,
): DateWindow | null {
  switch (mode) {
    case 'WEEK':
      return { from: anchor, to: addDays(anchor, 6) };
    case 'MONTH':
      return { from: anchor, to: addDays(addMonths(anchor, 1), -1) };
    case 'QUARTER':
      return { from: anchor, to: addDays(addMonths(anchor, 3), -1) };
    case 'CUSTOM':
      return customFrom && customTo ? { from: customFrom, to: customTo } : null;
  }
}

// ------------------------------------------------------- view-model da barra

/** Barra pronta para render — classes, nome acessível e destino já resolvidos. */
export interface RenderBlock extends GridBlock {
  readonly classes: string;
  /** `background-image` do padrão listrado/hachurado. `null` = preenchimento liso. */
  readonly pattern: string | null;
  readonly ariaLabel: string;
  readonly title: string;
  readonly routerLink: readonly string[] | null;
  readonly topPx: number;
  readonly showLabel: boolean;
  readonly text: string;
}

export interface RenderLane extends Omit<GridLane, 'blocks'> {
  readonly blocks: readonly RenderBlock[];
  readonly heightPx: number;
  /** `"Parado 12 dias (06/08 – 17/08)"` ou `null` quando abaixo do limiar. */
  readonly idleLabel: string | null;
}

const KIND_LABEL: Record<GridBlock['kind'], string> = {
  RENTAL: 'Aluguel',
  MAINTENANCE: 'Manutenção',
  OTHER: 'Indisponível',
};

const RENTAL_STATUS_LABEL: Record<string, string> = {
  RESERVED: 'Reservado',
  ACTIVE: 'Ativo',
  COMPLETED: 'Concluído',
};

const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
};

/** Listras a 45° — o padrão que distingue "reservado" de "ativo" sem depender de cor. */
const STRIPES =
  'repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 4px, transparent 4px 8px)';
/** Hachura mais fechada e em sentido oposto: a leitura de "manutenção". */
const HATCH =
  'repeating-linear-gradient(-45deg, rgba(255,255,255,.6) 0 3px, transparent 3px 6px)';

const BLOCK_BASE =
  'absolute inline-flex items-center gap-1 overflow-hidden px-1.5 text-[11px] font-semibold ' +
  'leading-none whitespace-nowrap transition-shadow hover:shadow-md ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';

/**
 * Forma + padrão + ícone carregam a distinção; a cor apenas reforça.
 * Aluguel é PÍLULA, manutenção é RETÂNGULO reto — a diferença sobrevive em
 * escala de cinza e para quem não distingue matiz.
 */
function blockChrome(block: GridBlock): { classes: string; pattern: string | null } {
  if (block.kind === 'MAINTENANCE') {
    return {
      classes: 'rounded-none border-2 border-rose-800 bg-rose-600 text-white',
      pattern: HATCH,
    };
  }
  if (block.kind === 'OTHER') {
    return { classes: 'rounded-md border-2 border-neutral-700 bg-neutral-500 text-white', pattern: null };
  }
  switch (block.status) {
    case 'RESERVED':
      // Contorno tracejado + listras: "ainda não começou".
      return {
        classes: 'rounded-full border-2 border-dashed border-amber-700 bg-amber-500 text-amber-950',
        pattern: STRIPES,
      };
    case 'COMPLETED':
      // Vazado: o dia já passou, a barra não deve competir com as vigentes.
      return {
        classes: 'rounded-full border-2 border-neutral-500 bg-neutral-50 text-neutral-700',
        pattern: null,
      };
    default:
      return {
        classes: 'rounded-full border-2 border-blue-800 bg-blue-600 text-white',
        pattern: null,
      };
  }
}

function statusLabel(block: GridBlock): string {
  const map = block.kind === 'MAINTENANCE' ? MAINTENANCE_STATUS_LABEL : RENTAL_STATUS_LABEL;
  return map[block.status] ?? block.status;
}

/**
 * Nome acessível da barra. Carrega as DATAS REAIS do registro, inclusive quando
 * elas caem fora da janela — é o que impede a leitura por leitor de tela de
 * herdar o recorte visual e concluir que o aluguel começou no dia 1.
 */
function blockAria(block: GridBlock): string {
  const parts = [KIND_LABEL[block.kind], statusLabel(block)];
  if (block.label) parts.push(block.label);
  parts.push(`de ${longDate(block.start)} a ${longDate(block.end)}`);
  if (block.continuesBefore) parts.push('começou antes do período exibido');
  if (block.continuesAfter) parts.push('termina depois do período exibido');
  parts.push(block.kind === 'MAINTENANCE' ? 'abrir manutenção' : 'abrir aluguel');
  return parts.join(', ');
}

function blockRoute(block: GridBlock): readonly string[] | null {
  if (block.kind === 'RENTAL') return ['/alugueis', block.sourceId];
  if (block.kind === 'MAINTENANCE') return ['/manutencoes', block.sourceId];
  // `kind` é discriminador aberto: sem rota conhecida a barra vira só leitura.
  return null;
}

function toRenderBlock(block: GridBlock): RenderBlock {
  const chrome = blockChrome(block);
  const text = block.label || KIND_LABEL[block.kind];
  return {
    ...block,
    classes: [
      BLOCK_BASE,
      chrome.classes,
      // Ponta reta contra a borda da faixa: a barra CONTINUA fora da janela em
      // vez de terminar ali. A seta interna e o nome acessível completam a leitura.
      block.continuesBefore ? 'rounded-l-none border-l-0' : '',
      block.continuesAfter ? 'rounded-r-none border-r-0' : '',
    ]
      .filter(Boolean)
      .join(' '),
    pattern: chrome.pattern,
    ariaLabel: blockAria(block),
    title: `${KIND_LABEL[block.kind]} · ${statusLabel(block)} · ${longDate(block.start)} – ${longDate(block.end)}${block.label ? ` · ${block.label}` : ''}`,
    routerLink: blockRoute(block),
    topPx: block.lane * (SUBLANE_HEIGHT + SUBLANE_GAP),
    showLabel: block.widthPercent >= LABEL_MIN_PERCENT,
    text,
  };
}

function toRenderLane(lane: GridLane): RenderLane {
  const { idle } = lane;
  return {
    ...lane,
    blocks: lane.blocks.map(toRenderBlock),
    heightPx: lane.laneCount * (SUBLANE_HEIGHT + SUBLANE_GAP) - SUBLANE_GAP,
    idleLabel:
      idle.flagged && idle.longestFrom && idle.longestTo
        ? `Parado ${idle.longestRun} dias (${shortDate(idle.longestFrom)} – ${shortDate(idle.longestTo)})`
        : null,
  };
}

/**
 * `/veiculos/calendario` — ocupação da frota no tempo, uma faixa por veículo.
 *
 * ## Decisão mobile-first
 * A barra de cada veículo é **proporcional à janela** (posição e largura em %),
 * nunca uma coluna de largura fixa por dia. Um mês em colunas de 24px exigiria
 * ~750px e obrigaria a tela inteira a rolar na horizontal a 375px. Sendo
 * proporcional, a faixa sempre cabe: a 375px o rótulo do veículo fica ACIMA da
 * barra (empilhado) e a barra ocupa a largura toda; a partir de `lg` o rótulo
 * vira coluna à esquerda e a faixa segue ao lado. Nenhum scroll horizontal, nem
 * no componente nem na página.
 *
 * O preço dessa escolha é a densidade: um bloco de um dia num trimestre fica
 * fino. Compensa-se com largura mínima de 24px na barra (alvo de toque de
 * WCAG 2.5.8), ícone + forma distintos por origem e a data real no nome
 * acessível — quem precisa do dia exato toca a barra e cai no registro.
 *
 * ## Ociosidade
 * Ver `fleet-calendar.grid.ts:computeIdle()` — medida ESTRITAMENTE dentro da
 * janela, porque o backend só devolve o que a intersecta.
 */
@Component({
  selector: 'app-fleet-calendar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DefaultPageLayout, PageCard, AlertBanner],
  templateUrl: './fleet-calendar-page.html',
})
export class FleetCalendarPage implements OnInit {
  private readonly calendarService = inject(FleetCalendarService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly maxWindowDays = MAX_WINDOW_DAYS;
  protected readonly sublaneHeight = SUBLANE_HEIGHT;
  /**
   * Piso de largura da barra, em px — o alvo de toque mínimo de WCAG 2.5.8.
   * Sem ele, uma manutenção de um dia num trimestre viraria ~3px e ficaria
   * impossível de acertar com o dedo.
   */
  protected readonly blockMinWidth = 24;

  /** Hoje no fuso do navegador. Só decide a janela inicial — a grade usa a resposta. */
  private readonly today = new Date().toISOString().slice(0, 10);

  protected readonly mode = signal<PeriodMode>('MONTH');
  protected readonly anchor = signal(startOfMonth(this.today));
  protected readonly customFrom = signal(startOfMonth(this.today));
  protected readonly customTo = signal(addDays(addMonths(startOfMonth(this.today), 1), -1));
  protected readonly vehicleFilter = signal('');

  protected readonly vehicles = signal<readonly VehicleListItem[]>([]);
  protected readonly grid = signal<FleetGrid | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Sequência da requisição em voo. Navegar rápido entre períodos dispara
   * várias leituras e a resposta lenta de uma janela antiga sobrescreveria a
   * atual — só a última emitida pinta a grade.
   */
  private requestSeq = 0;

  /** Janela pedida ao backend. `null` quando o período personalizado está incompleto. */
  protected readonly requestWindow = computed(() =>
    windowFor(this.mode(), this.anchor(), this.customFrom(), this.customTo()),
  );

  protected readonly periodLabel = computed(() => {
    const window = this.requestWindow();
    return window ? `${longDate(window.from)} – ${longDate(window.to)}` : '—';
  });

  protected readonly requestedDays = computed(() => {
    const window = this.requestWindow();
    return window ? windowDays(window.from, window.to) : 0;
  });

  /** `CUSTOM` não tem "próximo": não existe passo definido para uma janela livre. */
  protected readonly canStep = computed(() => this.mode() !== 'CUSTOM');

  protected readonly lanes = computed<readonly RenderLane[]>(() => {
    const grid = this.grid();
    return grid ? grid.lanes.map(toRenderLane) : [];
  });

  protected readonly ticks = computed(() => this.grid()?.ticks ?? []);

  /** Frota vazia (ou filtro sem resultado) — nada a desenhar. */
  protected readonly hasLanes = computed(() => this.lanes().length > 0);

  /** Há faixas, mas nenhum bloco: a frota inteira está livre no período. */
  protected readonly isPeriodEmpty = computed(() => {
    const grid = this.grid();
    return grid !== null && grid.lanes.length > 0 && grid.blockCount === 0;
  });

  protected readonly idleVehicleCount = computed(() => this.grid()?.idleVehicleCount ?? 0);
  protected readonly overlapVehicleCount = computed(() => this.grid()?.overlapVehicleCount ?? 0);

  /** Posição da linha de "hoje", ou `null` quando hoje está fora da janela. */
  protected readonly todayOffsetPercent = computed(() => {
    const grid = this.grid();
    if (!grid || grid.days === 0) return null;
    const offset = toEpochDay(this.today) - toEpochDay(grid.from);
    if (offset < 0 || offset >= grid.days) return null;
    // Centro do dia, senão a linha cairia colada na borda esquerda da célula.
    return ((offset + 0.5) / grid.days) * 100;
  });

  ngOnInit(): void {
    this.vehiclesService
      .list({ size: 500, sort: 'plate_asc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      // Falha do combo não derruba a grade: ela só perde o filtro por veículo.
      .subscribe({
        next: (page) => this.vehicles.set(page.content ?? []),
        error: (error: unknown) => {
          this.apiErrors.claim(error);
          this.vehicles.set([]);
        },
      });

    this.load();
  }

  protected setMode(mode: PeriodMode): void {
    if (mode === this.mode()) return;
    const current = this.requestWindow();
    if (mode === 'CUSTOM') {
      if (current) {
        this.customFrom.set(current.from);
        this.customTo.set(current.to);
      }
    } else {
      // Estreitar o período (mês → semana) a partir do PRIMEIRO dia da janela
      // jogaria o usuário para uma semana de julho ao sair de agosto. Quando
      // hoje está na janela vigente, é ele que ancora o período novo.
      const base = current && this.contains(current, this.today) ? this.today : (current?.from ?? this.today);
      this.anchor.set(mode === 'WEEK' ? startOfWeek(base) : startOfMonth(base));
    }
    this.mode.set(mode);
    this.load();
  }

  private contains(window: DateWindow, date: string): boolean {
    const day = toEpochDay(date);
    return day >= toEpochDay(window.from) && day <= toEpochDay(window.to);
  }

  protected step(direction: -1 | 1): void {
    switch (this.mode()) {
      case 'WEEK':
        this.anchor.update((value) => addDays(value, 7 * direction));
        break;
      case 'MONTH':
        this.anchor.update((value) => addMonths(value, direction));
        break;
      case 'QUARTER':
        this.anchor.update((value) => addMonths(value, 3 * direction));
        break;
      case 'CUSTOM':
        return;
    }
    this.load();
  }

  protected goToToday(): void {
    this.anchor.set(this.mode() === 'WEEK' ? startOfWeek(this.today) : startOfMonth(this.today));
    this.load();
  }

  protected onCustomFromChange(value: string): void {
    this.customFrom.set(value);
    this.load();
  }

  protected onCustomToChange(value: string): void {
    this.customTo.set(value);
    this.load();
  }

  protected onVehicleChange(value: string): void {
    this.vehicleFilter.set(value);
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  /**
   * As três recusas que o backend faria (janela incompleta, invertida, acima de
   * 366 dias) são detectadas ANTES do request: a mensagem é a mesma que ele
   * devolveria e o round-trip não acontece. Um 400 que escape mesmo assim é
   * traduzido pelo extrator compartilhado, que prefere o texto do servidor.
   */
  private load(): void {
    const window = this.requestWindow();
    if (!window) {
      this.grid.set(null);
      this.errorMessage.set(INCOMPLETE_WINDOW_MESSAGE);
      return;
    }
    if (windowDays(window.from, window.to) === 0) {
      this.grid.set(null);
      this.errorMessage.set(INVERTED_WINDOW_MESSAGE);
      return;
    }
    if (exceedsWindowLimit(window.from, window.to)) {
      this.grid.set(null);
      this.errorMessage.set(WINDOW_TOO_WIDE_MESSAGE);
      return;
    }

    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.errorMessage.set(null);

    this.calendarService
      .calendar({
        from: window.from,
        to: window.to,
        vehicleId: this.vehicleFilter() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: FleetCalendarResponse) => {
          if (seq !== this.requestSeq) return;
          this.loading.set(false);
          this.grid.set(buildGrid(response));
        },
        error: (error: unknown) => {
          if (seq !== this.requestSeq) return;
          this.loading.set(false);
          this.grid.set(null);
          this.errorMessage.set(this.apiErrors.messageFor(error, this.fallbackFor(error)));
        },
      });
  }

  /**
   * O 400 do calendário é sempre de janela — o controller só valida datas — e
   * por isso o fallback nomeia o teto em vez de dizer "erro de requisição".
   */
  private fallbackFor(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 400) return WINDOW_TOO_WIDE_MESSAGE;
    if (status === 404) return VEHICLE_NOT_FOUND_MESSAGE;
    return LOAD_FAILURE_MESSAGE;
  }
}
