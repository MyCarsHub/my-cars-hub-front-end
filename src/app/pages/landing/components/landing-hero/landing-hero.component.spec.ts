import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingHeroComponent } from './landing-hero.component';

describe('LandingHeroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingHeroComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingHeroComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
