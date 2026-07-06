import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingProblemComponent } from './landing-problem.component';

describe('LandingProblemComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingProblemComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingProblemComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
