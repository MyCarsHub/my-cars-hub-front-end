import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DefaultLoginLayout } from './default-login-layout';

describe('DefaultLoginLayout', () => {
  let component: DefaultLoginLayout;
  let fixture: ComponentFixture<DefaultLoginLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DefaultLoginLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DefaultLoginLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
