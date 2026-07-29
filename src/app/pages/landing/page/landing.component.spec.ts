import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingComponent } from './landing.component';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

describe('LandingComponent', () => {
  let fixture: ComponentFixture<LandingComponent>;

  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(LandingComponent);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('todo fragmento apontado pelo header existe na página', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const fragments = Array.from(host.querySelectorAll<HTMLAnchorElement>('header nav a'))
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.includes('#'))
      .map((href) => href.slice(href.indexOf('#') + 1));

    expect(fragments.length).toBeGreaterThan(0);
    for (const fragment of fragments) {
      expect(host.querySelector(`#${fragment}`)).toBeTruthy();
    }
  });
});
