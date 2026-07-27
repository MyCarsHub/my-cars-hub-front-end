import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingNavComponent } from './landing-nav.component';

describe('LandingNavComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingNavComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingNavComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('aponta cada link de seção para uma âncora root-absoluta (funciona também em /blog)', () => {
    const fixture = TestBed.createComponent(LandingNavComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const anchors = Array.from(host.querySelectorAll<HTMLAnchorElement>('nav a'));
    const targets = anchors.map((a) => a.getAttribute('href'));
    expect(targets).toEqual([
      '/#problema',
      '/#solucao',
      '/#funcionalidades',
      '/#integracoes',
      '/#planos',
    ]);
  });

  it('o link de Integrações leva para a seção de integrações', () => {
    const fixture = TestBed.createComponent(LandingNavComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const anchors = Array.from(host.querySelectorAll<HTMLAnchorElement>('nav a'));
    const integracoes = anchors.find((a) => a.textContent?.trim() === 'Integrações');
    expect(integracoes).toBeTruthy();
    expect(integracoes?.getAttribute('href')).toBe('/#integracoes');
  });

  it('nenhum link do header é morto (# ou vazio)', () => {
    const fixture = TestBed.createComponent(LandingNavComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const anchors = Array.from(host.querySelectorAll<HTMLAnchorElement>('a'));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const href = a.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).not.toBe('#');
    }
  });
});
