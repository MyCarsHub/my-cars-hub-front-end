import { TestBed } from '@angular/core/testing';
import { DefaultPageLayout } from './default-page-layout';

describe('DefaultPageLayout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DefaultPageLayout],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(DefaultPageLayout);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
