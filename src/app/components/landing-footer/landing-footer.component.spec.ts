import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingFooterComponent } from './landing-footer.component';

describe('LandingFooterComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingFooterComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingFooterComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
