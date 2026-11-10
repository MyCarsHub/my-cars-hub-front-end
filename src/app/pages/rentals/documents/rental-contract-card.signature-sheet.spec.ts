import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOTTOM_SHEET_LEAVE_MS } from '../../../components/core/bottom-sheet/bottom-sheet';
import { DriverService } from '../../../services/driver.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';
import { RentalService, RentalStateSnapshot } from '../rental.service';
import { RentalContractCard } from './rental-contract-card';
import { SIGNATURE_REQUEST_CONSENT_NOTICE, SIGNATURE_REQUEST_EMAIL_NOTICE } from './signature-notice';

/**
 * Pedido de assinatura eletrônica (Autentique): vive numa folha inferior (`app-bottom-sheet`),
 * um cartão por signatário, validação por campo e o aviso de divulgação do Autentique.
 */
describe('RentalContractCard signature sheet', () => {
  const state = signal<RentalStateSnapshot | null>(null);
  const requestContractSignature = vi.fn(() => of({ status: 'PENDING' } as any));
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: 'drv1' } as any)),
    requestContractSignature,
  };
  const driverService = {
    getOne: vi.fn(() => of({ name: 'Alice Driver', contact: { email: 'alice@example.com' } } as any)),
  };
  const session = {
    getItem: vi.fn((k: string) => ({ name: 'Bob Owner', email: 'bob@example.com' } as Record<string, string>)[k] ?? null),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    requestContractSignature.mockClear();
    state.set({
      documents: [{ kind: 'CONTRACT', id: 'd1', mimeType: 'application/pdf', sizeBytes: 10, createdDate: '2026-11-01T10:00:00Z' } as any],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: 'NOT_REQUIRED' } as any,
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: { push: vi.fn() } },
      ],
    });
  });

  // The worker is reused by the next spec file: fake timers left on here freeze its timers.
  afterEach(() => {
    vi.useRealTimers();
  });

  function open() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', 'rid');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const trigger = Array.from(el.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Solicitar assinatura'),
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    return { fixture, el };
  }

  it('abre numa folha inferior com os ids dos campos preservados', async () => {
    const { fixture, el } = open();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('app-bottom-sheet [role="dialog"]')).not.toBeNull();
    for (const id of ['signer-0-name', 'signer-0-email', 'signer-1-name', 'signer-1-email']) {
      expect(el.querySelector('#' + id), id).not.toBeNull();
    }
    expect((el.querySelector('#signer-0-name') as HTMLInputElement).value).toBe('Alice Driver');
  });

  it('um cartão por signatário, com o papel de cada um', () => {
    const { el } = open();
    const cards = el.querySelectorAll('[data-testid="signature-sheet"] section');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Motorista');
    expect(cards[1].textContent).toContain('Locador');
  });

  it('o aviso do Autentique vem num único bloco, com as duas frases', () => {
    const { el } = open();
    const email = el.querySelector('[data-testid="signature-email-notice"]') as HTMLElement;
    const consent = el.querySelector('[data-testid="signature-consent-notice"]') as HTMLElement;
    expect(email.textContent?.trim()).toBe(SIGNATURE_REQUEST_EMAIL_NOTICE);
    expect(consent.textContent?.trim()).toBe(SIGNATURE_REQUEST_CONSENT_NOTICE);
    expect(email.parentElement).toBe(consent.parentElement);
  });

  it('campos com 16px (text-base) para o iOS não dar zoom', () => {
    const { el } = open();
    for (const id of ['signer-0-name', 'signer-0-email']) {
      const cls = (el.querySelector('#' + id) as HTMLElement).className;
      expect(cls).toContain('text-base');
      expect(cls).not.toContain('text-sm');
    }
  });

  it('Adicionar signatário cria um cartão «Signatário N»', () => {
    const { fixture, el } = open();
    const add = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Adicionar signatário')) as HTMLButtonElement;
    add.click();
    fixture.detectChanges();
    const cards = el.querySelectorAll('[data-testid="signature-sheet"] section');
    expect(cards.length).toBe(3);
    expect(cards[2].textContent).toContain('Signatário 3');
  });

  it('enviar com campo vazio não chama o back-end: mostra o erro do campo e não desabilita o botão', () => {
    const { fixture, el } = open();
    const name = el.querySelector('#signer-0-name') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('#signer-0-name-error')).toBeNull(); // ainda sem tocar

    const submit = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Enviar para assinatura')) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();
    fixture.detectChanges();

    expect(requestContractSignature).not.toHaveBeenCalled();
    expect(el.querySelector('#signer-0-name-error')?.textContent).toContain('Informe o nome');
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });

  it('enviar com tudo válido chama o back-end com os signatários', () => {
    const { fixture, el } = open();
    const submit = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Enviar para assinatura')) as HTMLButtonElement;
    submit.click();
    fixture.detectChanges();
    expect(requestContractSignature).toHaveBeenCalledWith('rid', [
      { name: 'Alice Driver', email: 'alice@example.com' },
      { name: 'Bob Owner', email: 'bob@example.com' },
    ]);
  });

  it('Cancelar fecha a folha depois da animação de saída', () => {
    const { fixture, el } = open();
    const cancel = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Cancelar') as HTMLButtonElement;
    cancel.click();
    // o botão chama closeSignatureModal direto: a folha sai do DOM no mesmo tique
    fixture.detectChanges();
    vi.advanceTimersByTime(BOTTOM_SHEET_LEAVE_MS);
    fixture.detectChanges();
    expect(el.querySelector('app-bottom-sheet')).toBeNull();
  });

  it('o botão X do cabeçalho da folha também fecha', () => {
    const { fixture, el } = open();
    (el.querySelector('[data-testid="bottom-sheet-close"]') as HTMLButtonElement).click();
    vi.advanceTimersByTime(BOTTOM_SHEET_LEAVE_MS);
    fixture.detectChanges();
    expect(el.querySelector('app-bottom-sheet')).toBeNull();
  });
});
