import { TestBed } from '@angular/core/testing';
import { LandingStatsComponent } from './landing-stats.component';

describe('LandingStatsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingStatsComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingStatsComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
