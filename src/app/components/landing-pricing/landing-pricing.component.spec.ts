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
});
