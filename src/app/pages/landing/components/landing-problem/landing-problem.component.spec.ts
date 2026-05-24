import { TestBed } from '@angular/core/testing';
import { LandingProblemComponent } from './landing-problem.component';

describe('LandingProblemComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingProblemComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingProblemComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
