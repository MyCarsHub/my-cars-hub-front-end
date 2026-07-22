import { TestBed } from '@angular/core/testing';
import { LandingIntegrationsComponent } from './landing-integrations.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

describe('LandingIntegrationsComponent', () => {
  beforeEach(async () => {
    (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }).IntersectionObserver =
      IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingIntegrationsComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingIntegrationsComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the Pagamentos group with the Asaas brand logo', () => {
    const fixture = TestBed.createComponent(LandingIntegrationsComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Pagamentos');
    expect(text).not.toContain('Contrato & IA');
    const imgs = fixture.nativeElement.querySelectorAll('img.brand-logo');
    expect(imgs.length).toBe(1);
    const alts = Array.from(imgs).map((img) => (img as HTMLImageElement).alt);
    expect(alts).toEqual(['Logo Asaas']);
  });
});
