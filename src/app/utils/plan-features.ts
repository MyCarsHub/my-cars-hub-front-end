import { PlanTier, normalizePlanName } from './plan-limits';

/**
 * Bullets QUALITATIVOS dos planos — o texto que não sai de número nenhum.
 *
 * <h4>Uma lista compartilhada, de propósito</h4>
 * O backend aplica EXATAMENTE dois limites: `vehicle_limit` e `driver_limit`.
 * Não existe gate de funcionalidade em lugar nenhum — nem de usuários, nem de
 * aluguéis, nem de armazenamento. Os quatro tiers rodam o mesmo SOFTWARE; o que
 * o cliente compra é tamanho de frota.
 *
 * Por isso o registro por tier abaixo (`PLAN_FEATURE_EXTRAS`) é minúsculo e não
 * pode crescer com capacidade de produto. O que ele carrega é a única coisa que
 * de fato varia entre os planos além do teto: a PRIORIDADE do atendimento, um
 * compromisso operacional que o dono assumiu, não uma função de software. Uma
 * linha como "Integrações premium" ou "Relatórios avançados exportáveis" aqui
 * volta a vender a escada que o código não implementa — foi assim que o card do
 * PRO ganhou promessa que ninguém escreveu.
 *
 * <h4>O que NÃO mora aqui</h4>
 * Capacidade (veículos/motoristas) e dias de teste. Esses são números: na
 * landing vêm de `planCapacityLine()` (cópia da `plans`), no billing vêm da
 * PRÓPRIA linha da API — o card autenticado nunca pode contradizer o plano que
 * o backend realmente vende.
 *
 * <h4>Regra de edição</h4>
 * Cada frase tem de ser verificável no produto. Se ela descreve uma FUNÇÃO, tem
 * de valer para os quatro tiers e morar em `PLAN_FEATURES`; uma função que só
 * vale para um plano pertence a um gate que ainda não existe, não a este
 * arquivo. Só compromisso de ATENDIMENTO pode variar por tier.
 */
export const PLAN_FEATURES: readonly string[] = [
  'Contratos, cobranças, multas, manutenções',
  'Assinatura eletrônica com validade jurídica',
  'Cobranças automáticas por Asaas e Stripe',
  'Vistoria digital completa em 14 ângulos por veículo',
  'Multi-usuário com controle de acesso',
  'Usuários e papéis ilimitados',
  'Suporte por WhatsApp',
];

/**
 * A ÚNICA promessa que varia por tier, escrita uma vez.
 *
 * Era um literal repetido duas vezes em `PLAN_FEATURE_EXTRAS` e, pior, uma
 * terceira vez com outras palavras ("Suporte prioritário") na tabela
 * comparativa do billing — que ainda por cima dava a linha só ao PRO. Duas
 * grafias e dois donos da mesma regra foi exatamente como a mesma tela passou a
 * fazer duas afirmações diferentes com um scroll de distância. Quem quiser
 * mostrar essa promessa agora nomeia esta constante ou pergunta a
 * `hasPrioritySupport()`; ninguém redigita a frase.
 */
export const PRIORITY_SUPPORT_FEATURE = 'Atendimento prioritário no WhatsApp';

/**
 * O acréscimo por tier — hoje só a prioridade de atendimento, do PRO em diante.
 *
 * É um `Record` completo, e não um mapa parcial, para que um quinto tier não
 * compile até alguém DECIDIR se ele entra na fila prioritária ou não. Silêncio
 * por omissão foi como o STARTER herdou a lista do TRIAL uma vez.
 */
export const PLAN_FEATURE_EXTRAS: Readonly<Record<PlanTier, readonly string[]>> = {
  TRIAL: [],
  STARTER: [],
  PRO: [PRIORITY_SUPPORT_FEATURE],
  ENTERPRISE: [PRIORITY_SUPPORT_FEATURE],
};

/**
 * A lista final de bullets qualitativos de um tier: o compartilhado mais o
 * acréscimo dele. Um `name` que não normaliza para tier nenhum recebe só o
 * compartilhado — nunca a prioridade, que é o que se paga para ter.
 */
