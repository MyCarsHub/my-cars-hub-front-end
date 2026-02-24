import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountSteps } from './account-steps';

describe('AccountSteps', () => {
  let component: AccountSteps;
  let fixture: ComponentFixture<AccountSteps>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountSteps]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountSteps);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
