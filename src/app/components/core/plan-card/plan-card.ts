import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  Renderer2,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
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
export type PlanCardTone =
  'plain' | 'accent' | 'accent-success' | 'filled' | 'filled-success' | 'carbon' | 'carbon-success';

/**
 * Ciclo de cobrança, na forma que o TRATAMENTO entende.
 *
 * A landing chama os ciclos de `'monthly' | 'yearly'` e o billing usa o
 * `PlanPeriod` da API (`'MONTHLY' | 'YEARLY'`). Nenhum dos dois é imposto ao
 * outro: as duas telas traduzem para este par na fronteira, e é ele que indexa a
 * tabela abaixo. Um terceiro vocabulário de ciclo dentro do card seria a mesma
 * porta que `PlanCardTone` fechou para o estilo.
 */
export type PlanCardCycle = 'monthly' | 'yearly';

/** O tier que a UI marca como recomendado. Combinado com `plans.name` da API. */
export const RECOMMENDED_PLAN_TIER: PlanTier = 'PRO';

/**
 * Degrau visual de cada tier, por ciclo. Landing e billing leem daqui — nunca
 * duplicam.
 *
 * O ciclo entrou na tabela porque o dono pediu que o ANUAL seja verde: no ciclo
 * anual cada degrau colorido troca a matiz da marca pelo Hub Green, que é a cor
 * de "confirmado" do sistema. O TRIAL não tem ciclo (é sempre gratuito por 14
 * dias) e por isso repete `plain` nas duas colunas em vez de ganhar um `if`.
 *
 * A escada de PREENCHIMENTO continua sendo a que carrega a distinção — vazio →
 * vazio com acento → sólido → carbono. Ela sobrevive em escala de cinza e para
 * quem tem deficiência de cor; a matiz por ciclo é informação redundante, nunca
 * a única.
 */
const TIER_TONE: Readonly<Record<PlanTier, Readonly<Record<PlanCardCycle, PlanCardTone>>>> = {
  TRIAL: { monthly: 'plain', yearly: 'plain' },
  STARTER: { monthly: 'accent', yearly: 'accent-success' },
  PRO: { monthly: 'filled', yearly: 'filled-success' },
  ENTERPRISE: { monthly: 'carbon', yearly: 'carbon-success' },
};

export function planCardTone(tier: PlanTier | null, cycle: PlanCardCycle): PlanCardTone {
  return tier ? TIER_TONE[tier][cycle] : 'plain';
}

