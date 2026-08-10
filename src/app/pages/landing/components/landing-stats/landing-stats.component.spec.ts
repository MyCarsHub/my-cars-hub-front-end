import { TestBed } from '@angular/core/testing';
import { PLAN_PRICES } from '../../landing-plans';
import { LandingStatsComponent } from './landing-stats.component';

/**
 * Esta faixa publicou em produção três alegações falsas — "180+ frotas ativas",
 * "R$ 12M em contratos ativos/mês" e "99,9% de uptime nos últimos 12 meses" — enquanto o
 * banco tinha 18 empresas e R$ 112.950 em todo o histórico.
 *
 * O que estes testes travam não é a redação: é a REGRA de que todo número desta seção
 * descreve o produto e tem fonte no código, e que nenhum descreve adoção.
 */
describe('LandingStatsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingStatsComponent],
    }).compileComponents();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(LandingStatsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Texto da seção com espaços em branco normalizados, para casar frases quebradas em várias linhas. */
  function text(): string {
    return (render().textContent ?? '').replace(/\s+/g, ' ');
  }

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingStatsComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('as três alegações falsas não voltam', () => {
    it.each([
      ['tração em frotas', /frotas?\s+ativas/i],
      ['volume financeiro', /R\$\s*\d+\s*M/i],
      ['contratos ativos/mês', /contratos\s+ativos/i],
      ['uptime sem monitoramento', /uptime/i],
      ['a contagem inflada de frotas', /\b180\b/],
    ])('não afirma %s', (_label, forbidden) => {
      expect(text()).not.toMatch(forbidden);
    });

    /**
     * Guarda mais larga que as anteriores: qualquer número de três dígitos ou mais nesta
     * seção quase certamente é alegação de adoção (empresas, contratos, reais). Os números
     * legítimos do produto são pequenos e enumeráveis.
     */
    it('não exibe nenhum número grande, que só poderia significar adoção', () => {
      const numbers = text().match(/\d[\d.]*/g) ?? [];
      const big = numbers.filter((n) => Number(n.replace(/\./g, '')) >= 100);
      expect(big).toEqual([]);
    });
  });

  describe('cada número exibido tem fonte no código', () => {
    /**
     * Acoplamento real, não cópia: se `PLAN_PRICES.trialDays` mudar, este teste quebra e
     * obriga a faixa a acompanhar o hero, o CTA, a tabela de planos e o FAQ.
     */
    it('anuncia os dias de teste que `landing-plans.ts` define', () => {
      const counters = render().querySelectorAll<HTMLElement>('[data-count]');
      const values = Array.from(counters, (n) => n.dataset['count']);
      expect(values).toContain(String(PLAN_PRICES.trialDays));
    });

    it('conta 9 áreas da operação e nomeia todas as nove (sidebar.ts)', () => {
      const body = text();
      const areas = [
        'aluguéis',
        'veículos',
        'motoristas',
        'manutenções',
        'multas',
        'sinistros',
        'financiamentos',
        'seguros',
        'relatórios',
      ];
      expect(areas).toHaveLength(9);
      for (const area of areas) {
        expect(body.toLowerCase()).toContain(area);
      }
    });

    it('conta 5 tipos de alerta e nomeia todos os cinco (NotificationType)', () => {
      const body = text().toLowerCase();
      // Espelha `types/notification-feed.types.ts`: CNH_DUE_SOON, LICENSING_DUE_SOON,
      // IPVA_DUE_SOON, INSURANCE_DUE_SOON, FINANCING_INSTALLMENT_DUE.
      const alerts = ['cnh', 'licenciamento', 'ipva', 'seguro', 'parcela de financiamento'];
      expect(alerts).toHaveLength(5);
      for (const alert of alerts) {
        expect(body).toContain(alert);
      }
    });

    it('exibe exatamente três números, e são 14, 9 e 5', () => {
      const counters = render().querySelectorAll<HTMLElement>('[data-count]');
      const values = Array.from(counters, (n) => n.dataset['count']);
      expect(values).toEqual(['14', '9', '5']);
    });

    /**
     * Sem JS (prerender, crawler, no-script) o contador nunca roda. Antes, o HTML servido
     * dizia "0 frotas ativas"; agora o valor honesto já vem no markup e a animação só o
     * reescreve por cima.
     */
    it('serve o número real no HTML, não um zero à espera da animação', () => {
      const counters = render().querySelectorAll<HTMLElement>('[data-count]');
      for (const node of Array.from(counters)) {
        expect(node.textContent?.trim()).toBe(node.dataset['count']);
      }
    });
  });

  /**
   * O cabeçalho não se desculpa mais pelo tamanho da base — decisão do dono do produto: a
   * página não confessa nada ao visitante. A regra que sobrou é mais forte que a confissão
   * era: o cabeçalho promete que os números descrevem a SUPERFÍCIE do produto, e o
   * vocabulário de adoção fica proibido em qualquer redação futura.
   */
  describe('o cabeçalho apresenta produto, não tração', () => {
    it('promete que os números descrevem o que o sistema faz', () => {
      expect(text()).toMatch(/números abaixo descrevem o que o sistema faz/i);
    });

    it.each([
      ['clientes', /\bclientes?\b/i],
      ['empresas', /\bempresas?\b/i],
      ['usuários', /\busuári/i],
      ['contas cadastradas', /cadastrad/i],
      ['assinantes', /assinante/i],
    ])('não usa vocabulário de adoção (%s)', (_label, forbidden) => {
      expect(text()).not.toMatch(forbidden);
    });
  });
});
