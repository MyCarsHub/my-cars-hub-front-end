import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RentalContractCard } from './rental-contract-card';
import { RentalService, RentalStateSnapshot } from '../rental.service';
import { DriverService } from '../../../services/driver.service';
import { NotificationService } from '../../../services/notification.service';
import { SessionService } from '../../../services/session.service';

/**
 * Regression: toast on Autentique signature polling. Ensures the transition
 * SIGNED/REFUSED/EXPIRED fires the correct toast when the shared signal
 * flips (decoupled from the poll tick — see effect() in the component).
 */
describe('RentalContractCard signature transition toasts', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: 'drv1' } as any)),
    documentSignedUrl: vi.fn(() => of({ url: 'https://signed.example/x' } as any)),
  };
  const driverService = {
    getOne: vi.fn(() =>
      of({ name: 'Alice Driver', contact: { email: 'alice@example.com' } } as any),
    ),
  };
  const sessionValues = new Map<string, string>();
  const session = {
    getItem: vi.fn((k: string) => sessionValues.get(k) ?? null),
  };
  const notifications = { push: vi.fn() };

  function makeSnapshot(
    signatureStatus: 'PENDING' | 'SIGNED' | 'REFUSED' | 'EXPIRED' | 'NOT_REQUIRED',
  ): RentalStateSnapshot {
    return {
      documents: [{ kind: 'CONTRACT', id: 'd1' } as any],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: signatureStatus } as any,
    };
  }

  beforeEach(() => {
    notifications.push.mockClear();
    rentalService.loadRentalState.mockClear();
    rentalService.refreshContractSignature.mockClear();
    state.set(makeSnapshot('PENDING'));
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
      ],
    });
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.detectChanges();
    return fixture;
  }

  it('fires success toast when signature transitions PENDING → SIGNED via signal update', () => {
    const fixture = makeFixture();
    // Initial run must NOT fire a toast (skip first emission).
    expect(notifications.push).not.toHaveBeenCalled();

    state.set(makeSnapshot('SIGNED'));
    fixture.detectChanges();

    expect(notifications.push).toHaveBeenCalledWith('success', 'Contrato assinado por todos.');
  });

  it('fires warning toast when signature transitions to REFUSED', () => {
    const fixture = makeFixture();
    state.set(makeSnapshot('REFUSED'));
    fixture.detectChanges();
    expect(notifications.push).toHaveBeenCalledWith(
      'warning',
      'Assinatura recusada por um signatário.',
    );
  });

  it('fires warning toast when signature transitions to EXPIRED', () => {
    const fixture = makeFixture();
    state.set(makeSnapshot('EXPIRED'));
    fixture.detectChanges();
    expect(notifications.push).toHaveBeenCalledWith('warning', 'Link de assinatura expirou.');
  });

  it('does NOT fire toast on transitions into PENDING or NOT_REQUIRED', () => {
    state.set(makeSnapshot('SIGNED'));
    const fixture = makeFixture();
    notifications.push.mockClear();

    state.set(makeSnapshot('PENDING'));
    fixture.detectChanges();
    state.set(makeSnapshot('NOT_REQUIRED'));
    fixture.detectChanges();

    expect(notifications.push).not.toHaveBeenCalled();
  });

  describe('signature modal prefill', () => {
    beforeEach(() => {
      sessionValues.clear();
      rentalService.getById.mockReset();
      driverService.getOne.mockReset();
      rentalService.getById.mockReturnValue(of({ driverId: 'drv1' } as any));
      driverService.getOne.mockReturnValue(
        of({ name: 'Alice Driver', contact: { email: 'alice@example.com' } } as any),
      );
    });

    it('prefills driver + owner signers when modal opens', () => {
      sessionValues.set('name', 'Bob Owner');
      sessionValues.set('email', 'bob@example.com');
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
      };

      cmp.openSignatureModal();
      const signers = cmp.signers();
      expect(signers).toHaveLength(2);
      expect(signers[0]).toEqual({ name: 'Alice Driver', email: 'alice@example.com' });
      expect(signers[1]).toEqual({ name: 'Bob Owner', email: 'bob@example.com' });
    });

    it('leaves signer 1 empty and marks it invalid when driver has no email', () => {
      sessionValues.set('name', 'Bob Owner');
      sessionValues.set('email', 'bob@example.com');
      driverService.getOne.mockReturnValue(
        of({ name: 'No Email Driver', contact: { email: null } } as any),
      );
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
        isEmailInvalid: (e: string) => boolean;
      };

      cmp.openSignatureModal();
      const signers = cmp.signers();
      expect(signers[0].email).toBe('');
      expect(cmp.isEmailInvalid(signers[0].email)).toBe(true);
    });

    it('omits owner signer when session has no email', () => {
      // no session values set
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
      };

      cmp.openSignatureModal();
      expect(cmp.signers()).toHaveLength(1);
      expect(cmp.signers()[0].email).toBe('alice@example.com');
    });

    it('keeps owner-only seed when rental fetch fails', () => {
      sessionValues.set('name', 'Bob Owner');
      sessionValues.set('email', 'bob@example.com');
      rentalService.getById.mockReturnValue(throwError(() => new Error('boom')));
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as unknown as {
        openSignatureModal: () => void;
        signers: () => Array<{ name: string; email: string }>;
      };

      cmp.openSignatureModal();
      const signers = cmp.signers();
      expect(signers).toHaveLength(2);
      expect(signers[0]).toEqual({ name: '', email: '' });
      expect(signers[1].email).toBe('bob@example.com');
      expect(driverService.getOne).not.toHaveBeenCalled();
    });
  });
});

