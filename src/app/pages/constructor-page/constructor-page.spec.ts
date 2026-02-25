import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConstructorPage } from './constructor-page';

describe('ConstructorPage', () => {
  let component: ConstructorPage;
  let fixture: ComponentFixture<ConstructorPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConstructorPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ConstructorPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
