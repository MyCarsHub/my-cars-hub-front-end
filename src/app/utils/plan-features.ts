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
 * A frase que explica as listas quase idênticas de todo card, e que precisa
 * aparecer UMA vez perto da grade nas duas telas de planos. Sem ela, quatro
 * listas parecidas parecem erro de copy em vez do argumento de venda que são.
 *
 * A versão anterior dizia "todos os planos têm as mesmas funcionalidades" e
 * deixou de ser verdade no dia em que o atendimento passou a ter fila: a nota
 * tem de nomear a gradação, ou ela desmente os próprios cards um scroll abaixo.
 */
export const PLAN_PARITY_NOTE =
  'O produto é o mesmo nos quatro planos. O que muda é quantos carros cabem — e, do Pro em diante, ' +
  'a prioridade no seu atendimento.';

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
