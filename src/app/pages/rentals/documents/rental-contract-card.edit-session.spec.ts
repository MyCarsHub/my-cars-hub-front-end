import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RentalContractCard } from './rental-contract-card';
import { RentalService, RentalStateSnapshot } from '../rental.service';
import { DriverService } from '../../../services/driver.service';
import { IMPERSONATION_STATE_KEY } from '../../../services/impersonation.context';
import { ImpersonationService } from '../../../services/impersonation.service';

/**
 * Sessão de EDIÇÃO do admin: os controles de contrato (enviar, remover, pedir assinatura,
 * marcar como assinado) têm de estar na tela e habilitados, como para o dono. O ImpersonationService
 * é o REAL, hidratado do sessionStorage; só o acesso à API é dublê.
 */
describe('RentalContractCard em sessão de edição', () => {
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: 'drv1' } as never)),
  };
  const driverService = { getOne: vi.fn(() => of({ name: 'A', contact: { email: 'a@b.co' } })) };

  function seedSession(mode: 'EDIT' | 'READ'): void {
    sessionStorage.setItem(
      IMPERSONATION_STATE_KEY,
      JSON.stringify({
        sessionId: 's1',
        companyId: 'co-1',
        companyName: 'Locadora Alfa',
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        clockOffsetMs: 0,
        mode,
      }),
    );
  }

  function render(snapshot: RentalStateSnapshot) {
    state.set(snapshot);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
      ],
    });
    const impersonation = TestBed.inject(ImpersonationService);
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', 'rid');
    fixture.componentRef.setInput('contractSource', 'MANUAL');
    fixture.detectChanges();
    return { fixture, impersonation, el: fixture.nativeElement as HTMLElement };
  }

  function buttonByText(el: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('mostra e habilita Remover, Solicitar assinatura e Já Assinado com contrato anexado', () => {
    seedSession('EDIT');
    const { impersonation, el } = render({
      documents: [{ kind: 'CONTRACT', id: 'd1', sizeBytes: 10 } as never],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: 'NOT_REQUIRED' } as never,
    });

    expect(impersonation.editMode()).toBe(true);
    for (const label of ['Remover', 'Solicitar assinatura', 'Já Assinado']) {
      const btn = buttonByText(el, label);
      expect(btn, label).toBeDefined();
      expect(btn?.disabled, label).toBe(false);
    }
  });

  it('mostra o envio do contrato quando ainda não há documento', () => {
    seedSession('EDIT');
    const { el } = render({
      documents: [],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: null,
    });

    const upload = buttonByText(el, 'Enviar contrato (PDF ou DOCX)');
    expect(upload).toBeDefined();
    expect(upload?.disabled).toBe(false);
  });
});