interface ToneStyles {
  readonly article: string;
  /**
   * Degradê da superfície. Hoje os SETE tons declaram um — os quatro
   * coloridos com matiz, os três neutros com a viagem branca de 160deg que
   * traduz a linguagem da landing (ver `--plan-surface-*` em `styles.css`).
   * O `| null` fica porque um tom futuro pode legitimamente querer superfície
   * chapada; ele não é mais usado por nenhum tom atual.
   *
   * Vai para um `[style.background-image]` porque é isso que o resto do projeto
   * faz com os tokens de gradiente (ver `--brand-gradient-deep` no
   * `segmented-toggle`), e porque o valor é uma `var()` de `styles.css` — o
   * lugar onde os stops foram medidos.
   *
   * ATENÇÃO: isto NÃO reabre o buraco que os inputs `gradientCss`/`shadowCss`
   * abriram. Aquilo era uma string vinda de FORA do componente, escolhida pela
   * tela; esta é interna e indexada pela união fechada `PlanCardTone`. Nenhum
   * consumidor consegue injetar um degradê não medido.
   */
  readonly backgroundImage: string | null;
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

/**
 * Raio 18px é o degrau do sistema reservado ao card de plano (8 controles · 12
 * botões e campos · 16 cards e diálogos · 18 plano · pill para chips e CTA de
 * marketing). Não é um 16 arredondado para cima.
 *
 * O padding APERTA em `lg` porque é exatamente onde a landing passa a mostrar os
 * quatro cards numa linha só: a 1024px cada coluna vale 222px, e os 22px de
 * folga de cada lado custavam 8px de largura útil ao preço. Ver o cálculo em
 * `landing-pricing.component.html`.
 */
const ARTICLE_BASE =
  'relative rounded-[18px] p-[22px] lg:p-[18px] h-full flex flex-col gap-4 transition-all duration-300';

/**
 * ═══ A PROFUNDIDADE EM CAMADAS ═══
 *
 * O dono pediu "uma pegada 3D" e escolheu PROFUNDIDADE EM CAMADAS — não
 * inclinação em perspectiva, não relevo. Os cards ficam de pé: nenhuma rotação,
 * nenhum `perspective`, nenhum `skew`. O volume vem de sombra e de aresta.
 *
 * Isto não é vocabulário novo. O sistema já descreve o botão de marca como "uma
 * sombra colorida mais um brilho branco de 1px por dentro", e os chips da
 * landing já flutuam com `0 14px 32px -12px rgba(10,10,10,0.18)`. As receitas
 * abaixo são essa mesma linguagem aplicada a uma superfície maior:
 *
 *   1. CONTATO  — 1-2px, quase opaco: é o que encosta o card no papel.
 *   2. MEIO     — 6-10px: dá espessura ao objeto.
 *   3. FLUTUAÇÃO— 14-32px, bem difusa: é o que o separa do fundo.
 *   4. ARESTA SUPERIOR — `inset 0 1px` claro: a luz batendo na quina de cima.
 *   5. ARESTA INFERIOR — `inset 0 -1px` escuro: o assento do objeto.
 *
 * <h4>Por que as camadas 4 e 5 não mexem em contraste nenhum</h4>
 * Elas são DUAS LINHAS DE 1px nas quinas extremas da caixa. O padding do card é
 * 22px (18px em `lg`), e agora a fita ainda reserva uma faixa acima do
 * cabeçalho: não existe glifo a menos de 18px de qualquer uma das duas. Nenhum
 * par texto/preenchimento é recomposto. As camadas 1-3 caem FORA da caixa, sobre
 * o fundo da seção, e não carregam texto.
 *
 * Isso é o oposto do véu branco que `styles.css` proíbe (`bg-white/20`, glow,
 * radial de brilho): aquele clareia a área onde o texto se apoia e derruba o
 * ponto mais claro do degradê abaixo do AA. Uma linha de 1px na quina não toca
 * área de leitura nenhuma. O limite entre os dois é literalmente esse.
 *
 * <h4>O telefone recebe MENOS sombra, não a mesma</h4>
 * A camada 3 é a que fica boa a 1440px e suja o card a 375px: no telefone os
 * cards ocupam a largura toda, ficam empilhados a 20px um do outro e uma
 * flutuação de 32px vira uma faixa cinza entre eles. Por isso a receita base
 * (mobile-first) tem só CONTATO + MEIO + arestas, e a FLUTUAÇÃO entra a partir
 * de `md`, que é onde a grade deixa de ser uma coluna e passa a haver fundo à
 * volta do card para receber a sombra.
 *
 * <h4>A amplitude subiu — em `md` para cima, e SÓ nas receitas neutras</h4>
 * Estas três receitas foram calibradas quando a landing era branca, e ali sombra
 * forte era desperdício: um card branco sobre chão branco não descola por mais
 * escura que a sombra seja, então o que sobrava de amplitude só sujava a tela.
 * Com o chão em Hub Gray (ver `landing-pricing.component.html`) existe superfície
 * de onde descolar, e as camadas 2 e 3 passam a render — daí 0,18 → 0,30 na
 * flutuação neutra, e o meio abrindo de 14px para 20px de raio.
 *
 * A RECEITA BASE NÃO MUDOU UM DÍGITO. A 375px o card é de largura cheia, o chão
 * aparece só nas calhas de 20px, e a separação ali passou a vir do PRÓPRIO chão
 * (1,14:1 de branco contra Hub Gray), não de sombra maior — que é exatamente o
 * que continuaria virando faixa cinza entre cards empilhados. A restrição do
 * telefone que a rodada anterior estabeleceu segue de pé, e agora com um motivo
 * a mais: ela ficou desnecessária.
 *
 * As receitas dos DOIS CARDS COLORIDOS (`DEPTH_FEATURED_*`, `DEPTH_CARBON`)
 * ficam como estavam. Elas já liam antes da mudança, porque o card carregava cor
 * própria; subir junto só encurtaria a distância entre o destaque e os vizinhos,
 * que é a única coisa que a escada de elevação tem para dizer.
 */
const DEPTH_NEUTRAL =
  'shadow-[0_1px_2px_-1px_rgba(10,10,10,0.14),0_6px_14px_-8px_rgba(10,10,10,0.14),inset_0_-1px_0_0_rgba(10,10,10,0.10)] ' +
  'md:shadow-[0_2px_4px_-1px_rgba(10,10,10,0.16),0_10px_20px_-10px_rgba(10,10,10,0.20),0_22px_46px_-16px_rgba(10,10,10,0.30),inset_0_-1px_0_0_rgba(10,10,10,0.10)] ' +
  'hover:shadow-[0_3px_6px_-1px_rgba(10,10,10,0.20),0_16px_28px_-12px_rgba(10,10,10,0.26),0_34px_64px_-20px_rgba(10,10,10,0.38),inset_0_-1px_0_0_rgba(10,10,10,0.10)]';

/** Mesma escada, com a sombra na matiz da marca (tom `accent`). */
const DEPTH_BRAND =
  'shadow-[0_1px_2px_-1px_rgba(194,47,0,0.20),0_6px_14px_-8px_rgba(194,47,0,0.22),inset_0_-1px_0_0_rgba(194,47,0,0.14)] ' +
  'md:shadow-[0_2px_4px_-1px_rgba(194,47,0,0.24),0_10px_20px_-10px_rgba(194,47,0,0.28),0_22px_46px_-16px_rgba(194,47,0,0.36),inset_0_-1px_0_0_rgba(194,47,0,0.14)] ' +
  'hover:shadow-[0_3px_6px_-1px_rgba(194,47,0,0.28),0_16px_28px_-12px_rgba(194,47,0,0.34),0_34px_64px_-20px_rgba(194,47,0,0.44),inset_0_-1px_0_0_rgba(194,47,0,0.14)]';

/** Mesma escada, na matiz do ciclo anual (tom `accent-success`). */
const DEPTH_SUCCESS =
  'shadow-[0_1px_2px_-1px_rgba(10,120,84,0.20),0_6px_14px_-8px_rgba(10,120,84,0.24),inset_0_-1px_0_0_rgba(10,120,84,0.16)] ' +
  'md:shadow-[0_2px_4px_-1px_rgba(10,120,84,0.24),0_10px_20px_-10px_rgba(10,120,84,0.30),0_22px_46px_-16px_rgba(10,120,84,0.38),inset_0_-1px_0_0_rgba(10,120,84,0.16)] ' +
  'hover:shadow-[0_3px_6px_-1px_rgba(10,120,84,0.28),0_16px_28px_-12px_rgba(10,120,84,0.36),0_34px_64px_-20px_rgba(10,120,84,0.46),inset_0_-1px_0_0_rgba(10,120,84,0.16)]';

/**
 * O card em DESTAQUE flutua mais alto que os outros, e a sombra dele é a única
 * que já nasce com a camada de flutuação — é ela que faz o card parecer estar
 * acima do plano dos vizinhos mesmo parado. As arestas aqui são as duas: brilho
 * branco de 1px em cima (a linguagem do botão de marca) e um marrom-carvão de
 * 1px embaixo.
 */
const DEPTH_FEATURED_BRAND =
  'shadow-[0_2px_4px_-2px_rgba(120,28,0,0.34),0_10px_20px_-10px_rgba(246,59,4,0.42),inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_0_0_rgba(120,28,0,0.32)] ' +
  'md:shadow-[0_2px_4px_-2px_rgba(120,28,0,0.34),0_10px_20px_-10px_rgba(246,59,4,0.42),0_30px_60px_-24px_rgba(246,59,4,0.55),inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_0_0_rgba(120,28,0,0.32)] ' +
  'hover:shadow-[0_2px_4px_-2px_rgba(120,28,0,0.38),0_14px_26px_-10px_rgba(246,59,4,0.48),0_40px_74px_-26px_rgba(246,59,4,0.62),inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-1px_0_0_rgba(120,28,0,0.32)]';

const DEPTH_FEATURED_SUCCESS =
  'shadow-[0_2px_4px_-2px_rgba(6,78,55,0.34),0_10px_20px_-10px_rgba(16,185,129,0.40),inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_0_0_rgba(6,78,55,0.32)] ' +
  'md:shadow-[0_2px_4px_-2px_rgba(6,78,55,0.34),0_10px_20px_-10px_rgba(16,185,129,0.40),0_30px_60px_-24px_rgba(16,185,129,0.50),inset_0_1px_0_0_rgba(255,255,255,0.45),inset_0_-1px_0_0_rgba(6,78,55,0.32)] ' +
  'hover:shadow-[0_2px_4px_-2px_rgba(6,78,55,0.38),0_14px_26px_-10px_rgba(16,185,129,0.46),0_40px_74px_-26px_rgba(16,185,129,0.58),inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-1px_0_0_rgba(6,78,55,0.32)]';

/**
 * Carbono. O brilho de cima é fraco (14%) porque sobre #101010 ele já é a
 * diferença entre a quina e a face; mais que isso vira uma listra.
 */
const DEPTH_CARBON =
  'shadow-[0_2px_4px_-2px_rgba(10,10,10,0.5),0_10px_20px_-10px_rgba(10,10,10,0.45),inset_0_1px_0_0_rgba(255,255,255,0.14),inset_0_-1px_0_0_rgba(0,0,0,0.55)] ' +
  'md:shadow-[0_2px_4px_-2px_rgba(10,10,10,0.5),0_10px_20px_-10px_rgba(10,10,10,0.45),0_26px_54px_-22px_rgba(10,10,10,0.6),inset_0_1px_0_0_rgba(255,255,255,0.14),inset_0_-1px_0_0_rgba(0,0,0,0.55)] ' +
  'hover:shadow-[0_2px_4px_-2px_rgba(10,10,10,0.55),0_14px_26px_-10px_rgba(10,10,10,0.5),0_36px_68px_-24px_rgba(10,10,10,0.66),inset_0_1px_0_0_rgba(255,255,255,0.18),inset_0_-1px_0_0_rgba(0,0,0,0.55)]';

/** O degrau de elevação do sistema: o card sobe 6px no hover. */
const LIFT_ON_HOVER = 'hover:-translate-y-1.5';

/**
 * ═══ A LUZ DE ARESTA ═══
 *
 * O dono viu quatro tratamentos 3D PARADOS — laje extrudada, inclinação em
 * perspectiva, planos empilhados e a sombra em camadas que está aqui — e não
 * escolheu nenhum. O que ele pediu foi "hover (leve) dentro dos cards": o card
 * não deve virar um objeto mais pesado em repouso, deve reagir ao cursor.
 *
 * A resposta é UMA ideia em movimento, e só uma: sob o cursor, uma luz curta
 * percorre a aresta INTERNA do card. A elevação de 6px que já existia continua
 * exatamente como estava — ela é vocabulário do sistema, não ideia nova.
 *
 * As receitas, a geometria e a aritmética de contraste estão em `styles.css`
 * (`.plan-rim`). O resumo do que importa aqui: a luz mora numa faixa de 1,5px
 * a ~2px da aresta, dentro do padding de 22px, então o glifo mais próximo fica
 * a ~19px e NENHUM par texto/superfície é recomposto — que é obrigatório,
 * porque não existe direção de luminância segura para os quatro tons ao mesmo
 * tempo (clarear salva o carbono e reprova o PRO; escurecer faz o inverso).
 *
 * Cada tom leva a luz no token que ele JÁ usa para se destacar. Sobre
 * superfície saturada ou carbono ela é branca — laranja sobre laranja não
 * aparece. O `plain` usa o mesmo laranja do `accent` com pouco mais da metade
 * do alfa, para ter luz sem inventar matiz no degrau "vazio" da escada.
 */
const RIM_TINT = 'plan-rim plan-rim--tint';
const RIM_BRAND = 'plan-rim plan-rim--brand';
const RIM_GREEN = 'plan-rim plan-rim--green';
const RIM_WHITE = 'plan-rim plan-rim--white';

/**
 * A fita vive DENTRO do card, numa faixa reservada no topo — ver
 * `plan-card.html`.
 *
 * Ela era `absolute -top-3.5`, com metade transbordando para o fundo da seção, e
 * chegava cortada na tela: um card com `transform` permanente (o destaque tem)
 * abre contexto de empilhamento próprio, e aí o `z-[2]` da fita não a levanta
 * acima de mais nada. Com a profundidade em camadas isso ficou pior de ler —
 * um rótulo metade fora de um objeto que agora tem volume parece adesivo solto.
 *
 * Em fluxo normal, dentro da caixa, ela não pode ser cortada por definição, e a
 * faixa é reservada nos QUATRO cards: sem isso o cabeçalho dos dois que têm fita
 * desceria e os nomes dos planos sairiam desalinhados na fileira.
 *
 * Contraste (a pílula deixou de encostar no fundo da seção e agora se apoia SÓ
 * na superfície do card):
 *   `bg-ink` sobre branco (plain/accent) .......... 19,80:1
 *   `bg-ink` sobre o pior stop do PRO (#FF8558) .... 8,25:1
 *   `bg-ink` sobre o pior stop do PRO anual ....... 16,11:1
 *   pílula branca sobre o carbono (#101010) ....... 18,93:1
 * Texto: branco sobre `ink` 19,80:1 · `ink` sobre branco 19,80:1.
 */
const RIBBON_BASE =
  'inline-flex items-center text-[11px] font-bold px-3.5 py-1.5 rounded-full ' +
  'tracking-[0.06em] whitespace-nowrap';

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
 * que é o `gray-50` (#F0F0F0):
 *
 *   `rule-contrast` #888888 ..... 3,54:1 sobre branco · 3,11:1 sobre #F0F0F0
 *   `brand` #F63B04 ............. 3,79:1 sobre branco · 3,32:1 sobre #F0F0F0
 *   `success-700` #0B8A61 ....... 4,35:1 sobre branco · 3,82:1 sobre #F0F0F0
 *
 * AS DUAS TELAS AGORA PISAM NO MESMO CHÃO. Esta coluna do #F0F0F0 existia
 * porque o billing desenha estes cards sobre o canvas do shell; a landing era a
 * exceção, pintava a seção de branco, e era por isso que os dois cards brancos
 * não descolavam de nada. A landing passou a usar o mesmo Hub Gray (o desvio
 * está registrado em `landing-pricing.component.html`), então a medição do pior
 * caso vale para as duas e deixou de haver superfície não coberta aqui.
 *
 * NENHUM texto sobre superfície preenchida usa opacidade: a hierarquia vem do
 * peso da fonte. `white/80` custava menos de 2:1 sobre o laranja e era a origem
 * da maior parte das reprovações.
 *
 * ─── OS TONS COM DEGRADÊ (`filled*`, `carbon*`) ───────────────────────────
 *
 * O ponto de medição INVERTE com a cor do texto, e é a origem do erro clássico:
 *   · texto BRANCO reprova no stop mais CLARO do degradê;
 *   · texto ESCURO (ink #0A0A0A) reprova no stop mais ESCURO.
 * Os stops de cada degradê e o pior deles estão em `styles.css`, junto do token.
 *
 * Por que o PRO passou a levar tinta ESCURA. O dono pediu o laranja de verdade
 * (#F63B04) no card em destaque, e o sistema é explícito: Signal Orange e Hub
 * Green são preenchimento, nunca texto — branco pequeno dá 3,79:1 sobre o
 * laranja e 2,54:1 sobre o verde. Não existe arranjo em que branco pequeno se
 * apoie na cor que o dono pediu. Com ink por cima, o pior ponto do degradê passa
 * a ser a PRÓPRIA cor do dono, e ela passa:
 *
 *   `ink` #0A0A0A sobre #F63B04 (pior stop, PRO mensal) .... 5,23:1
 *   `ink` #0A0A0A sobre #FA602E ............................ 6,39:1
 *   `ink` #0A0A0A sobre #FF8558 (stop mais claro) .......... 8,25:1
 *   `ink` #0A0A0A sobre #10B981 (pior stop, PRO anual) ..... 7,80:1
 *   `ink` #0A0A0A sobre #BFF3DE (stop mais claro) ......... 16,11:1
 *   branco sobre `ink` #0A0A0A (CTA e check do PRO) ....... 19,80:1
 *
 * O ENTERPRISE segue com texto BRANCO — ele é carbono que esquenta, não a cor da
 * marca, então o pior ponto é o stop mais claro de cada degradê:
 *
 *   branco sobre #982500 (stop mais claro, mensal) ......... 8,08:1
 *   branco sobre #0A7854 (stop mais claro, anual) .......... 5,49:1
 *
 * ─── A BORDA VERDE DO STARTER ANUAL, E POR QUE ELA NÃO É #10B981 ──────────
 *
 * O pedido era "a cor ao redor do Starter anual é o verde principal". O Hub
 * Green #10B981 como BORDA mede 2,54:1 sobre o branco do card e 2,23:1 sobre o
 * `gray-50` da seção — abaixo do piso de 3:1 do WCAG 1.4.11 para elemento
 * não-textual, e o próprio sistema o classifica como preenchimento, nunca
 * contorno. O laranja equivalente passa (#F63B04 dá 3,79:1 / 3,32:1), que é por
 * que o STARTER mensal pôde ficar como está — o verde simplesmente é mais claro.
 *
 * O contorno usa então o `success-700` #0B8A61, o degrau mais próximo que passa
 * (4,35:1 sobre branco · 4,17:1 sobre #FAFAFA · 3,82:1 sobre #F0F0F0), e o
 * #10B981 pedido aparece onde é PREENCHIMENTO e legítimo: o ponto do nome. É a
 * aproximação mais fiel que fecha o AA.
 *
 *   `success-700` #0B8A61 (contorno) ..... 4,35:1 branco · 3,82:1 #F0F0F0
 *   `success-800` #0A7854 (check) ........ branco em cima 5,49:1
 *   `success-900` #064E37 (preço/CTA) .... 9,76:1 branco · 9,05:1 `success-50`
 */
const TONE_STYLES: Readonly<Record<PlanCardTone, ToneStyles>> = {
  plain: {
    article: `${ARTICLE_BASE} bg-white border border-rule-contrast ${DEPTH_NEUTRAL} ${LIFT_ON_HOVER} ${RIM_TINT}`,
    backgroundImage: 'var(--plan-surface-plain)',
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
    article: `${ARTICLE_BASE} bg-white border-[1.5px] border-brand ${DEPTH_BRAND} ${LIFT_ON_HOVER} ${RIM_BRAND}`,
    backgroundImage: 'var(--plan-surface-accent)',
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
  // O MESMO degrau do `accent`, com a matiz do ciclo anual. Só a cor muda: peso,
  // borda, sombra e estrutura são idênticos, para que trocar de ciclo não pareça
  // trocar de plano. O contorno é `success-700` e não o Hub Green — a medição
  // está no bloco acima.
  'accent-success': {
    article: `${ARTICLE_BASE} bg-white border-[1.5px] border-success-700 ${DEPTH_SUCCESS} ${LIFT_ON_HOVER} ${RIM_GREEN}`,
    backgroundImage: 'var(--plan-surface-accent-success)',
    ribbon: `${RIBBON_BASE} bg-ink text-white shadow-[0_6px_16px_-4px_rgba(10,10,10,0.28)]`,
    name: 'text-ink',
    // O único lugar em que o Hub Green pedido aparece puro: ponto decorativo,
    // preenchimento, sem texto nem informação apoiada nele.
    dot: 'bg-success-500',
    price: 'text-success-900',
    suffix: 'text-muted',
    subtitle: 'text-success-900',
    description: 'text-ink/70',
    feature: 'text-ink/70',
    checkWrap: 'bg-success-800',
    checkIcon: 'text-white',
    cta:
      `${CTA_BASE} bg-white text-success-900 border-[1.5px] border-success-700 ` +
      'hover:bg-success-50 focus-visible:outline-success-800',
    ctaNote: 'text-ink/60',
    error: 'border border-rose-300 bg-rose-50 text-rose-700',
  },
  // ─── PRO, o card em destaque ───────────────────────────────────────────────
  // Este é o único card que o sistema autoriza a levar degradê, e é o card cuja
  // cor o dono nomeou. Ele resolve os dois pedidos ao mesmo tempo virando a
  // tinta: superfície na cor da marca, texto em ink. Ver a medição acima.
  filled: {
    // O `bg-brand` é a cor-base SOB o degradê, não decoração: se a `var()` não
    // resolver, a superfície cai em #F63B04 chapado e o texto ink continua em
    // 5,23:1. Sem ela o card ficaria transparente — um degrau inteiro sumindo
    // por causa de um token.
    // O DESTAQUE FLUTUA MAIS ALTO: `md:-translate-y-3` / `lg:-translate-y-3.5`
    // (12px e 14px) já parados, contra 0 dos vizinhos, e o hover acrescenta os
    // mesmos 6px do sistema (18px e 20px). Abaixo de `md` a grade é uma coluna
    // só e não há vizinho de quem se destacar — levantar ali só descolaria o
    // card do empilhamento.
    article:
      `${ARTICLE_BASE} bg-brand text-ink ${DEPTH_FEATURED_BRAND} ${RIM_WHITE} ` +
      'md:-translate-y-3 lg:-translate-y-3.5 ' +
      'hover:md:-translate-y-[18px] hover:lg:-translate-y-5',
    backgroundImage: 'var(--plan-gradient-pro)',
    ribbon: `${RIBBON_BASE} bg-ink text-white shadow-[0_8px_18px_-4px_rgba(0,0,0,0.28)]`,
    name: 'text-ink',
    dot: 'bg-ink',
    price: 'text-ink',
    suffix: 'text-ink',
    subtitle: 'text-ink',
    description: 'text-ink',
    feature: 'text-ink',
    checkWrap: 'bg-ink',
    checkIcon: 'text-white',
    cta:
      `${CTA_BASE} bg-ink text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.32)] ` +
      'hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.42)] focus-visible:outline-ink',
    ctaNote: 'text-ink',
    // A CAIXA DE ERRO PRECISA DE CONTORNO NOS DOIS TONS COM DEGRADÊ.
    //
    // A regra do stop mais claro foi escrita neste arquivo para TEXTO e não foi
    // aplicada a esta SUPERFÍCIE: uma caixa branca sem borda mede 2,40:1 contra
    // o #FF8558 do PRO mensal e 1,23:1 contra o #BFF3DE do anual — abaixo do
    // piso de 3:1 do WCAG 1.4.11, e no verde ela praticamente some. O texto
    // dentro sempre passou (rose-700 sobre branco, 6,28:1); quem falhava era o
    // limite da caixa. O contorno `ink` resolve nos dois: 8,25:1 sobre #FF8558 e
    // 16,11:1 sobre #BFF3DE.
    error: 'border border-ink bg-white text-rose-700',
  },
  'filled-success': {
    // Mesma cor-base de segurança: #10B981 chapado dá 7,80:1 com o texto ink.
    article:
      `${ARTICLE_BASE} bg-success-500 text-ink ${DEPTH_FEATURED_SUCCESS} ${RIM_WHITE} ` +
      'md:-translate-y-3 lg:-translate-y-3.5 ' +
      'hover:md:-translate-y-[18px] hover:lg:-translate-y-5',
    backgroundImage: 'var(--plan-gradient-pro-yearly)',
    ribbon: `${RIBBON_BASE} bg-ink text-white shadow-[0_8px_18px_-4px_rgba(0,0,0,0.28)]`,
    name: 'text-ink',
    dot: 'bg-ink',
    price: 'text-ink',
    suffix: 'text-ink',
    subtitle: 'text-ink',
    description: 'text-ink',
    feature: 'text-ink',
    checkWrap: 'bg-ink',
    checkIcon: 'text-white',
    cta:
      `${CTA_BASE} bg-ink text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.32)] ` +
      'hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.42)] focus-visible:outline-ink',
    ctaNote: 'text-ink',
    // A CAIXA DE ERRO PRECISA DE CONTORNO NOS DOIS TONS COM DEGRADÊ.
    //
    // A regra do stop mais claro foi escrita neste arquivo para TEXTO e não foi
    // aplicada a esta SUPERFÍCIE: uma caixa branca sem borda mede 2,40:1 contra
    // o #FF8558 do PRO mensal e 1,23:1 contra o #BFF3DE do anual — abaixo do
    // piso de 3:1 do WCAG 1.4.11, e no verde ela praticamente some. O texto
    // dentro sempre passou (rose-700 sobre branco, 6,28:1); quem falhava era o
    // limite da caixa. O contorno `ink` resolve nos dois: 8,25:1 sobre #FF8558 e
    // 16,11:1 sobre #BFF3DE.
    error: 'border border-ink bg-white text-rose-700',
  },
  // ─── ENTERPRISE ───────────────────────────────────────────────────────────
  // Carbono que ESQUENTA. O preto continua sendo o que identifica o degrau; o
  // degradê só o inclina para o fim escuro da rampa da marca (laranja no mensal,
  // verde no anual), como o dono pediu. Texto branco, então o pior ponto é o
  // stop mais claro — 8,08:1 e 5,49:1.
  carbon: {
    article: `${ARTICLE_BASE} bg-black text-white ${DEPTH_CARBON} ${LIFT_ON_HOVER} ${RIM_WHITE}`,
    backgroundImage: 'var(--plan-gradient-enterprise)',
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
  'carbon-success': {
    article: `${ARTICLE_BASE} bg-black text-white ${DEPTH_CARBON} ${LIFT_ON_HOVER} ${RIM_WHITE}`,
    backgroundImage: 'var(--plan-gradient-enterprise-yearly)',
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
 * Badge "Seu plano" — MESMO tratamento nos sete degraus: pílula branca com
 * texto e borda `success-900` (#064E37, 9,76:1 sobre o branco da própria
 * pílula). O antigo `bg-emerald-500` com texto branco dava menos de 3:1, e uma
 * pílula colorida por degrau exigiria sete medições em vez de uma.
 *
 * A BORDA é o que separa a pílula do card, e é por isso que ela não é
 * decorativa. Sobre o `filled-success` o branco da pílula encosta no Hub Green e
 * mede só 2,54:1 — abaixo do piso de 3:1 —, mas o contorno #064E37 sobre #10B981
 * dá 3,85:1 e carrega o limite sozinho. Nos demais o próprio branco já basta
 * (3,79:1 sobre #F63B04 · 18,93:1 sobre o carbono).
 *
 * Como a fita, este selo saiu do `absolute -top-3.5` e passou a viver na faixa
 * reservada do topo do card. Ele deixou de encostar no fundo da seção — onde a
 * metade que transbordava media 1,06:1 contra o branco do papel da landing, pior
 * do que qualquer ponto sobre o card — e agora se apoia só na superfície medida
 * acima.
 */
const CURRENT_BADGE =
  'inline-flex items-center gap-1 bg-white ' +
  'text-success-900 border border-success-900 text-[11px] font-bold px-3.5 py-1.5 rounded-full ' +
  'tracking-[0.08em] uppercase shadow-[0_8px_18px_-4px_rgba(0,0,0,0.18)] whitespace-nowrap';

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

  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly zone = inject(NgZone);
  private readonly renderer = inject(Renderer2);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // `afterNextRender` e não um campo inicializado: o corpo abaixo lê o DOM real
    // (`getBoundingClientRect`) e a landing é PRERENDERIZADA — o Angular pula estes
    // callbacks no servidor. Mesmo contrato do `revealOnScroll` do hero.
    afterNextRender(() => this.trackPointer());
  }

  /**
   * Alimenta a luz de aresta (`.plan-rim`, em `styles.css`) com a posição do
   * cursor DENTRO do card. Só isso: duas custom properties inline. Quem decide
   * se a luz existe é o CSS — `(hover: hover) and (pointer: fine)`,
   * `prefers-reduced-motion` e o `@supports` da máscara —, e é por isso que não
   * há `window.matchMedia` aqui. Um portão a mais em JS seria uma segunda
   * verdade sobre a mesma regra, livre para divergir da primeira.
   *
   * FORA DA ZONA, de propósito. `pointermove` dispara dezenas de vezes por
   * segundo e este app ainda roda com zone.js; um `(pointermove)` no template
   * agendaria uma detecção de mudanças por evento para não mudar estado nenhum
   * — o handler escreve direto no `style` do elemento e não toca em signal. O
   * `renderer.listen` devolve o descadastro, guardado no `DestroyRef`.
   *
   * O toque sai na primeira linha: num telefone o `pointermove` chega mesmo
   * assim (arrastar a página conta), e o CSS já não pinta nada — ler geometria
   * a cada quadro para alimentar um efeito desligado é trabalho puro.
   */
  private trackPointer(): void {
    const el = this.card().nativeElement;

    this.zone.runOutsideAngular(() => {
      const stop = this.renderer.listen(el, 'pointermove', (event: PointerEvent) => {
        if (event.pointerType === 'touch') return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
        el.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
      });
      this.destroyRef.onDestroy(stop);
    });
  }

  protected onCta(): void {
    if (this.ctaDisabled()) return;
    this.ctaClick.emit();
  }
}
