import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PlanTier } from '../../../utils/plan-limits';

/**
 * TRATAMENTO visual do card — não o nome do plano.
 *
 * O enum anterior (`'trial' | 'pro' | 'business'`) misturava as duas coisas e
 * já estava mentindo: a landing passava `business` para um plano rotulado
 * Enterprise, e o `starter` acrescentado depois não tinha produtor nenhum —
 * caía no `@default` e saía idêntico ao TRIAL. Nomear o TRATAMENTO faz um
 * quinto tier reaproveitar um degrau em vez de inventar uma quarta string.
 *
 * A escada é de PREENCHIMENTO, não de matiz — vazio → vazio com acento →
 * laranja sólido → carbono. Dois laranjas vizinhos para dois tiers vizinhos é
 * exatamente onde a distinção some numa tela barata ou para quem tem
 * deficiência de cor; assim ela sobrevive até em escala de cinza.
 */
export type PlanCardTone = 'plain' | 'accent' | 'filled' | 'carbon';

/** O tier que a UI marca como recomendado. Combinado com `plans.name` da API. */
export const RECOMMENDED_PLAN_TIER: PlanTier = 'PRO';

/** Degrau visual de cada tier. Landing e billing leem daqui — nunca duplicam. */
const TIER_TONE: Readonly<Record<PlanTier, PlanCardTone>> = {
  TRIAL: 'plain',
  STARTER: 'accent',
  PRO: 'filled',
  ENTERPRISE: 'carbon',
};

export function planCardTone(tier: PlanTier | null): PlanCardTone {
  return tier ? TIER_TONE[tier] : 'plain';
}

interface ToneStyles {
  readonly article: string;
  readonly ribbon: string;
  readonly name: string;
  readonly dot: string;
  readonly price: string;
  readonly suffix: string;
  readonly subtitle: string;
  readonly description: string;
  readonly feature: string;
  readonly checkWrap: string;
  readonly checkIcon: string;
  readonly cta: string;
  readonly ctaNote: string;
  readonly error: string;
}

const ARTICLE_BASE =
  'relative rounded-[18px] p-[22px] h-full flex flex-col gap-4 transition-all duration-300';

/**
 * A fita fica em `-top-3.5`: metade dela transborda o card e cai sobre o fundo
 * da seção. Nos tons `plain`/`accent` a pílula é `bg-ink` (#0A0A0A) e se separa
 * do fundo claro sozinha — 19,80:1 sobre branco, 17,35:1 sobre o `gray-50`
 * (#F0F0F0) do shell. Nos tons `filled`/`carbon` ela é BRANCA sobre um fundo
 * claro: sem borda, a metade que transborda fica em ~1:1 e o rótulo parece
 * texto solto boiando acima do card. Daí o `border-ink` nesses dois.
 */
const RIBBON_BASE =
  'absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-bold px-3.5 py-1.5 rounded-full ' +
  'tracking-[0.06em] z-[2] whitespace-nowrap';

/**
 * O estado desabilitado é uma PALETA, não uma opacidade.
 *
 * `disabled:opacity-60` no botão branco do card recomendado derrubava a frase
 * "Plano atual" para menos de 3:1 — o WCAG isenta controle inativo, mas essa é
 * justamente a linha que o usuário precisa ler para saber ONDE ele está, e ela
 * some no card do plano que ele já assina. Cinza chapado resolve sem exceção:
 * `ink` (#0A0A0A) sobre `paper-2` (#F5F5F5) dá 18,16:1, e a borda
 * `rule-contrast` (#888888) sobre o mesmo `paper-2` dá 3,25:1 — acima do piso
 * de 3:1 do WCAG 1.4.11 para elemento não-textual. Ainda parece inerte: a cor
 * chapa, a sombra some e o hover não levanta.
 */
