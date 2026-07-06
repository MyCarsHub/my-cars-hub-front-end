import { TestBed } from '@angular/core/testing';
import { LandingFeaturesComponent } from './landing-features.component';

describe('LandingFeaturesComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingFeaturesComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingFeaturesComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
