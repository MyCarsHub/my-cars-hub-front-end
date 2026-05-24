import { TestBed } from '@angular/core/testing';
import { LandingMultitenantComponent } from './landing-multitenant.component';

describe('LandingMultitenantComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingMultitenantComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LandingMultitenantComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
