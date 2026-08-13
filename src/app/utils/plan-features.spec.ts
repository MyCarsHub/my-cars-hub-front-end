import { describe, expect, it } from 'vitest';
import {
  PLAN_DESCRIPTION,
  PLAN_FEATURE_EXTRAS,
  PLAN_FEATURES,
  PLAN_INHERITANCE_LINE,
  PLAN_INHERITANCE_LINE_DOWNWARD,
  PLAN_SHARED_FEATURE_CAP,
  PLAN_TIER_ORDER,
  PRIORITY_SUPPORT_FEATURE,
  hasPrioritySupport,
  planCardFeatureLines,
  planFeaturesFor,
  planInheritanceLine,
  planSharedRollupLine,
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
   *   • PERMITIDA — a linha de HERANÇA ("tudo o que o plano anterior tem").
   *     Esta entrada era PROIBIDA, e a proibição foi retirada de propósito, não
   *     por descuido. O motivo dela era que "herança" sugeria um superconjunto
   *     de FUNÇÕES, e superconjunto de funções não existe. Mas a herança que a
   *     cópia anuncia hoje é de CAPACIDADE e de ATENDIMENTO, e essas duas são
   *     monotônicas na ordem do catálogo: nenhum tier perde teto nem sai da fila
   *     prioritária ao subir. A afirmação é literalmente verdadeira, e é o que
   *     substituiu sete bullets repetidos quatro vezes.
   *
   * O que continua proibido é o que sempre foi o problema real: FUNÇÃO exclusiva
   * de tier. Apagar estas asserções devolveria o caminho pelo qual a escada não
   * implementada volta a crescer bullet por bullet.
   */
  it('não promete nenhuma FUNÇÃO exclusiva de tier — essas exigiriam um gate que não existe', () => {
    const everything = [
      ...PLAN_FEATURES,
      ...Object.values(PLAN_FEATURE_EXTRAS).flat(),
      ...Object.values(PLAN_DESCRIPTION),
      PLAN_INHERITANCE_LINE,
      // A herança tem DUAS redações desde que o telefone passou a inverter a
      // escada. As duas passam pelo mesmo guarda — uma frase nova entrando pela
      // variante de telefone escaparia daqui tão facilmente quanto pela outra.
      PLAN_INHERITANCE_LINE_DOWNWARD,
      planSharedRollupLine(),
      // A lista REAL de cada card, e não só as constantes: é ela que o usuário
      // lê, e é nela que uma frase nova entraria sem passar por este guarda. Os
      // DOIS arranjos, pelo mesmo motivo.
      ...PLAN_TIER_ORDER.flatMap((tier) => planCardFeatureLines(tier, [], 'catalog')),
      ...PLAN_TIER_ORDER.flatMap((tier) => planCardFeatureLines(tier, [], 'reversed')),
    ].join(' | ');

    for (const claim of [
      'Integrações premium',
      'Gerente de conta',
      'SLA',
      'Relatórios avançados exportáveis',
      'Onboarding assistido dedicado',
    ]) {
      expect(everything).not.toContain(claim);
    }
  });

  /**
   * A herança precisa ser exatamente uma frase, e a mesma nas duas telas. Duas
   * grafias da mesma promessa foi como a tabela do billing passou a dizer
   * "Suporte prioritário" enquanto o card ao lado dizia outra coisa.
   */
  it('publica a linha de herança como constante única', () => {
    expect(PLAN_INHERITANCE_LINE).toBe('Tudo o que o plano anterior tem');
    expect(PLAN_TIER_ORDER).toEqual(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']);
  });

  /**
   * ═══ A REDAÇÃO SEGUE O ARRANJO, NÃO O TIER ═══
   *
   * "O plano anterior" é uma afirmação sobre o que o leitor ACABOU de ver, e ela
   * fica falsa quando a grade inverte: no telefone o primeiro card é o
   * ENTERPRISE e não existe nada antes dele. O dono decidiu manter a inversão e
   * virar a frase, então quem escolhe a ordem tem de escolher a frase — daí as
   * duas saírem da mesma função, indexadas pelo arranjo e não pelo degrau.
   *
   * Um card NÃO é "a variante ENTERPRISE da frase"; é "a frase de um card que
   * tem planos abaixo dele na tela". Se um dia alguém fizer a redação depender
   * do tier, este bloco quebra.
   */
  describe('planInheritanceLine', () => {
    it('aponta para cima no catálogo e para baixo no arranjo invertido', () => {
      expect(planInheritanceLine('catalog')).toBe('Tudo o que o plano anterior tem');
      expect(planInheritanceLine('reversed')).toBe('Tudo o que os planos abaixo têm');
      expect(PLAN_INHERITANCE_LINE_DOWNWARD).toBe('Tudo o que os planos abaixo têm');
    });

    // O default é o catálogo: quem não sabe em que arranjo está não pode receber
    // a frase que só vale no telefone.
    it('assume o catálogo quando ninguém informa o arranjo', () => {
      expect(planInheritanceLine()).toBe(PLAN_INHERITANCE_LINE);
      expect(planCardFeatureLines('PRO', [])[0]).toBe(PLAN_INHERITANCE_LINE);
    });

    it('usa a redação do arranjo em TODO tier acima do TRIAL', () => {
      for (const tier of ['STARTER', 'PRO', 'ENTERPRISE'] as const) {
        expect(planCardFeatureLines(tier, [], 'catalog')[0]).toBe(PLAN_INHERITANCE_LINE);
        expect(planCardFeatureLines(tier, [], 'reversed')[0]).toBe(PLAN_INHERITANCE_LINE_DOWNWARD);
      }
    });

    /**
     * O arranjo mexe SÓ na primeira linha. Se ele passar a mexer na composição,
     * o telefone e o desktop viram duas ofertas diferentes do mesmo plano.
     */
    it('não muda mais nada da lista além da frase de herança', () => {
      for (const tier of PLAN_TIER_ORDER) {
        const catalog = planCardFeatureLines(tier, ['Até 15 veículos'], 'catalog');
        const reversed = planCardFeatureLines(tier, ['Até 15 veículos'], 'reversed');

        expect(reversed.length).toBe(catalog.length);
        expect(reversed.slice(1)).toEqual(catalog.slice(1));
      }
    });
  });

  /**
   * ═══ A LISTA QUE O CARD REALMENTE IMPRIME ═══
   *
   * O TRIAL é onde o visitante descobre o produto, mas com TETO. Todo tier acima
   * abre com a herança e mostra só o DELTA dele. Repetir os sete bullets nos
   * quatro cards era o excesso de informação que o dono reclamou.
   */
  describe('planCardFeatureLines', () => {
    it('abre o TRIAL pela capacidade e sem linha de herança', () => {
      const lines = planCardFeatureLines('TRIAL', ['Até 3 veículos']);

      expect(lines).not.toContain(PLAN_INHERITANCE_LINE);
      expect(lines).not.toContain(PLAN_INHERITANCE_LINE_DOWNWARD);
      expect(lines[0]).toBe('Até 3 veículos');
    });

    /**
     * ═══ O TETO DO CARD DE BAIXO, QUE É UM PROBLEMA COMERCIAL ═══
     *
     * O TRIAL imprimia as sete frases compartilhadas e chegava a nove bullets
     * contra três do STARTER. Sob `items-stretch` todo card cresce até a altura
     * do mais alto, e o resultado tinha duas consequências, a segunda pior que a
     * primeira: o card em DESTAQUE — o que precisa vender — virava a caixa mais
     * vazia da fileira, e o plano GRÁTIS lia como a oferta mais generosa da
     * tela.
     *
     * O teto corta pelo lado certo. O que ele NÃO pode virar é a porta de volta
     * para a repetição: se alguém subir o cap para sete, a grade desequilibra
     * de novo exatamente como antes.
     */
    it('corta a lista compartilhada do TRIAL no teto e conta o resto numa linha', () => {
      const lines = planCardFeatureLines('TRIAL', ['Até 3 veículos', 'Até 4 motoristas']);

      expect(PLAN_SHARED_FEATURE_CAP).toBeLessThan(PLAN_FEATURES.length);
      for (const feature of PLAN_FEATURES.slice(0, PLAN_SHARED_FEATURE_CAP)) {
        expect(lines).toContain(feature);
      }
      for (const feature of PLAN_FEATURES.slice(PLAN_SHARED_FEATURE_CAP)) {
        expect(lines).not.toContain(feature);
      }

      // A linha final declara quantas ficaram de fora, e o número é DERIVADO —
      // uma oitava frase compartilhada tem de mexer nele sozinha.
      expect(lines.at(-1)).toBe(planSharedRollupLine());
      expect(planSharedRollupLine()).toContain(
        String(PLAN_FEATURES.length - PLAN_SHARED_FEATURE_CAP),
      );
    });

    /**
     * O equilíbrio é o ponto: nenhum card pode ficar com uma lista muito maior
     * que a dos vizinhos, senão volta o vão acima do botão dos outros três. Duas
     * linhas de folga é o que a grade absorve sem parecer buraco.
     */
    it('mantém os quatro cards com listas de tamanho comparável', () => {
      const lengths = PLAN_TIER_ORDER.map(
        (tier) => planCardFeatureLines(tier, ['Até N veículos', 'Até N motoristas']).length,
      );

      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(2);
      // E o card em destaque não pode ser o mais curto da fileira.
      const pro = planCardFeatureLines('PRO', ['Até N veículos', 'Até N motoristas']).length;
      expect(pro).toBe(Math.max(...lengths));
    });

    it('abre todo tier acima do TRIAL com a herança e corta a lista compartilhada', () => {
      for (const tier of ['STARTER', 'PRO', 'ENTERPRISE'] as const) {
        const lines = planCardFeatureLines(tier, ['Até 15 veículos']);

        expect(lines[0]).toBe(PLAN_INHERITANCE_LINE);
        expect(lines).toContain('Até 15 veículos');
        // O que a herança já cobre não pode ser reimpresso.
        for (const feature of PLAN_FEATURES) {
          expect(lines).not.toContain(feature);
        }
      }
    });

    /**
     * O delta é SUBTRAÍDO do tier anterior, não redigitado. A prioridade estreia
     * no PRO; no ENTERPRISE ela já está dentro da herança, e reanunciá-la
     * sugeriria que o PRO não a tem.
     */
    it('anuncia a prioridade só onde ela ESTREIA', () => {
      expect(planCardFeatureLines('PRO', [])).toContain(PRIORITY_SUPPORT_FEATURE);
      expect(planCardFeatureLines('ENTERPRISE', [])).not.toContain(PRIORITY_SUPPORT_FEATURE);
      expect(planCardFeatureLines('STARTER', [])).not.toContain(PRIORITY_SUPPORT_FEATURE);
      expect(planCardFeatureLines('TRIAL', [])).not.toContain(PRIORITY_SUPPORT_FEATURE);
    });

    /**
     * Um `name` que não normaliza para tier nenhum cai no comportamento do
     * degrau de baixo — lista inteira, sem herança. Uma linha de herança num
     * card cujo "anterior" a UI não sabe qual é seria promessa sem referente.
     */
    it('não promete herança para um tier desconhecido', () => {
      const lines = planCardFeatureLines(null, ['Até 3 veículos']);

      expect(lines).not.toContain(PLAN_INHERITANCE_LINE);
      expect(lines).not.toContain(PLAN_INHERITANCE_LINE_DOWNWARD);
      expect(lines).toEqual(planCardFeatureLines('TRIAL', ['Até 3 veículos']));
      expect(lines).not.toContain(PRIORITY_SUPPORT_FEATURE);
    });
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
});