/**
 * Cobre os fluxos de download PDF (fetch → blob → anchor) e abertura
 * do PDF em nova aba (window.open + navigation pra signed URL).
 * Backend armazena PDF real; docx-preview foi removido deste caminho.
 * Stub no HTTP boundary (RentalService.documentSignedUrl) + no DOM.
 */
describe('RentalContractCard — download & open PDF', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: null } as any)),
    documentSignedUrl: vi.fn(),
  };
  const driverService = { getOne: vi.fn() };
  const session = { getItem: vi.fn(() => null) };
  const notifications = { push: vi.fn() };

  function snapshot(): RentalStateSnapshot {
    return {
      documents: [{ kind: 'CONTRACT', id: 'd1' } as any],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: 'NOT_REQUIRED' } as any,
    };
  }

  beforeEach(() => {
    notifications.push.mockClear();
    rentalService.documentSignedUrl.mockReset();
    state.set(snapshot());
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
      ],
    });
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.detectChanges();
    return fixture;
  }

  it('downloadContract: fetch signed URL → anchor click → revoga blob URL', async () => {
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/x' } as any));
    const blob = new Blob(['docx'], { type: 'application/vnd.openxmlformats' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue({ ok: true, blob: async () => blob } as any);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = clickSpy;
      return el;
    });
    vi.useFakeTimers();

    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadContract();
    // Aguarda microtasks do fetch/.blob()/finally.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(fetchSpy).toHaveBeenCalledWith('https://signed/x');
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    expect(revokeUrl).toHaveBeenCalledWith('blob:mock');

    vi.useRealTimers();
    fetchSpy.mockRestore();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    createEl.mockRestore();
  });

  it('downloadContract: erro do backend vira banner inline (sem toast) e reseta loading', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'boom' } })),
    );
    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadContract();
    fixture.detectChanges();

    // A mensagem do backend continua chegando ao usuário — agora inline.
    expect((fixture.componentInstance as any).error()).toBe('boom');
    expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain('boom');
    // E NÃO duplica com o toast do interceptor.
    expect(notifications.push).not.toHaveBeenCalledWith('error', 'boom');
    expect((fixture.componentInstance as any).downloading()).toBe(false);
  });

  it('openContractAsPdf: sucesso → navega a aba pra signed URL do PDF', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      of({ url: 'https://signed/contract.pdf' } as any),
    );
    const location = { href: '' } as { href: string };
    const fakeWin = { location, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContractAsPdf();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(location.href).toBe('https://signed/contract.pdf');
    expect((fixture.componentInstance as any).openingPdf()).toBe(false);

    openSpy.mockRestore();
  });

  it('openContractAsPdf: erro do signed URL fecha aba e mostra banner inline', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'fetch failed' } })),
    );
    const fakeWin = { location: { href: '' }, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContractAsPdf();

    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(fakeWin.close).toHaveBeenCalled();
    expect((fixture.componentInstance as any).error()).toBe('fetch failed');
    expect(notifications.push).not.toHaveBeenCalledWith('error', 'fetch failed');
    expect((fixture.componentInstance as any).openingPdf()).toBe(false);

    openSpy.mockRestore();
  });

  it('openContractAsPdf: pop-up bloqueado → banner inline e sem chamar service', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContractAsPdf();

    expect(rentalService.documentSignedUrl).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).error()).toBe(
      'Permita pop-ups pra abrir o contrato.',
    );
    expect(notifications.push).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).openingPdf()).toBe(false);

    openSpy.mockRestore();
  });
});

