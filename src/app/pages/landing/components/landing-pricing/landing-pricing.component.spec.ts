import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingPricingComponent } from './landing-pricing.component';

/**
 * `revealOnScroll()` registra um IntersectionObserver dentro de
 * `afterNextRender`, e o jsdom não implementa a API. Sem este stub, qualquer
 * teste que chame `detectChanges()` estoura antes de chegar à asserção.
 */
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('LandingPricingComponent', () => {
  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingPricingComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingPricingComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  // A landing pública não tem sessão e `GET /v1/billing/plans` exige auth, então
  // estes números são escritos à mão. Este teste é o único guarda-corpo contra
  // eles voltarem a divergir da tabela `plans` — se um limite mudar no backend,
  // ele quebra aqui e força a atualização em vez de a landing mentir calada.
  it('anuncia exatamente os limites que o backend entrega', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;

    // TRIAL 3/4 — V59:310-313.
    expect(c.trialItems).toContain('Até 3 veículos');
    expect(c.trialItems).toContain('Até 4 motoristas');

    // STARTER 15/45 — V59:315-318.
    expect(c.starterItems).toContain('Até 15 veículos');
    expect(c.starterItems).toContain('Até 45 motoristas');

    // PRO 25/75 — V59:320-323.
    expect(c.proItems).toContain('Até 25 veículos');
    expect(c.proItems).toContain('Até 75 motoristas');
  });

  // O ENTERPRISE tem teto real (100/300 depois da V59:325-328; eram 500/1000 na
  // V44) e mesmo assim é vendido como ilimitado — maquiagem deliberada de
  // produto. O que não pode acontecer é o número vazar para a landing.
  it('apresenta o ENTERPRISE como ilimitado, sem expor 100/300', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;

    expect(c.enterpriseItems).toContain('Veículos ilimitados');
    expect(c.enterpriseItems).toContain('Motoristas ilimitados');

    const joined = c.enterpriseItems.join(' | ');
    expect(joined).not.toContain('100');
    expect(joined).not.toContain('300');
    // O teto antigo também não pode reaparecer numa cópia esquecida.
    expect(joined).not.toContain('500');
    expect(joined).not.toContain('1000');
  });

  // Guarda-corpo contra a landing voltar a prometer o que a V43 prometia, e
  // contra o PRO herdar o teto do STARTER agora que 15 é um número do catálogo.
  it('não promete mais motoristas ilimitados no PRO', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;

    expect(c.proItems).not.toContain('Motoristas ilimitados');
    expect(c.proItems).not.toContain('Até 15 veículos');
    expect(c.proItems).not.toContain('Até 20 veículos');
  });

  /**
   * A composição da lista é de `planCardFeatureLines()`; aqui o que se confere é
   * que a landing REALMENTE a consome, em vez de voltar a somar `PLAN_FEATURES`
   * nas quatro listas — que é como a tela ficou com sete bullets repetidos
   * quatro vezes e uma nota acima da grade pedindo desculpa por isso.
   */
  it('abre os cards pagos com a herança e o TRIAL com a capacidade', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;
    const inheritance = 'Tudo o que o plano anterior tem';

    expect(c.trialItems).not.toContain(inheritance);
    expect(c.trialItems).toContain('Contratos, cobranças, multas, manutenções');

    for (const items of [c.starterItems, c.proItems, c.enterpriseItems]) {
      expect(items[0]).toBe(inheritance);
      expect(items).not.toContain('Contratos, cobranças, multas, manutenções');
    }
  });

  /**
   * O TRIAL ditava a altura da fileira com nove bullets contra três do STARTER —
   * e sob `items-stretch` isso punha um vão de umas dez linhas acima do botão
   * dos outros três, com o card em DESTAQUE virando a caixa mais vazia da grade
   * e o plano GRÁTIS lendo como a oferta mais generosa da tela. O teto de
   * `plan-features.ts` corta pelo lado certo; aqui se confere o RESULTADO, com
   * os números reais desta página.
   */
  it('deixa os quatro cards com listas equilibradas, e o destaque não é o mais curto', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;
    const lengths = [c.trialItems, c.starterItems, c.proItems, c.enterpriseItems].map(
      (items) => items.length,
    );

    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(2);
    expect(c.proItems.length).toBe(Math.max(...lengths));
  });

  /**
   * A prioridade estreia no PRO. No ENTERPRISE ela já está dentro da herança, e
   * reanunciá-la sugeriria que o PRO não a tem.
   */
  it('mostra o atendimento prioritário no card em que ele estreia', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;
    const priority = 'Atendimento prioritário no WhatsApp';

    expect(c.proItems).toContain(priority);
    expect(c.trialItems).not.toContain(priority);
    expect(c.starterItems).not.toContain(priority);
    expect(c.enterpriseItems).not.toContain(priority);
  });

  // O `SegmentedToggle` só ecoa o acento que recebe — a suíte dele ficaria
  // verde com `var(--typo)`, que não resolve para nada e deixaria o pill ativo
  // branco sobre o trilho neutro (1,09:1). Quem guarda o NOME do token é o
  // consumidor, aqui e em `billing.spec.ts`.
  //
  // O card Pro NÃO entra mais nesta asserção: ele deixou de receber gradiente.
  // `proGradient()` / `proShadow()` / `proAccentText()` alimentavam os inputs
  // `gradientCss` / `shadowCss` / `accentTextClass` de `app-plan-card`, e esse
  // contrato de string aberta foi por onde um gradiente de 3,16:1 entrou no
  // card sem passar por revisão de contraste. Trocar o valor não fechava o
  // buraco; tirar o input do componente fechou. Agora o tratamento vem de
  // `planCardTone()` e o contraste de cada degrau é medido dentro de
  // `plan-card.ts` — ver o teste de tom logo abaixo.
  it('pinta o toggle com os tokens de gradiente medidos', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as {
      cycleOptions(): readonly { value: string; activeBackground?: string }[];
    };

    const options = c.cycleOptions();
    expect(options.map((o) => o.value)).toEqual(['monthly', 'yearly']);
    expect(options[0].activeBackground).toBe('var(--brand-gradient-deep)');
    expect(options[1].activeBackground).toBe('var(--success-gradient-deep)');

    // Nenhum hex solto: o #FF5722/#EB3F00 fora do sistema voltar por aqui é
    // exatamente o que estas asserções impedem.
    for (const option of options) {
      expect(option.activeBackground).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  /**
   * Os quatro cards leem a MESMA tabela de tons que a tela de billing, então o
   * Pro público e o Pro autenticado não podem ser pintados por regras
   * diferentes — era assim que a landing mandava `business` para um card
   * rotulado Enterprise, e que o STARTER caía no tratamento do TRIAL.
   *
   * A escada é de preenchimento (vazio → acento → sólido → carbono), não de
   * matiz: ela sobrevive em escala de cinza e para quem tem deficiência de cor.
   */
  it('tira o tratamento de cada card da tabela de tons por tier e ciclo', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as {
      trialTone(): string;
      starterTone(): string;
      proTone(): string;
      enterpriseTone(): string;
      setCycle(cycle: 'monthly' | 'yearly'): void;
    };

    expect([c.trialTone(), c.starterTone(), c.proTone(), c.enterpriseTone()]).toEqual([
      'plain',
      'accent',
      'filled',
      'carbon',
    ]);

    // No ANUAL os três degraus coloridos trocam a matiz da marca pelo verde. O
    // TRIAL não tem ciclo — é sempre 14 dias grátis — e por isso não muda.
    c.setCycle('yearly');
    expect([c.trialTone(), c.starterTone(), c.proTone(), c.enterpriseTone()]).toEqual([
      'plain',
      'accent-success',
      'filled-success',
      'carbon-success',
    ]);
  });

  /**
   * ═══ A ORDEM, QUE É INFORMAÇÃO E NÃO ENFEITE ═══
   *
   * Cada card acima do TRIAL diz que tem tudo o que outro tem. Isso só significa
   * alguma coisa se a sequência na tela concordar com a frase.
   *
   * A ordem NÃO pode sair de um signal de media query aqui: `/` é
   * prerenderizada, no servidor não há `matchMedia`, e o `index.html` estático
   * saía com o arranjo de telefone para todo visitante — a fileira se
   * reordenava sozinha na hidratação, sem erro nenhum no console, porque a
   * contagem de nós batia e o Angular reivindicava as views por posição.
   *
   * As duas ordens são agora determinísticas e vão as duas no DOM; quem escolhe
   * é o CSS. Estas asserções são o que impede a decisão de voltar para o JS.
   */
  describe('ordem da escada', () => {
    it('publica as duas ordens sem consultar media query nenhuma', () => {
      const c = TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as {
        catalogPlans(): readonly { tier: string }[];
        phonePlans(): readonly { tier: string }[];
      };

      // jsdom não casa com media query alguma. Se a ordem dependesse de signal,
      // a do catálogo viria invertida aqui — que é exatamente como o bug entrou
      // no HTML prerenderizado.
      expect(c.catalogPlans().map((p) => p.tier)).toEqual([
        'TRIAL',
        'STARTER',
        'PRO',
        'ENTERPRISE',
      ]);
      expect(c.phonePlans().map((p) => p.tier)).toEqual(['ENTERPRISE', 'PRO', 'STARTER', 'TRIAL']);
    });

    /**
     * A REDAÇÃO SEGUE O ARRANJO. No telefone o primeiro card é o ENTERPRISE e
     * não existe "plano anterior" nenhum antes dele; a frase aponta para baixo,
     * que é onde os planos menores realmente estão nesse arranjo.
     */
    it('vira a frase de herança junto com a ordem', () => {
      const c = TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as {
        catalogPlans(): readonly { tier: string; features: readonly string[] }[];
        phonePlans(): readonly { tier: string; features: readonly string[] }[];
      };

      const firstLine = (
        plans: readonly { tier: string; features: readonly string[] }[],
        tier: string,
      ) => plans.find((p) => p.tier === tier)?.features[0];

      for (const tier of ['STARTER', 'PRO', 'ENTERPRISE']) {
        expect(firstLine(c.catalogPlans(), tier)).toBe('Tudo o que o plano anterior tem');
        expect(firstLine(c.phonePlans(), tier)).toBe('Tudo o que os planos abaixo têm');
      }
    });

    /**
     * O bloco que não vale é `display: none` — e não `order-*` nem
     * `flex-col-reverse`, que reordenam só o pixel e deixariam o Tab e o leitor
     * de tela na sequência oposta à que se vê (WCAG 1.3.2 / 2.4.3). `hidden` tira
     * da árvore de acessibilidade E da ordem de foco, então o que se navega é
     * sempre o que se enxerga.
     */
    it('esconde o arranjo que não vale, em vez de reordenar o pixel', () => {
      const fixture = TestBed.createComponent(LandingPricingComponent);
      fixture.detectChanges();
      const html = (fixture.nativeElement as HTMLElement).innerHTML;

      expect(html).toContain('md:hidden');
      expect(html).toContain('hidden md:grid');
      expect(html).not.toContain('flex-col-reverse');
      expect(html).not.toMatch(/\border-(first|last|\d)\b/);
    });
  });
});
