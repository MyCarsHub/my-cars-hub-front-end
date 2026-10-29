import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PlanIntentService } from '../../../../services/plan-intent.service';
import { LandingPricingComponent } from './landing-pricing.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type Column = {
  tier: string;
  name: string;
  price: string;
  per: string | null;
  sub: string;
  featured?: boolean;
  current: boolean;
  recommended: boolean;
  rows: readonly { label: string; hi: boolean }[];
};
type Probe = { columns(): readonly Column[]; setCycle(c: 'monthly' | 'yearly'): void };

/**
 * Grade da landing (rev. 2026-10-29): a mesma `app-plan-grid` da Assinatura.
 * Estes testes guardam o que a vitrine PROMETE — preço, capacidade, destaque —
 * porque a landing escreve os números à mão (sem sessão, sem `/billing/plans`).
 */
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

  const build = (): Probe =>
    TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as Probe;
  const col = (c: Probe, tier: string): Column => c.columns().find((x) => x.tier === tier)!;

  it('mostra os cinco planos na ordem do catálogo', () => {
    expect(build().columns().map((c) => c.tier)).toEqual(['TRIAL', 'STARTER', 'PRO', 'SCALE', 'ENTERPRISE']);
  });

  it('anuncia os preços da V127 no mensal e no anual', () => {
    const c = build();
    expect(col(c, 'STARTER')).toMatchObject({ price: '79,90', per: '/mês' });
    expect(col(c, 'PRO')).toMatchObject({ price: '159,90', per: '/mês' });
    expect(col(c, 'SCALE')).toMatchObject({ price: '299', per: '/mês' });
    expect(col(c, 'TRIAL')).toMatchObject({ price: 'Grátis', per: null });

    c.setCycle('yearly');
    expect(col(c, 'PRO')).toMatchObject({ price: '1.599', per: '/ano', sub: 'R$ 133,25 por mês' });
    expect(col(c, 'SCALE')).toMatchObject({ price: '2.990', per: '/ano' });
  });

  it('anuncia exatamente os limites de VEÍCULO que o backend entrega', () => {
    const c = build();
    const first = (tier: string) => col(c, tier).rows[0].label;
    expect(first('TRIAL')).toBe('Até 3 veículos');
    expect(first('STARTER')).toBe('Até 15 veículos');
    expect(first('PRO')).toBe('Até 25 veículos');
    expect(first('SCALE')).toBe('Até 75 veículos');
  });

  // O ENTERPRISE tem teto real (guarda-corpo da V127) e é vendido como ilimitado.
  it('apresenta o ENTERPRISE como ilimitado e sob consulta, sem expor o teto', () => {
    const ent = col(build(), 'ENTERPRISE');
    expect(ent.price).toBe('Sob consulta');
    const joined = ent.rows.map((r) => r.label).join(' | ');
    expect(joined).toContain('Veículos ilimitados');
    expect(joined).not.toMatch(/(100|150|300|500)/);
  });

  it('não cita capacidade de motoristas em nenhum plano', () => {
    for (const c of build().columns()) {
      expect(c.rows.map((r) => r.label).join(' | ')).not.toMatch(/motorista/i);
    }
  });

  it('destaca só o Pro — mesma superfície para todos, nenhum "plano atual" na vitrine', () => {
    const cols = build().columns();
    expect(cols.filter((c) => c.featured).map((c) => c.tier)).toEqual(['PRO']);
    expect(cols.some((c) => c.current || c.recommended)).toBe(false);
  });

  it('o atendimento prioritário estreia no Pro', () => {
    const c = build();
    const support = (tier: string) => col(c, tier).rows[5];
    expect(support('STARTER')).toMatchObject({ label: 'Suporte no WhatsApp', hi: false });
    expect(support('PRO')).toMatchObject({ label: 'Suporte prioritário', hi: true });
    expect(support('SCALE')).toMatchObject({ label: 'Suporte prioritário', hi: false });
  });

  it('a linha de confiança só afirma o que é verdade, sem tabela comparativa', () => {
    const fixture = TestBed.createComponent(LandingPricingComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid=pricing-trust]')?.textContent).toContain('14 dias grátis');
    expect(el.textContent).not.toContain('Compare todos os recursos');
  });
});

/**
 * FIX-0291 — os QUATRO botoes chegam no mesmo handler, e era ali que a escolha
 * morria: ele nao recebia o plano. O visitante lia a tabela, decidia pelo Pro,
 * clicava, e a decisao evaporava.
 *
 * O que se guarda e INTENCAO, nao assinatura: o plano de entrada e decidido no
 * servidor, e nada disto vai no corpo de nenhuma requisicao.
 */
describe('LandingPricingComponent — guarda o plano escolhido (FIX-0291)', () => {
  let remember: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  function clickCta(label: string): void {
    TestBed.resetTestingModule();
    remember = vi.fn();
    navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Router, useValue: { navigate } },
        { provide: PlanIntentService, useValue: { remember } },
      ],
    });
    const fixture = TestBed.createComponent(LandingPricingComponent);
    fixture.detectChanges();

    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').trim() === label);
    if (!button) throw new Error(`botao ausente: ${label}`);
    button.click();
    fixture.detectChanges();
  }

  it('guarda o PRO quando o visitante escolhe o Pro', () => {
    clickCta('Assinar Pro');

    expect(remember).toHaveBeenCalledWith('PRO');
  });

  it('guarda o STARTER e o SCALE pelos proprios botoes', () => {
    clickCta('Assinar Starter');
    expect(remember).toHaveBeenCalledWith('STARTER');

    clickCta('Assinar Scale');
    expect(remember).toHaveBeenCalledWith('SCALE');
  });

  it('Enterprise e sob consulta: mostra contato, nunca preco nem intencao de compra', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      clickCta('Falar com a gente');
      expect(remember).not.toHaveBeenCalledWith('ENTERPRISE');

      const c = TestBed.createComponent(LandingPricingComponent).componentInstance as unknown as {
        columns(): readonly { tier: string; price: string; ctaLabel: string; per: string | null }[];
      };
      const ent = c.columns().find((p) => p.tier === 'ENTERPRISE')!;
      expect(ent).toMatchObject({ price: 'Sob consulta', ctaLabel: 'Falar com a gente', per: null });
    } finally {
      open.mockRestore();
    }
  });

  /**
   * O trial tambem passa pelo handler — e o servico e quem decide que ele APAGA
   * em vez de gravar. A tela nao pode ter uma regra propria sobre isso, senao as
   * duas divergem.
   */
  it('o trial tambem avisa o servico, que e quem decide apagar', () => {
    clickCta('Criar conta grátis');

    expect(remember).toHaveBeenCalledWith('TRIAL');
  });

  it('continua navegando para o login depois de guardar', () => {
    clickCta('Assinar Pro');

    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