/**
 * Upload manual do contrato: guardas client-side (tipo + tamanho), mapeamento
 * de erro amigável e barra de progresso INDETERMINADA.
 *
 * O app roda com `withFetch()`; o FetchBackend do Angular só emite `Sent` e
 * `DownloadProgress` — nunca `UploadProgress`. Uma barra determinada ficaria
 * congelada em 0% e mentiria pro usuário, então a UI é indeterminada e o
 * template não pode conter `%` nem `aria-valuenow`.
 */
describe('RentalContractCard — upload UX', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: null } as any)),
    documentSignedUrl: vi.fn(),
    uploadContractWithProgress: vi.fn(),
  };
  const driverService = { getOne: vi.fn() };
  const session = { getItem: vi.fn(() => null) };
  const notifications = { push: vi.fn() };

  function snapshot(withContract: boolean): RentalStateSnapshot {
    return {
      documents: withContract ? [{ kind: 'CONTRACT', id: 'd1' } as any] : [],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: 'NOT_REQUIRED' } as any,
    };
  }

  /** File com `size` forjado — evita alocar 11MB de verdade no test runner. */
  function makeFile(name: string, type: string, size: number): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  function fileEvent(file: File): Event {
    return { target: { files: [file], value: 'c:\\fakepath\\' + file.name } } as unknown as Event;
  }

  beforeEach(() => {
    notifications.push.mockClear();
    rentalService.uploadContractWithProgress.mockReset();
    state.set(snapshot(true));
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
      ],
    });
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.detectChanges();
    return fixture;
  }

  it('rejeita PDF acima de 10MB inline e NÃO dispara nenhuma chamada HTTP', () => {
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 11 * 1024 * 1024)));
    fixture.detectChanges();

    expect(rentalService.uploadContractWithProgress).not.toHaveBeenCalled();
    expect(cmp.uploading()).toBe(false);
    expect(cmp.error()).toContain('10MB');
    expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain('10MB');
  });

  it('rejeita arquivo não-PDF inline e NÃO dispara nenhuma chamada HTTP', () => {
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('foto.png', 'image/png', 1024)));
    fixture.detectChanges();

    expect(rentalService.uploadContractWithProgress).not.toHaveBeenCalled();
    expect(cmp.error()).toContain('PDF');
    expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain('PDF');
  });

  it('upload que falha com 413 mostra a mensagem de tamanho inline', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413 })),
    );
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 1024)));
    fixture.detectChanges();

    expect(cmp.error()).toContain('10MB');
    expect(cmp.uploading()).toBe(false);
    expect(notifications.push).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('upload que falha com status 0 NÃO duplica mensagem — quem toasta é o interceptor', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 1024)));
    fixture.detectChanges();

    // Rede fora é a única classe de erro que o errorInterceptor toasta ("Sem
    // conexão com o servidor."); um banner inline aqui seria a segunda mensagem.
    expect(cmp.error()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();
    expect(cmp.uploading()).toBe(false);
  });

  it('demais erros caem no contrato de messageFor (mensagem do backend)', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 400, error: { message: 'PDF corrompido.' } }),
      ),
    );
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 1024)));

    expect(cmp.error()).toBe('PDF corrompido.');
  });

  it('barra indeterminada (com contrato): progressbar sem aria-valuenow e sem "%"', () => {
    state.set(snapshot(true));
    const fixture = makeFixture();
    (fixture.componentInstance as any).uploading.set(true);
    fixture.detectChanges();

    const bar = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar!.getAttribute('aria-label')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('%');
  });

  it('barra indeterminada (sem contrato): progressbar sem aria-valuenow e sem "%"', () => {
    state.set(snapshot(false));
    const fixture = makeFixture();
    (fixture.componentInstance as any).uploading.set(true);
    fixture.detectChanges();

    const bar = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar!.getAttribute('aria-label')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('%');
  });
});

/**
 * V40 — botão "Já Assinado" (marcar contrato MANUAL como assinado sem assinatura
 * eletrônica). Regras de visibilidade e wiring do diálogo de confirmação.
 *
 * Ponto de design travado por teste: a visibilidade do botão de assinatura
 * eletrônica é derivada do MESMO status compartilhado, então ao virar SIGNED os
 * DOIS botões somem sozinhos — não existe (nem deve existir) lógica extra de
 * esconder/desabilitar.
 */
