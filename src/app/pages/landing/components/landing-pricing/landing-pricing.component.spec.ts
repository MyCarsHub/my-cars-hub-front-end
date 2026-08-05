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

    expect(c.trialItems).toContain('Até 3 veículos');
    expect(c.trialItems).toContain('Até 4 motoristas');

    expect(c.proItems).toContain('Até 20 veículos');
    expect(c.proItems).toContain('Até 40 motoristas');
  });

  // O ENTERPRISE tem teto real (500/1000) desde a V44 e mesmo assim é vendido
  // como ilimitado — maquiagem deliberada de produto. O que não pode acontecer
  // é o número vazar para a landing.
  it('apresenta o ENTERPRISE como ilimitado, sem expor 500/1000', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;

    expect(c.enterpriseItems).toContain('Veículos ilimitados');
    expect(c.enterpriseItems).toContain('Motoristas ilimitados');

    const joined = c.enterpriseItems.join(' | ');
    expect(joined).not.toContain('500');
    expect(joined).not.toContain('1000');
  });

  // Guarda-corpo contra a landing voltar a prometer o que a V43 prometia.
  it('não promete mais motoristas ilimitados no PRO', () => {
    const c = TestBed.createComponent(LandingPricingComponent).componentInstance;

    expect(c.proItems).not.toContain('Motoristas ilimitados');
    expect(c.proItems).not.toContain('Até 15 veículos');
  });
});