export function planFeaturesFor(tier: PlanTier | null): readonly string[] {
  return tier ? [...PLAN_FEATURES, ...PLAN_FEATURE_EXTRAS[tier]] : PLAN_FEATURES;
}

/**
 * Este tier tem atendimento prioritário?
 *
 * Existe para a TABELA comparativa, que precisa de um booleano por coluna
 * (✓/—) onde o card precisa de uma lista de frases. A resposta sai de
 * `planFeaturesFor()`, e não de uma segunda leitura de `PLAN_FEATURE_EXTRAS`,
 * de propósito: assim a marca da tabela é literalmente uma pergunta sobre a
 * MESMA lista que o card imprime. Não existe estado em que a coluna mostre ✓ e
 * o card do mesmo plano não traga a frase — que é a contradição que esta
 * função foi escrita para tornar impossível.
 *
 * Antes a tabela gastava `isRecommended(plan)`, que responde "este é o card
 * destacado?" (só o PRO) e nunca teve nada a ver com fila de atendimento. O
 * ENTERPRISE pagava por prioridade e levava um travessão.
 */
export function hasPrioritySupport(tier: PlanTier | null): boolean {
  return planFeaturesFor(tier).includes(PRIORITY_SUPPORT_FEATURE);
}

/**
 * O ARRANJO em que a grade está sendo desenhada — e, por consequência, a
 * redação da linha de herança.
 *
 * Não é o tier, e não é o breakpoint: é a DIREÇÃO em que a escada aparece na
 * tela. `'catalog'` é TRIAL → ENTERPRISE (a ordem do catálogo, que as telas
 * mostram a partir de `md`/`sm`); `'reversed'` é ENTERPRISE → TRIAL, o arranjo
 * de telefone que o dono pediu.
 *
 * Existe porque "o plano anterior" é uma afirmação sobre o que o leitor
 * ACABOU de ver, e ela vira mentira quando a grade inverte: no telefone o
 * primeiro card é o ENTERPRISE e não há nada antes dele. Quem escolhe a ordem
 * tem de escolher a frase no mesmo lugar, senão as duas divergem em silêncio —
 * ver `planInheritanceLine()`.
 */
export type PlanLadderArrangement = 'catalog' | 'reversed';

/**
 * A frase da herança para o arranjo de TELEFONE, onde a escada desce.
 *
 * Mesma promessa, apontando para o outro lado. Ela é tão verdadeira quanto a
 * de cima e pelo mesmo motivo (capacidade e atendimento são monotônicos na
 * ordem do catálogo); o que muda é para onde o leitor tem de olhar.
 */
export const PLAN_INHERITANCE_LINE_DOWNWARD = 'Tudo o que os planos abaixo têm';

/**
 * A redação da herança para o arranjo em que a grade está sendo desenhada.
 *
 * É a ÚNICA porta para as duas frases. Um `if (isPhone)` numa tela e outro na
 * outra é exatamente como uma delas ficaria para trás numa mudança de cópia.
 */
export function planInheritanceLine(arrangement: PlanLadderArrangement = 'catalog'): string {
  return arrangement === 'reversed' ? PLAN_INHERITANCE_LINE_DOWNWARD : PLAN_INHERITANCE_LINE;
}

