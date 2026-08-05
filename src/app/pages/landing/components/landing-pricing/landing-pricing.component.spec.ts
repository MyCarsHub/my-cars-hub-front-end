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

    expect(c.proItems).toContain('Até 15 veículos');
    expect(c.proItems).toContain('Motoristas ilimitados');

    expect(c.enterpriseItems).toContain('Veículos ilimitados');
  });
});
