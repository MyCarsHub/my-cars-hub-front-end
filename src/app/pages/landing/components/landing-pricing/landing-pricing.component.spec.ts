import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingPricingComponent } from './landing-pricing.component';

describe('LandingPricingComponent', () => {
  beforeEach(async () => {
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
   * A prioridade de atendimento é a única diferença de bullet entre os tiers, e
   * ela é resolvida em `planFeaturesFor()`. Este teste confere o que os cards
   * REALMENTE recebem: se alguém espalhar `...PLAN_FEATURES` de volta nas quatro
   * listas, o PRO e o ENTERPRISE perdem a linha em silêncio.
   */
  it('mostra o atendimento prioritário só nos cards Pro e Enterprise', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;
    const priority = 'Atendimento prioritário no WhatsApp';

    expect(c.proItems).toContain(priority);
    expect(c.enterpriseItems).toContain(priority);
    expect(c.trialItems).not.toContain(priority);
    expect(c.starterItems).not.toContain(priority);

    // O canal, esse, vale para os quatro.
    for (const items of [c.trialItems, c.starterItems, c.proItems, c.enterpriseItems]) {
      expect(items).toContain('Suporte por WhatsApp');
    }
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
  it('tira o tratamento de cada card da tabela de tons por tier', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as {
      trialTone: string;
      starterTone: string;
      proTone: string;
      enterpriseTone: string;
    };

    expect([c.trialTone, c.starterTone, c.proTone, c.enterpriseTone]).toEqual([
      'plain',
      'accent',
      'filled',
      'carbon',
    ]);
  });
});
