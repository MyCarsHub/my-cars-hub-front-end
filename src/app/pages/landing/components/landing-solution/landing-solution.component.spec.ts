import { TestBed } from '@angular/core/testing';
import { LandingSolutionComponent } from './landing-solution.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('LandingSolutionComponent', () => {
  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingSolutionComponent],
    }).compileComponents();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(LandingSolutionComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingSolutionComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  /**
   * As prévias dos cartões mostram "R$ 84,2k", "92%", "75% concluído" e uma revisão de um
   * Civic — todos inventados para ilustrar a tela. O rótulo cobre os TRÊS cartões de
   * propósito: marcar só o dos KPIs sugeriria que os outros dois são dados reais.
   */
  it('rotula a prévia de todos os cartões como exemplo, não como resultado', () => {
    const cards = render().querySelectorAll('article');
    expect(cards.length).toBe(3);
    for (const card of Array.from(cards)) {
      expect(card.textContent).toMatch(/Exemplo ilustrativo da interface/i);
    }
  });
});
