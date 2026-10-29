import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { BillingCycle, PlanResponse } from '../../types/billing.types';
import { PlanTier } from '../../utils/plan-limits';

export interface PlanColumnRow {
  label: string;
  /** Linha que muda em relação ao plano anterior — tinta forte. */
  hi: boolean;
}

export interface PlanColumn {
  tier: PlanTier;
  name: string;
  pitch: string;
  /** "R$ 79,90", "Grátis", "Sob consulta". */
  price: string;
  /** "/mês", "/ano" ou null para preço em texto. */
  per: string | null;
  sub: string;
  rows: readonly PlanColumnRow[];
  current: boolean;
  recommended: boolean;
  ctaLabel: string;
  ctaDisabled: boolean;
  /** Rótulo acessível do botão quando o visível é curto ("Plano atual"). */
  ctaAria: string;
  note: string | null;
  error: string | null;
  /** Linha de `/plans` que o CTA compra; null = contato ou indisponível. */
  plan: PlanResponse | null;
  contact: boolean;
}

/**
 * Grade de planos v6 (mockups 02/09/12): cinco colunas alinhadas por subgrid no
 * desktop; no celular um carrossel com snap que abre no plano atual, com pontos.
 * O plano atual ganha a borda acesa; o Pro, a etiqueta "Mais escolhido".
 */
@Component({
  selector: 'app-plan-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./billing-kit.css', './plan-grid.css'],
  host: { '[class.yr]': "cycle() === 'YEARLY'" },
  template: `
    <div class="cycwrap" role="radiogroup" aria-label="Ciclo de cobrança">
      <div class="cyc">
        <button
          type="button"
          role="radio"
          data-testid="cycle-monthly"
          [attr.aria-checked]="cycle() === 'MONTHLY'"
          [class.on]="cycle() === 'MONTHLY'"
          [class.m]="cycle() === 'MONTHLY'"
          (click)="cycleChange.emit('MONTHLY')"
        >
          Mensal
        </button>
        <button
          type="button"
          role="radio"
          data-testid="cycle-yearly"
          [attr.aria-checked]="cycle() === 'YEARLY'"
          [class.on]="cycle() === 'YEARLY'"
          [class.y]="cycle() === 'YEARLY'"
          (click)="cycleChange.emit('YEARLY')"
        >
          Anual
          @if (savings() > 0) {
            <span class="off">-{{ savings() }}%</span>
          }
        </button>
      </div>
    </div>

    <div class="pl-grid" #track (scroll)="onScroll()" data-testid="plan-grid">
      @for (col of columns(); track col.tier) {
        <article
          class="pl"
          [class.cur]="col.current"
          [class.rec]="col.recommended && !col.current"
          [attr.data-tier]="col.tier"
          [attr.aria-label]="'Plano ' + col.name"
        >
          <div class="r-name">
            <h3 class="name">{{ col.name }}</h3>
            @if (col.current) {
              <span class="tag cur">Seu plano</span>
            } @else if (col.recommended) {
              <span class="tag rec">Mais escolhido</span>
            }
          </div>
          <p class="r-pitch">{{ col.pitch }}</p>
          <div class="r-price">
            @if (col.per) {
              <b><i>R$</i>{{ col.price }}</b><span>{{ col.per }}</span>
            } @else {
              <b class="txt">{{ col.price }}</b>
            }
          </div>
          <div class="r-sub">{{ col.sub }}</div>
          <div class="r-cta">
            <button
              type="button"
              class="btn"
              [disabled]="col.ctaDisabled"
              [attr.aria-label]="col.ctaAria"
              [attr.data-testid]="'plan-cta-' + col.tier"
              (click)="choose.emit(col)"
            >
              {{ col.ctaLabel }}
            </button>
            @if (col.error) {
              <p class="r-err" role="alert">{{ col.error }}</p>
            } @else if (col.note) {
              <p class="r-note">{{ col.note }}</p>
            }
          </div>
          <div class="r-inc">Inclui</div>
          <ul>
            @for (row of col.rows; track row.label) {
              <li [class.hi]="row.hi">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                <span>{{ row.label }}</span>
              </li>
            }
          </ul>
        </article>
      }
    </div>
    <div class="dots" aria-hidden="true">
      @for (col of columns(); track col.tier; let i = $index) {
        <i [class.on]="i === activeIndex()"></i>
      }
    </div>
  `,
})
export class PlanGrid {
  readonly columns = input.required<readonly PlanColumn[]>();
  readonly cycle = input.required<BillingCycle>();
  readonly savings = input(0);
  readonly cycleChange = output<BillingCycle>();
  readonly choose = output<PlanColumn>();

  protected readonly activeIndex = signal(0);
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  constructor() {
    // Celular: o carrossel abre no plano atual (ou no recomendado).
    afterNextRender(() => {
      const cols = this.columns();
      let idx = cols.findIndex((c) => c.current);
      if (idx < 0) idx = cols.findIndex((c) => c.recommended);
      if (idx < 0) idx = 0;
      this.activeIndex.set(idx);
      const el = this.track().nativeElement;
      const card = el.children[idx] as HTMLElement | undefined;
      if (card && el.scrollWidth > el.clientWidth) {
        el.scrollLeft = card.offsetLeft - (el.clientWidth - card.clientWidth) / 2;
      }
    });
  }

  protected onScroll(): void {
    const el = this.track().nativeElement;
    const first = el.children[0] as HTMLElement | undefined;
    if (!first || el.scrollWidth <= el.clientWidth) return;
    const step = first.clientWidth + 12;
    const idx = Math.round(el.scrollLeft / step);
    this.activeIndex.set(Math.max(0, Math.min(this.columns().length - 1, idx)));
  }
}
