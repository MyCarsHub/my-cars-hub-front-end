import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { convertToParamMap } from '@angular/router';

import { OauthSuccess } from './oauth-success';

describe('OauthSuccess', () => {
  let component: OauthSuccess;
  let fixture: ComponentFixture<OauthSuccess>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OauthSuccess],
      providers: [
        provideRouter([
          { path: 'login', children: [] },
          { path: 'dashboard', children: [] },
          { path: 'onboarding', children: [] },
        ]),
        provideHttpClient(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OauthSuccess);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
