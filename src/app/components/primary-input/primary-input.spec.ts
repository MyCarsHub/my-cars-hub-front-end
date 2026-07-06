import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PrimaryInput } from './primary-input';

describe('PrimaryInput', () => {
  let component: PrimaryInput;
  let fixture: ComponentFixture<PrimaryInput>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrimaryInput]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PrimaryInput);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
