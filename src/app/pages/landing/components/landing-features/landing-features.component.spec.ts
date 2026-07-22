import { TestBed } from '@angular/core/testing';
import { LandingFeaturesComponent } from './landing-features.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

describe('LandingFeaturesComponent', () => {
  beforeEach(async () => {
    (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }).IntersectionObserver =
      IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingFeaturesComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingFeaturesComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders 4 feature cards including the AI-friendly contract card', () => {
    const fixture = TestBed.createComponent(LandingFeaturesComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.features.length).toBe(4);
    const pills = fixture.componentInstance.features.map((f) => f.pill);
    expect(pills).toContain('Contrato & IA');
    const html: string = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('Contrato & IA');
    expect(html).toContain('contrato.md');
    expect(html).toContain('ChatGPT');
  });
});