describe('RentalContractCard — botão "Já Assinado" (contrato manual)', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);
  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    refreshContractSignature: vi.fn(),
    getById: vi.fn(() => of({ driverId: null } as any)),
    documentSignedUrl: vi.fn(),
    markContractSigned: vi.fn(),
    // Espelha a implementação real (rental.service.ts:applyContractSignature):
    // grava o DTO no snapshot compartilhado sem nenhum round-trip extra.
    applyContractSignature: vi.fn((_rentalId: string, signature: any) => {
      const current = state();
      if (!current) return false;
      state.set({ ...current, contractSignature: signature });
      return true;
    }),
  };
  const driverService = { getOne: vi.fn() };
  const session = { getItem: vi.fn(() => null) };
  const notifications = { push: vi.fn() };

  type Status = 'PENDING' | 'SIGNED' | 'REFUSED' | 'EXPIRED' | 'NOT_REQUIRED';

  function snapshot(status: Status, withContract = true): RentalStateSnapshot {
    return {
      documents: withContract ? [{ kind: 'CONTRACT', id: 'd1' } as any] : [],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: withContract ? ({ status } as any) : null,
    };
  }

  /** Corpo que o backend devolve no POST mark-signed — já é o estado final. */
  const SIGNED_DTO = {
    documentId: 'd1',
    status: 'SIGNED',
    provider: 'MANUAL',
    externalDocumentId: null,
    signedAt: '2026-07-31T12:00:00Z',
  };

  beforeEach(() => {
    notifications.push.mockClear();
    rentalService.markContractSigned.mockReset();
    rentalService.refreshContractSignature.mockClear();
    rentalService.applyContractSignature.mockClear();
    rentalService.markContractSigned.mockReturnValue(of(SIGNED_DTO as any));
    state.set(snapshot('NOT_REQUIRED'));
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
        // O ConfirmDialog usa animações (@backdrop); sem isto o render do
        // diálogo aberto quebra com NG05105.
        provideNoopAnimations(),
      ],
    });
  });

  function makeFixture(contractSource: 'MANUAL' | 'AUTO' | null) {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.componentRef.setInput('contractSource', contractSource);
    fixture.detectChanges();
    return fixture;
  }

  function buttonWithText(fixture: { nativeElement: HTMLElement }, text: string) {
    return (
      (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
        (b) => (b.textContent ?? '').includes(text),
      ) ?? null
    );
  }

  function markSignedButton(fixture: { nativeElement: HTMLElement }) {
    return buttonWithText(fixture, 'Já Assinado');
  }

  /** "Solicitar assinatura" ou "Reenviar para assinatura", conforme o status. */
  function signatureRequestButton(fixture: { nativeElement: HTMLElement }) {
    return (
      (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
        (b) => /assinatura$/.test((b.textContent ?? '').trim()),
      ) ?? null
    );
  }

  it('fica oculto quando o contrato é AUTO', () => {
    expect(markSignedButton(makeFixture('AUTO'))).toBeNull();
  });

  it('fica oculto quando contractSource é null (rental antigo / ainda não carregado)', () => {
    expect(markSignedButton(makeFixture(null))).toBeNull();
  });

  it('fica oculto quando há assinatura eletrônica em andamento (PENDING)', () => {
    state.set(snapshot('PENDING'));
    expect(markSignedButton(makeFixture('MANUAL'))).toBeNull();
  });

  it('fica oculto quando o contrato já está assinado (SIGNED)', () => {
    state.set(snapshot('SIGNED'));
    expect(markSignedButton(makeFixture('MANUAL'))).toBeNull();
  });

  it('fica oculto quando é MANUAL mas ainda não há PDF anexado', () => {
    state.set(snapshot('NOT_REQUIRED', false));
    expect(markSignedButton(makeFixture('MANUAL'))).toBeNull();
  });

  for (const status of ['NOT_REQUIRED', 'REFUSED', 'EXPIRED'] as const) {
    it(`aparece para MANUAL + contrato anexado + status ${status}`, () => {
      state.set(snapshot(status));
      const btn = markSignedButton(makeFixture('MANUAL'));
      expect(btn).toBeTruthy();
      // Alvo de toque mobile-first (>= 44px).
      expect(btn!.className).toContain('min-h-[44px]');
    });
  }

  it('clique abre o diálogo de confirmação em vez de chamar o backend direto', () => {
    const fixture = makeFixture('MANUAL');
    markSignedButton(fixture)!.click();
    fixture.detectChanges();

    expect((fixture.componentInstance as any).markSignedOpen()).toBe(true);
    expect(rentalService.markContractSigned).not.toHaveBeenCalled();
  });

  it('confirmar chama o service UMA vez e grava a resposta no snapshot compartilhado', () => {
    const fixture = makeFixture('MANUAL');
    const cmp = fixture.componentInstance as any;

    markSignedButton(fixture)!.click();
    fixture.detectChanges();
    cmp.confirmMarkSigned();
    fixture.detectChanges();

    expect(rentalService.markContractSigned).toHaveBeenCalledTimes(1);
    expect(rentalService.markContractSigned).toHaveBeenCalledWith(RID);
    expect(rentalService.applyContractSignature).toHaveBeenCalledWith(RID, SIGNED_DTO);
    expect(cmp.markSignedOpen()).toBe(false);
    expect(cmp.markingSigned()).toBe(false);
  });

  /**
   * Regressão do buraco de rede móvel: o POST commita, a UI PRECISA refletir
   * SIGNED sem depender de um segundo round-trip. Antes, o card ignorava o corpo
   * do POST e disparava um GET de confirmação cujo erro era engolido
   * (rental.service.ts:refreshContractSignature) — a tela ficava em NOT_REQUIRED
   * com os dois botões visíveis e o toque seguinte levava 409.
   */
  it('UI vira SIGNED só com a resposta do POST — nenhum GET de confirmação é disparado', () => {
    const fixture = makeFixture('MANUAL');
    const cmp = fixture.componentInstance as any;

    cmp.confirmMarkSigned();
    fixture.detectChanges();

    // Nenhum segundo round-trip: o GET nem chega a ser emitido.
    expect(rentalService.refreshContractSignature).not.toHaveBeenCalled();
    // E a UI já reflete o estado final vindo do POST.
    expect(cmp.signatureStatus()).toBe('SIGNED');
    expect(markSignedButton(fixture)).toBeNull();
    expect(signatureRequestButton(fixture)).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Assinado');
    expect(notifications.push).toHaveBeenCalledWith('success', 'Contrato assinado por todos.');
  });

  it('cai no GET de fallback apenas quando o snapshot ainda não hidratou', () => {
    const fixture = makeFixture('MANUAL');
    const cmp = fixture.componentInstance as any;
    // Snapshot ainda null (primeiro load não voltou) → applyContractSignature
    // não tem onde gravar e devolve false.
    state.set(null);
    fixture.detectChanges();

    cmp.confirmMarkSigned();

    expect(rentalService.applyContractSignature).toHaveBeenCalledWith(RID, SIGNED_DTO);
    expect(rentalService.refreshContractSignature).toHaveBeenCalledWith(RID);
  });

  it('409 do backend vira banner inline (sem toast de erro)', () => {
    rentalService.markContractSigned.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Há uma assinatura eletrônica em andamento.' },
          }),
      ),
    );
    const fixture = makeFixture('MANUAL');
    const cmp = fixture.componentInstance as any;

    cmp.confirmMarkSigned();
    fixture.detectChanges();

    expect(cmp.error()).toBe('Há uma assinatura eletrônica em andamento.');
    expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain(
      'Há uma assinatura eletrônica em andamento.',
    );
    expect(notifications.push).not.toHaveBeenCalledWith('error', expect.anything());
    expect(cmp.markingSigned()).toBe(false);
  });

  /**
   * Wrapper condicional da linha de botões de assinatura. Identificado pelo
   * conjunto exato de utilitários (`gap-2` sozinho colide com a linha do badge).
   */
  function buttonRow(fixture: { nativeElement: HTMLElement }) {
    return (
      (Array.from(fixture.nativeElement.querySelectorAll('div')) as HTMLElement[]).find((el) => {
        const c = el.classList;
        return (
          c.contains('flex-col') &&
          c.contains('sm:flex-row') &&
          c.contains('gap-2') &&
          // exclui a linha de ações do arquivo (Baixar/Abrir/Remover).
          !c.contains('flex-wrap')
        );
      }) ?? null
    );
  }

  it('após o status virar SIGNED, os DOIS botões somem (auto-ocultação pelo status)', () => {
    const fixture = makeFixture('MANUAL');
    expect(markSignedButton(fixture)).toBeTruthy();
    expect(signatureRequestButton(fixture)).toBeTruthy();

    state.set(snapshot('SIGNED'));
    fixture.detectChanges();

    expect(markSignedButton(fixture)).toBeNull();
    expect(signatureRequestButton(fixture)).toBeNull();
  });

  it('sem nenhum botão de assinatura o wrapper da linha nem renderiza (sem gap fantasma)', () => {
    const fixture = makeFixture('MANUAL');
    // Com botões visíveis o wrapper existe…
    expect(buttonRow(fixture)).toBeTruthy();

    state.set(snapshot('PENDING'));
    fixture.detectChanges();

    // …e sem eles some inteiro — uma div vazia deixaria ~16px de space-y-4
    // sobrando acima do aviso "Aguardando signatários assinarem.".
    expect(buttonRow(fixture)).toBeNull();
  });
});
