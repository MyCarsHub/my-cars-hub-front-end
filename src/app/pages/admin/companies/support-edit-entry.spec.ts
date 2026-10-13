import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { ApiErrorService } from '../../../services/api-error.service';
import { ImpersonationService } from '../../../services/impersonation.service';
import { NotificationService } from '../../../services/notification.service';
import { SupportEditEntry } from './support-edit-entry';

const STATUS_URL = `${environment.apiUrl}/admin/impersonation/edit/status`;

async function mount(statusBody: object, startEdit = vi.fn(() => of({ companyName: 'Alfa' }))) {
  TestBed.resetTestingModule();
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [SupportEditEntry],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
      { provide: ImpersonationService, useValue: { active: () => false, startEdit } },
      { provide: NotificationService, useValue: { info: vi.fn() } },
      {
        provide: ApiErrorService,
        useValue: { messageFor: (_e: unknown, fallback: string) => fallback },
      },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture: ComponentFixture<SupportEditEntry> = TestBed.createComponent(SupportEditEntry);
  fixture.componentRef.setInput('companyId', 'co-1');
  fixture.componentRef.setInput('companyName', 'Locadora Alfa');
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(STATUS_URL).flush(statusBody);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, startEdit, navigate };
}

function el(f: ComponentFixture<SupportEditEntry>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

describe('SupportEditEntry', () => {
  it('chave desligada: botão desabilitado COM a explicação visível', async () => {
    const { fixture } = await mount({ enabled: false, ttlMinutes: 30 });

    const button = el(fixture).querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(el(fixture).textContent).toContain('desligado na plataforma');
  });

  it('chave ligada: abre o dialog com empresa e o aviso de registro, e só então inicia', async () => {
    const { fixture, startEdit, navigate } = await mount({ enabled: true, ttlMinutes: 30 });
    const button = el(fixture).querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.className).toContain('min-h-11');

    button.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = el(fixture).querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Locadora Alfa');
    expect(dialog.textContent).toContain('Tudo é registrado e visível para a empresa');
    expect(startEdit).not.toHaveBeenCalled();

    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Abrir sessão de edição'),
    ) as HTMLButtonElement;
    confirm.click();

    expect(startEdit).toHaveBeenCalledWith('co-1');
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it.each([
    ['SUPPORT_EDIT_DISABLED', 'desligado'],
    ['SUPPORT_EDIT_ALREADY_ACTIVE', 'Já existe uma sessão de edição ativa'],
  ])('erro %s vira mensagem em pt-BR', async (code, fragment) => {
    const startEdit = vi.fn(() =>
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { code, message: 'x' } }),
      ),
    );
    const { fixture } = await mount({ enabled: true, ttlMinutes: 30 }, startEdit as never);
    (el(fixture).querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const confirm = Array.from(el(fixture).querySelectorAll('[role="dialog"] button')).find((b) =>
      (b.textContent ?? '').includes('Abrir sessão de edição'),
    ) as HTMLButtonElement;

    confirm.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture).textContent).toContain(fragment);
  });
});
