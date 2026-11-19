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
  it('chave desligada: o item do ⋮ fica apagado COM a explicação; abrir não faz nada', async () => {
    const { fixture } = await mount({ enabled: false, ttlMinutes: 30 });

    expect(fixture.componentInstance.canOpen()).toBe(false);
    expect(fixture.componentInstance.hint()).toContain('desligado na plataforma');
    fixture.componentInstance.openDialog();
    fixture.detectChanges();
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
  });

  it('sem botão próprio: o gatilho é o item do ⋮ do detalhe', async () => {
    const { fixture } = await mount({ enabled: true, ttlMinutes: 30 });
    expect(el(fixture).querySelector('button')).toBeNull();
  });

  it('chave ligada: abre o dialog com empresa e o aviso de registro, e só então inicia', async () => {
    const { fixture, startEdit, navigate } = await mount({ enabled: true, ttlMinutes: 30 });
    expect(fixture.componentInstance.canOpen()).toBe(true);

    fixture.componentInstance.openDialog();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = el(fixture).querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Locadora Alfa');
    expect(dialog.textContent).toContain('Tudo fica no registro de auditoria, sem e-mail ao cliente');
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
    fixture.componentInstance.openDialog();
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
