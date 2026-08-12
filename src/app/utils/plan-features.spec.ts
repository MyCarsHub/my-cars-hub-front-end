import { describe, expect, it } from 'vitest';
import {
  PLAN_DESCRIPTION,
  PLAN_FEATURE_EXTRAS,
  PLAN_FEATURES,
  PLAN_PARITY_NOTE,
  PRIORITY_SUPPORT_FEATURE,
  hasPrioritySupport,
  planFeaturesFor,
  planTierOf,
} from './plan-features';

describe('plan-features', () => {
  /**
   * `planTierOf` decide o tom do card, a fita, a descrição e o hero de billing.
   * Um `name` com espaço ou caixa diferente caindo em `null` degradaria os
   * quatro de uma vez, e em silêncio.
   */
  describe('planTierOf', () => {
    it('normaliza caixa e espaços do name vindo da API', () => {
      expect(planTierOf(' enterprise ')).toBe('ENTERPRISE');
      expect(planTierOf('Pro')).toBe('PRO');
      expect(planTierOf('\tstarter\n')).toBe('STARTER');
      expect(planTierOf('trial')).toBe('TRIAL');
    });

    // `FREE` e `BUSINESS` são nomes legados de linhas que ainda podem estar na
    // `plans`; caem no mesmo tier das novas, sem `if` espalhado pelas telas.
    it('mapeia os nomes legados para o tier atual', () => {
      expect(planTierOf('FREE')).toBe('TRIAL');
      expect(planTierOf('BUSINESS')).toBe('ENTERPRISE');
    });

    it('devolve null para plano desconhecido, sem chutar um tier', () => {
      expect(planTierOf('PLATINUM')).toBeNull();
      expect(planTierOf(null)).toBeNull();
      expect(planTierOf(undefined)).toBeNull();
      expect(planTierOf('')).toBeNull();
    });
  });

  /**
   * ═══ A DISTINÇÃO QUE ESTE BLOCO EXISTE PARA GUARDAR ═══
   *
   * Nem toda promessa por tier é o mesmo tipo de promessa, e a versão anterior
   * deste spec tratava as duas como uma só — proibia a string "Suporte
   * prioritário" junto com "Integrações premium", como se fossem o mesmo
   * problema. Não são:
   *
   *   • PROIBIDA — capacidade de SOFTWARE que exigiria um gate no backend para
   *     ser verdade. O backend aplica EXATAMENTE dois limites (`vehicle_limit`,
   *     `driver_limit`) e nenhum gate de funcionalidade; qualquer função
   *     anunciada como exclusiva de um tier é, literalmente, mentira no ar. Foi
   *     assim que o PRO ganhou "Relatórios avançados" e o ENTERPRISE, "Gerente
   *     de conta" — nenhum dos dois existe em linha de código nenhuma.
   *
   *   • PERMITIDA — canal e PRIORIDADE de atendimento. Não depende de código
   *     para ser honrada: é compromisso operacional que o dono assumiu
   *     pessoalmente, e ele responde por ele no WhatsApp. Um humano priorizando
   *     uma fila é entrega real, mesmo sem uma linha de `if` por trás.
   *
   * Por isso as asserções de ausência NÃO foram apagadas quando a prioridade
   * entrou na cópia: apagá-las devolveria o caminho pelo qual a escada não
   * implementada volta a crescer bullet por bullet. Elas foram reescritas para
   * proibir a categoria certa.
   */
  it('não promete nenhuma FUNÇÃO exclusiva de tier — essas exigiriam um gate que não existe', () => {
    const everything = [
      ...PLAN_FEATURES,
      ...Object.values(PLAN_FEATURE_EXTRAS).flat(),
      ...Object.values(PLAN_DESCRIPTION),
      PLAN_PARITY_NOTE,
    ].join(' | ');

    for (const claim of [
      'Integrações premium',
      'Gerente de conta',
      'SLA',
      'Relatórios avançados exportáveis',
      'Onboarding assistido dedicado',
      // Linha de herança: sugere que o tier de cima roda um superconjunto do de
      // baixo. Não existe herança — os quatro rodam o mesmo software.
      'Tudo que o plano',
    ]) {
      expect(everything).not.toContain(claim);
    }
  });

  it('promete o canal de atendimento a TODO tier — isso é operacional, não software', () => {
    expect(PLAN_FEATURES).toContain('Suporte por WhatsApp');

    for (const tier of ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] as const) {
      expect(planFeaturesFor(tier)).toContain('Suporte por WhatsApp');
    }
  });

  /**
   * A prioridade é a ÚNICA coisa que varia por tier além do teto de frota. Se
   * ela vazar para TRIAL/STARTER, o cliente do PRO deixou de comprar algo; se
   * sumir do PRO/ENTERPRISE, ele pagou por algo que o card não anuncia mais.
   */
  it('dá a prioridade de atendimento só ao PRO e ao ENTERPRISE', () => {
    const priority = 'Atendimento prioritário no WhatsApp';

    expect(PLAN_FEATURE_EXTRAS.PRO).toEqual([priority]);
    expect(PLAN_FEATURE_EXTRAS.ENTERPRISE).toEqual([priority]);
    expect(PLAN_FEATURE_EXTRAS.TRIAL).toEqual([]);
    expect(PLAN_FEATURE_EXTRAS.STARTER).toEqual([]);

    expect(planFeaturesFor('PRO')).toContain(priority);
    expect(planFeaturesFor('ENTERPRISE')).toContain(priority);
    expect(planFeaturesFor('TRIAL')).not.toContain(priority);
    expect(planFeaturesFor('STARTER')).not.toContain(priority);

    // `name` que não normaliza para tier nenhum: recebe o compartilhado e nunca
    // a prioridade — ela é justamente o que se paga para ter.
    expect(planFeaturesFor(null)).toEqual(PLAN_FEATURES);
    expect(planFeaturesFor(null)).not.toContain(priority);
  });

  /**
   * `hasPrioritySupport` é a forma BOOLEANA da mesma promessa, criada para a
   * tabela comparativa do billing, que precisa de ✓/— por coluna onde o card
   * precisa de uma lista de frases. Ela tem de concordar com `planFeaturesFor`
   * em todo tier: uma coluna marcada ✓ cujo card não traz a frase é exatamente
   * a contradição de uma tela só que ela existe para impedir.
   */
  it('responde a prioridade em booleano sem divergir da lista do card', () => {
    for (const tier of ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] as const) {
      expect(hasPrioritySupport(tier)).toBe(
        planFeaturesFor(tier).includes(PRIORITY_SUPPORT_FEATURE),
      );
    }

    expect(hasPrioritySupport('PRO')).toBe(true);
    expect(hasPrioritySupport('ENTERPRISE')).toBe(true);
    expect(hasPrioritySupport('TRIAL')).toBe(false);
    expect(hasPrioritySupport('STARTER')).toBe(false);
    // Plano não reconhecido não ganha de graça o que se paga para ter.
    expect(hasPrioritySupport(null)).toBe(false);
  });

  /**
   * A frase é UMA. Ela era digitada duas vezes no record e uma terceira, com
   * outras palavras ("Suporte prioritário"), na tabela do billing — e foi a
   * terceira grafia que virou uma regra própria e passou a contradizer o card.
   */
  it('exporta a promessa de prioridade como constante única', () => {
    expect(PRIORITY_SUPPORT_FEATURE).toBe('Atendimento prioritário no WhatsApp');
    expect(PLAN_FEATURE_EXTRAS.PRO).toEqual([PRIORITY_SUPPORT_FEATURE]);
    expect(PLAN_FEATURE_EXTRAS.ENTERPRISE).toEqual([PRIORITY_SUPPORT_FEATURE]);
  });

  /**
   * As descrições podem citar TAMANHO e ATENDIMENTO, as duas coisas que de fato
   * variam. A regra antiga ("só tamanho") caiu com a cópia aprovada: o STARTER
   * cita contrato e cobrança no automático, que TODO plano tem — mencionar uma
   * função compartilhada não é vender exclusividade. O que a asserção guarda é
   * que a linguagem de prioridade não desça para os dois tiers de baixo.
   */
  it('só fala de prioridade nas descrições do PRO e do ENTERPRISE', () => {
    for (const description of Object.values(PLAN_DESCRIPTION)) {
      expect(description.length).toBeGreaterThan(0);
    }

    expect(PLAN_DESCRIPTION.PRO).toContain('na frente da fila');
    expect(PLAN_DESCRIPTION.ENTERPRISE).toContain('atendimento prioritário');

    for (const description of [PLAN_DESCRIPTION.TRIAL, PLAN_DESCRIPTION.STARTER]) {
      expect(description).not.toContain('prioritário');
      expect(description).not.toContain('prioridade');
      expect(description).not.toContain('fila');
    }
  });

  /**
   * A nota impressa acima da grade nas DUAS telas. Ela não pode mais dizer que
   * os planos são idênticos — o atendimento passou a ter fila, e uma nota que
   * negue isso desmente os cards um scroll abaixo dela.
   */
  it('publica a frase de paridade que as duas telas imprimem', () => {
    expect(PLAN_PARITY_NOTE).toContain('O produto é o mesmo nos quatro planos');
    expect(PLAN_PARITY_NOTE).toContain('quantos carros cabem');
    expect(PLAN_PARITY_NOTE).toContain('do Pro em diante, a prioridade no seu atendimento');
    expect(PLAN_PARITY_NOTE).not.toContain('mesmas funcionalidades');
  });
});