/**
 * Quantos bullets COMPARTILHADOS o card do degrau de baixo imprime antes de
 * resumir o resto numa linha só.
 *
 * <h4>Por que existe um teto</h4>
 * O TRIAL mostrava as sete frases; os degraus acima mostram a herança mais o
 * delta deles, que é quase só o teto novo — três, quatro bullets. Sob
 * `items-stretch` todo card cresce até a altura do mais alto, então o TRIAL
 * ditava a altura da fileira inteira e sobrava um vão de umas dez linhas em
 * cima do botão dos outros três. Duas consequências, e a segunda é comercial:
 *
 *   · o card em DESTAQUE, que é o que precisa vender, virava a caixa mais
 *     vazia da grade;
 *   · o plano GRÁTIS ficava com a lista mais longa e lia como a oferta mais
 *     generosa da tela.
 *
 * O teto corta o excesso pelo lado certo — o do plano que não se paga — sem
 * mexer no modelo de herança e sem devolver a nenhum tier pago uma linha de
 * capacidade que o backend não porteia (isso continua proibido, e
 * `plan-features.spec.ts` continua guardando).
 *
 * As `PLAN_FEATURES` estão em ordem de importância, então `slice` do começo é o
 * corte editorialmente certo, não um corte arbitrário.
 *
 * <h4>Por que UM, e não dois ou três</h4>
 * O teto é escolhido pela ALTURA que ele produz, não pelo gosto. Com um bullet
 * compartilhado mais a linha de resumo, o TRIAL fecha em quatro itens / seis
 * linhas de texto — exatamente o que o PRO ocupa (herança + dois tetos +
 * prioridade). A fileira inteira passa a caber em duas linhas de folga, e o card
 * em destaque deixa de ter vão nenhum acima do botão. Com dois, o TRIAL volta a
 * ser o mais alto e sobram quatro linhas de vazio no STARTER.
 *
 * A frase que sobrevive ao corte é a que descreve o produto inteiro numa linha;
 * o resto do catálogo de funcionalidades tem uma seção própria na landing.
 */
export const PLAN_SHARED_FEATURE_CAP = 1;

/**
 * A linha que fecha a lista do degrau de baixo com o que o teto deixou de fora.
 *
 * O número é DERIVADO de `PLAN_FEATURES`, nunca digitado: acrescentar uma
 * oitava frase compartilhada tem de mexer no "+6" sozinho. E ela fala de TODOS
 * os planos de propósito — é a mesma promessa nos quatro degraus, então não
 * vende escada nenhuma.
 */
export function planSharedRollupLine(): string {
  return `+${PLAN_FEATURES.length - PLAN_SHARED_FEATURE_CAP} recursos inclusos em todos os planos`;
}

/**
 * A lista COMPLETA que um card imprime — a única fonte das duas telas.
 *
 * O TRIAL, sendo o degrau de baixo, é o card em que o visitante descobre o que
 * o produto faz: ele mostra a capacidade, os primeiros bullets compartilhados e
 * uma linha contando o resto (ver `PLAN_SHARED_FEATURE_CAP`). Todo tier acima
 * abre com a herança e mostra só o seu DELTA, que é sempre pouca coisa — a
 * capacidade nova e, na estreia dela, a prioridade de atendimento. O ENTERPRISE
 * não repete a prioridade: ela já entrou no PRO e a linha de herança a carrega.
 *
 * `capacityLines` vem de fora de propósito. A landing é pública e escreve os
 * números à mão (`planCapacityLine`), o billing recebe os do próprio registro da
 * API — o card autenticado nunca pode contradizer o plano que o backend vende.
 * O que esta função garante é que as duas telas montem a lista com a MESMA
 * regra, que é o que faltava quando cada uma somava `PLAN_FEATURES` por conta.
 *
 * `arrangement` é a direção em que a grade está desenhada, e ele só afeta a
 * REDAÇÃO da herança — nunca a composição. Quem inverte a ordem dos cards tem
 * de passar `'reversed'` aqui pelo mesmo caminho, senão o primeiro card do
 * telefone promete "o plano anterior" sem ter nenhum antes dele.
 */
export function planCardFeatureLines(
  tier: PlanTier | null,
  capacityLines: readonly string[],
  arrangement: PlanLadderArrangement = 'catalog',
): readonly string[] {
  // Tier desconhecido cai no comportamento do degrau de baixo. Uma linha de
  // herança num card cujo "anterior" a UI não sabe qual é seria uma promessa
  // sem referente.
  if (tier === null || tier === 'TRIAL') {
    return [
      ...capacityLines,
      ...PLAN_FEATURES.slice(0, PLAN_SHARED_FEATURE_CAP),
      planSharedRollupLine(),
    ];
  }

  const index = PLAN_TIER_ORDER.indexOf(tier);
  const previous = PLAN_TIER_ORDER[index - 1];
  // O delta REAL: só o que este tier acrescenta ao anterior. Subtrair em vez de
  // redigitar é o que impede o ENTERPRISE de reanunciar a prioridade do PRO.
  const inherited = new Set(planFeaturesFor(previous));
  const additions = PLAN_FEATURE_EXTRAS[tier].filter((item) => !inherited.has(item));

  return [planInheritanceLine(arrangement), ...capacityLines, ...additions];
}