const CTA_BASE =
  'inline-flex justify-center items-center gap-1.5 font-bold text-[14.5px] rounded-full ' +
  'px-[22px] py-3.5 min-h-[46px] transition-all duration-200 hover:-translate-y-px ' +
  'disabled:cursor-default disabled:hover:translate-y-0 disabled:bg-paper-2 ' +
  'disabled:text-ink disabled:border-rule-contrast disabled:shadow-none ' +
  'disabled:hover:bg-paper-2 disabled:hover:text-ink disabled:hover:border-rule-contrast ' +
  // Os tons `filled` e `carbon` acrescentam um `hover:shadow-[…]` próprio, que
  // sobrevivia ao `disabled:shadow-none` e devolvia a elevação a um botão
  // inerte. Este reset é o que faz o comentário acima ser verdade.
  'disabled:hover:shadow-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * Cada par texto/superfície aqui foi MEDIDO no ponto mais claro da superfície
 * em que o elemento realmente se apoia — não contra branco por reflexo:
 *
 *   branco sobre `brand-strong` #C22F00 ......... 5,67:1
 *   branco sobre `black` #000000 (tom carbon) ... 21,00:1
 *   `brand-strong` #C22F00 sobre branco ......... 5,67:1
 *   `ink` #0A0A0A sobre branco .................. 19,80:1
 *   `success-900` #064E37 sobre branco .......... 9,76:1
 *   `muted` #6E6E6E sobre branco ................ 5,10:1
 *   `ink/70` (compõe #535353) sobre branco ...... 7,63:1
 *   `ink/60` (compõe #6C6C6C) sobre branco ...... 5,25:1
 *   `rose-700` sobre `rose-50` .................. 5,72:1
 *   `rose-700` sobre branco ..................... 6,28:1
 *
 * As bordas que separam card do fundo são elemento NÃO-TEXTUAL (piso 3:1) e
 * foram medidas nas DUAS superfícies que elas tocam — a do card e a da seção,
 * que é o `gray-50` (#F0F0F0) do shell:
 *
 *   `rule-contrast` #888888 ..... 3,54:1 sobre branco · 3,11:1 sobre #F0F0F0
 *   `brand` #F63B04 ............. 3,79:1 sobre branco · 3,32:1 sobre #F0F0F0
 *
 * NENHUM texto sobre superfície preenchida usa opacidade: a hierarquia vem do
 * peso da fonte. `white/80` custava menos de 2:1 sobre o laranja e era a origem
 * da maior parte das reprovações.
 */
const TONE_STYLES: Readonly<Record<PlanCardTone, ToneStyles>> = {
  plain: {
    article:
      `${ARTICLE_BASE} bg-white border border-rule-contrast ` +
      'shadow-[0_12px_30px_-20px_rgba(10,10,10,0.14)] hover:-translate-y-1.5 ' +
      'hover:shadow-[0_22px_44px_-22px_rgba(10,10,10,0.2)]',
    ribbon: `${RIBBON_BASE} bg-ink text-white shadow-[0_6px_16px_-4px_rgba(10,10,10,0.28)]`,
    name: 'text-ink',
    dot: 'bg-ink',
    price: 'text-ink',
    suffix: 'text-muted',
    subtitle: 'text-success-900',
    description: 'text-ink/70',
    feature: 'text-ink/70',
    checkWrap: 'bg-ink',
    checkIcon: 'text-white',
    cta:
      `${CTA_BASE} bg-white text-ink border-[1.5px] border-rule-contrast ` +
      'hover:bg-paper-alt hover:border-ink focus-visible:outline-primary-500',
    ctaNote: 'text-ink/60',
    error: 'border border-rose-300 bg-rose-50 text-rose-700',
  },
  accent: {
    article:
      `${ARTICLE_BASE} bg-white border-[1.5px] border-brand ` +
      'shadow-[0_12px_30px_-20px_rgba(194,47,0,0.22)] hover:-translate-y-1.5 ' +
      'hover:shadow-[0_22px_44px_-22px_rgba(194,47,0,0.3)]',
    ribbon: `${RIBBON_BASE} bg-ink text-white shadow-[0_6px_16px_-4px_rgba(10,10,10,0.28)]`,
    name: 'text-ink',
    dot: 'bg-brand',
    price: 'text-brand-strong',
    suffix: 'text-muted',
    subtitle: 'text-success-900',
    description: 'text-ink/70',
    feature: 'text-ink/70',
    checkWrap: 'bg-brand-strong',
    checkIcon: 'text-white',
    cta:
      `${CTA_BASE} bg-white text-brand-strong border-[1.5px] border-brand ` +
      'hover:bg-brand-tint focus-visible:outline-primary-500',
    ctaNote: 'text-ink/60',
    error: 'border border-rose-300 bg-rose-50 text-rose-700',
  },
  filled: {
    // Sólido, NÃO gradiente: um degradê tem um ponto mais claro, e era nele que
    // o texto branco reprovava — o `#FF5722` que abria o gradient antigo dá
    // 3,16:1 com branco. Trocar o valor do gradient não fecha o buraco; tirar o
    // gradient do contrato do componente fecha.
    article:
      `${ARTICLE_BASE} bg-brand-strong text-white ` +
      'shadow-[0_24px_56px_-24px_rgba(194,47,0,0.55)] lg:-translate-y-3.5 ' +
      'hover:lg:-translate-y-5',
    ribbon: `${RIBBON_BASE} bg-white text-brand-strong border border-ink shadow-[0_8px_18px_-4px_rgba(0,0,0,0.24)]`,
    name: 'text-white',
    dot: 'bg-white',
    price: 'text-white',
    suffix: 'text-white',
    subtitle: 'text-white',
    description: 'text-white',
    feature: 'text-white',
    checkWrap: 'bg-white',
    checkIcon: 'text-brand-strong',
    cta:
      `${CTA_BASE} bg-white text-brand-strong shadow-[0_10px_24px_-8px_rgba(0,0,0,0.28)] ` +
      'hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.38)] focus-visible:outline-white',
    ctaNote: 'text-white',
    error: 'bg-white text-rose-700',
  },
  carbon: {
    article:
      `${ARTICLE_BASE} bg-black text-white ` +
      'shadow-[0_24px_56px_-24px_rgba(10,10,10,0.6)] hover:-translate-y-1.5',
    ribbon: `${RIBBON_BASE} bg-white text-ink border border-ink shadow-[0_8px_18px_-4px_rgba(0,0,0,0.24)]`,
    name: 'text-white',
    dot: 'bg-white',
    price: 'text-white',
    suffix: 'text-white',
    subtitle: 'text-white',
    description: 'text-white',
    feature: 'text-white',
    checkWrap: 'bg-white',
    checkIcon: 'text-ink',
    cta:
      `${CTA_BASE} bg-white text-ink shadow-[0_10px_24px_-8px_rgba(0,0,0,0.28)] ` +
      'hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.38)] focus-visible:outline-white',
    ctaNote: 'text-white',
    error: 'bg-white text-rose-700',
  },
};

/**
 * Badge "Seu plano" — MESMO tratamento nos quatro degraus: pílula branca com
 * texto e borda `success-900` (#064E37, 9,76:1 sobre o branco da própria
 * pílula). O antigo `bg-emerald-500` com texto branco dava menos de 3:1, e uma
 * pílula colorida por degrau exigiria quatro medições em vez de uma.
 */
const CURRENT_BADGE =
  'absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-white ' +
  'text-success-900 border border-success-900 text-[11px] font-bold px-3.5 py-1.5 rounded-full ' +
  'tracking-[0.08em] uppercase shadow-[0_8px_18px_-4px_rgba(0,0,0,0.18)] z-[2] whitespace-nowrap';

@Component({
  selector: 'app-plan-card',
  templateUrl: './plan-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class PlanCardComponent {
  readonly tone = input.required<PlanCardTone>();
  readonly name = input.required<string>();
  readonly price = input.required<string>();
  readonly cycleSuffix = input.required<string>();
  readonly subtitleText = input<string | null>(null);
  readonly description = input<string | null>(null);
  readonly features = input.required<readonly string[]>();
  readonly ctaLabel = input.required<string>();
  readonly ctaDisabled = input<boolean>(false);
  readonly isCurrent = input<boolean>(false);
  /** Short note rendered right under the CTA (e.g. "Muda no fim do período"). */
  readonly ctaNote = input<string | null>(null);
  /**
   * Error for THIS card, rendered next to the button the user just clicked —
   * a banner at the top of the page is off-screen on mobile.
   */
  readonly errorText = input<string | null>(null);
  readonly ribbonText = input<string | null>(null);

  readonly ctaClick = output<void>();

  protected readonly styles = computed<ToneStyles>(() => TONE_STYLES[this.tone()]);
  protected readonly currentBadgeClass = CURRENT_BADGE;

  protected onCta(): void {
    if (this.ctaDisabled()) return;
    this.ctaClick.emit();
  }
}
