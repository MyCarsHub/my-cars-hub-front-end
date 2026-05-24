import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingCtaComponent } from './landing-cta.component';

describe('LandingCtaComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingCtaComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingCtaComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