/**
 * A ordem do catálogo, do menor para o maior. É ELA que dá sentido à linha de
 * herança abaixo: "o plano anterior" é o degrau imediatamente anterior NESTA
 * lista, não o card que por acaso está acima na tela (no telefone a grade sai
 * invertida, por decisão do dono).
 */
export const PLAN_TIER_ORDER: readonly PlanTier[] = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];

/**
 * A linha de herança que abre todo card acima do TRIAL.
 *
 * <h4>Por que ela é honesta aqui — e por que a nota de paridade morreu</h4>
 * A versão anterior desta tela repetia a MESMA lista de sete bullets nos quatro
 * cards e imprimia uma nota acima da grade pedindo desculpa pela repetição. Era
 * informação demais para quem só quer escolher: sete linhas idênticas quatro
 * vezes, mais um parágrafo explicando que são idênticas.
 *
 * A herança diz a mesma verdade com uma linha. E ela É verdade: todo tier tem
 * literalmente tudo o que o de baixo tem — os quatro rodam o mesmo software, e
 * as duas coisas que de fato escalam (o teto de frota e, do PRO em diante, a
 * prioridade do atendimento) são MONOTÔNICAS na ordem acima. Não existe tier que
 * perca algo ao subir, que é a única maneira de uma linha de herança mentir.
 *
 * O que continua proibido é o que sempre foi: anunciar FUNÇÃO exclusiva de tier
 * ("Integrações premium", "Gerente de conta", "SLA"). Herança de CAPACIDADE e de
 * ATENDIMENTO é real; herança de funcionalidade seria a escada que o backend não
 * implementa. `plan-features.spec.ts` guarda exatamente essa fronteira.
 *
 * <h4>Esta é a redação do arranjo do CATÁLOGO</h4>
 * "O plano anterior" só existe quando a escada sobe na tela. No telefone ela
 * desce, e a frase vira `PLAN_INHERITANCE_LINE_DOWNWARD`. Ninguém escolhe entre
 * as duas na mão: `planInheritanceLine(arrangement)` é a única porta.
 */
export const PLAN_INHERITANCE_LINE = 'Tudo o que o plano anterior tem';

/**
 * Uma linha de posicionamento por tier, usada como `description` do card.
 *
 * Pode falar de TAMANHO e de ATENDIMENTO — as duas coisas que realmente variam.
 * Nenhuma delas pode citar função exclusiva: a antiga do ENTERPRISE prometia
 * "integrações premium, suporte dedicado", coisas que nenhum plano tem.
 */
export const PLAN_DESCRIPTION: Readonly<Record<PlanTier, string>> = {
  TRIAL: 'Coloque seus primeiros carros e veja rodando. 14 dias, sem cartão.',
  STARTER:
    'Saia da planilha de vez. Até 15 carros e 45 motoristas, com contrato e cobrança no automático.',
  PRO: 'A frota cresceu e o suporte acompanha: 25 carros, 75 motoristas e sua mensagem na frente da fila.',
  ENTERPRISE:
    'Frota e motoristas ilimitados, com atendimento prioritário. Para quem não quer pensar em teto.',
};

/**
 * Normaliza o `name` vindo da API para um tier do catálogo.
 *
 * A normalização é a de `plan-limits.ts`, não uma cópia: os dois pontos que
 * comparam `plans.name` têm de concordar sobre o que é " enterprise ".
 */
export function planTierOf(planName: string | null | undefined): PlanTier | null {
  switch (normalizePlanName(planName)) {
    case 'TRIAL':
    case 'FREE':
      return 'TRIAL';
    case 'STARTER':
      return 'STARTER';
    case 'PRO':
      return 'PRO';
    // `BUSINESS` é o nome legado da linha que hoje se chama ENTERPRISE. Enquanto
    // existir uma linha antiga na `plans`, ela precisa cair no mesmo tier.
    case 'BUSINESS':
    case 'ENTERPRISE':
      return 'ENTERPRISE';
    default:
      return null;
  }
}
