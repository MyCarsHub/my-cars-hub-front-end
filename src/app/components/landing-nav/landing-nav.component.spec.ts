import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingNavComponent } from './landing-nav.component';

describe('LandingNavComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingNavComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingNavComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
