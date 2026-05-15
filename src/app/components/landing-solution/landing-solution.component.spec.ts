import { TestBed } from '@angular/core/testing';
import { LandingSolutionComponent } from './landing-solution.component';

describe('LandingSolutionComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingSolutionComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingSolutionComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
