import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { RentalContractCard } from './rental-contract-card';
import { DocumentPreviewService } from '../../../components/document-preview/document-preview.service';
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
 * Download e abertura do contrato.
 *
 * O eixo destes testes é UM só: quem decide o formato são os BYTES, nunca o
 * `mimeType` da linha. Nas linhas LEGADAS (assinadas antes do FIX-0771) o backend
 * sobrescreveu o MESMO objeto `.docx` do storage com o PDF assinado e não atualizou
 * `mime_type` — um contrato AUTO assinado nessa época se declara DOCX pra sempre.
 * Decidir pelo MIME jogaria bytes de PDF num parser de DOCX e quebraria justamente o
 * contrato ASSINADO.
 *
 * Stub no HTTP boundary (RentalService.documentSignedUrl), em `fetch` e no DOM.
 */
describe('RentalContractCard — download & abrir no visualizador', () => {
  const RID = 'rid';
  /** MIME que uma linha LEGADA mantém mesmo depois do arquivo virar PDF. */
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
  /** O visualizador do app é colaborador aqui; o sujeito é o card. */
  const preview = { open: vi.fn(), close: vi.fn() };

  /** Bytes de um PDF de verdade — o que importa é só a assinatura `%PDF-`. */
  function pdfBytes(): ArrayBuffer {
    return new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n').buffer as ArrayBuffer;
  }

  /** Bytes de um `.docx` (container ZIP: `PK\x03\x04`). */
  function docxBytes(size = 64): ArrayBuffer {
    const bytes = new Uint8Array(size);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
    return bytes.buffer;
  }

  function snapshot(mimeType = DOCX_MIME): RentalStateSnapshot {
    return {
      documents: [{ kind: 'CONTRACT', id: 'd1', mimeType } as any],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: { status: 'NOT_REQUIRED' } as any,
    };
  }

  /** Resposta de `fetch` com corpo binário (servidor que IGNOROU o Range). */
  function okResponse(buffer: ArrayBuffer) {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer,
      blob: async () => new Blob([buffer]),
    };
  }

  /** Curto-circuito pros fluxos que só passam por promises já resolvidas. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    notifications.push.mockClear();
    preview.open.mockReset();
    preview.close.mockReset();
    rentalService.documentSignedUrl.mockReset();
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/c.docx' } as any));
    state.set(snapshot());
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
        { provide: DocumentPreviewService, useValue: preview },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalContractCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.detectChanges();
    return fixture;
  }

  it('downloadContract: fetch signed URL → anchor click → revoga blob URL', async () => {
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/x' } as any));
    const blob = new Blob([docxBytes()]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue({ ok: true, blob: async () => blob } as any);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadContract();
    await settle();

    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(fetchSpy).toHaveBeenCalledWith('https://signed/x');
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    // A revogação é adiada: revogar antes do click cancelaria o download.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(revokeUrl).toHaveBeenCalledWith('blob:mock');
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

  /**
   * Regressão do bug do contrato assinado: o `mimeType` diz DOCX, os bytes são
   * PDF. Salvar como `Contrato-rid.docx` produzia um arquivo que o Word recusa
   * — e o inverso (`.pdf` num DOCX de verdade) o Windows nem abre.
   */
  it('download nomeia pela ASSINATURA dos bytes, não pelo mimeType', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const originalCreate = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        el.click = vi.fn();
        anchors.push(el);
      }
      return el;
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue({ ok: true, blob: async () => new Blob([docxBytes()]) } as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadContract();
    await settle();
    expect(anchors[0].download).toBe(`Contrato-${RID}.docx`);

    // Mesma linha, MESMO mimeType (DOCX) — só os bytes mudaram para PDF.
    fetchSpy.mockResolvedValue({ ok: true, blob: async () => new Blob([pdfBytes()]) } as any);
    (fixture.componentInstance as any).downloadContract();
    await settle();
    expect(anchors[1].download).toBe(`Contrato-${RID}.pdf`);
  });

  describe('FIX-0754: LATE_INTEREST_PERCENT_REQUIRED (aluguel legado sem % ao mês)', () => {
    const MESSAGE = 'Defina o juros ao mês (de 0% a 10%) neste aluguel antes de gerar o contrato.';

    function refuse(body: Record<string, unknown>): void {
      rentalService.documentSignedUrl.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: body })),
      );
    }

    /** Toca em "Abrir contrato" e faz o que o visualizador faria: chama o carregador. */
    function openAndLoad(fixture: { componentInstance: unknown }): void {
      (fixture.componentInstance as any).openContract();
      const [request] = preview.open.mock.calls.at(-1) as [{ source: () => Observable<unknown> }];
      request.source().subscribe({ error: () => undefined });
    }

    const banner = (fixture: { nativeElement: HTMLElement }): HTMLElement | null =>
      fixture.nativeElement.querySelector('app-alert-banner');
    const shortcut = (fixture: { nativeElement: HTMLElement }): HTMLAnchorElement | null =>
      fixture.nativeElement.querySelector('[data-testid="edit-rental-shortcut"]');

    it('mostra a mensagem do backend com atalho para editar o aluguel', async () => {
      refuse({ message: MESSAGE, code: 'LATE_INTEREST_PERCENT_REQUIRED' });
      const fixture = makeFixture();
      openAndLoad(fixture);
      await settle();
      fixture.detectChanges();

      // O modal fecha: o banner do card é quem tem o atalho que resolve.
      expect(preview.close).toHaveBeenCalledTimes(1);
      expect(banner(fixture)?.textContent).toContain(MESSAGE);
      expect(shortcut(fixture)?.getAttribute('href')).toBe(`/alugueis/${RID}/editar`);
    });

    it('também reconhece o código dentro da lista issues', async () => {
      refuse({
        message: MESSAGE,
        issues: [{ field: 'lateInterestPercentPerMonth', code: 'LATE_INTEREST_PERCENT_REQUIRED', message: MESSAGE }],
      });
      const fixture = makeFixture();
      openAndLoad(fixture);
      await settle();
      fixture.detectChanges();

      expect(shortcut(fixture)).not.toBeNull();
    });

    it('outra recusa 400 fica no modal: sem fechar, sem banner e sem atalho', async () => {
      refuse({ message: 'Contrato não encontrado.', code: 'NOT_FOUND' });
      const fixture = makeFixture();
      openAndLoad(fixture);
      await settle();
      fixture.detectChanges();

      expect(preview.close).not.toHaveBeenCalled();
      expect(banner(fixture)).toBeNull();
      expect(shortcut(fixture)).toBeNull();
    });

    it('um erro posterior de outro tipo esconde o atalho', async () => {
      refuse({ message: MESSAGE, code: 'LATE_INTEREST_PERCENT_REQUIRED' });
      const fixture = makeFixture();
      openAndLoad(fixture);
      await settle();
      refuse({ message: 'Servidor indisponível.', code: 'SOMETHING_ELSE' });
      openAndLoad(fixture);
      await settle();
      fixture.detectChanges();

      expect(shortcut(fixture)).toBeNull();
    });
  });

  /**
   * "Abrir contrato" usa o visualizador do app — nada de aba nova, nada de HTML escrito
   * numa aba same-origin. O formato (PDF assinado vs DOCX AUTO), o teto de render e a
   * extensão do download são do visualizador, cobertos em `document-preview-viewer.spec`.
   */
  it('openContract: abre o visualizador do app com a signed URL do contrato, sem aba nova', () => {
    const windowOpen = vi.spyOn(window, 'open');
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/c.docx' } as any));
    const fixture = makeFixture();

    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === 'Abrir contrato');
    button?.click();

    expect(windowOpen).not.toHaveBeenCalled();
    expect(preview.open).toHaveBeenCalledTimes(1);
    const [request] = preview.open.mock.calls[0] as [
      { source: () => Observable<{ url: string }>; fileName: string; errorMessage: string },
    ];
    // Sem extensão: quem decide `.pdf`/`.docx` são os bytes, no visualizador.
    expect(request.fileName).toBe(`Contrato-${RID}`);
    expect(request.errorMessage).toBe('Não foi possível abrir o contrato.');
    expect(rentalService.documentSignedUrl).not.toHaveBeenCalled();

    let url = '';
    request.source().subscribe((res) => (url = res.url));
    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(url).toBe('https://signed/c.docx');
  });

  it('openContract: sem contrato carregado não abre nada', () => {
    state.set({ ...snapshot(), documents: [] });
    const fixture = makeFixture();
    (fixture.componentInstance as unknown as { openContract(): void }).openContract();
    expect(preview.open).not.toHaveBeenCalled();
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
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
    deleteDocument: vi.fn(),
    requestContractSignature: vi.fn(),
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

  it('rejeita PDF acima de 20MB inline e NÃO dispara nenhuma chamada HTTP', () => {
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 21 * 1024 * 1024)));
    fixture.detectChanges();

    expect(rentalService.uploadContractWithProgress).not.toHaveBeenCalled();
    expect(cmp.uploading()).toBe(false);
    expect(cmp.error()).toContain('20MB');
    expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain('20MB');
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

  it('aceita DOCX e envia com o Content-Type do DOCX', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(NEVER);
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.docx', DOCX, 1024)));

    expect(rentalService.uploadContractWithProgress).toHaveBeenCalledTimes(1);
    expect(rentalService.uploadContractWithProgress.mock.calls[0][1].type).toBe(DOCX);
  });

  it('DOCX com File.type vazio é aceito pela extensão e reenviado com o tipo correto', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(NEVER);
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.DOCX', '', 1024)));

    expect(rentalService.uploadContractWithProgress.mock.calls[0][1].type).toBe(DOCX);
  });

  it('aceita arquivo de 15MB (acima do teto antigo de 10MB)', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(NEVER);
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('c.pdf', 'application/pdf', 15 * 1024 * 1024)));

    expect(rentalService.uploadContractWithProgress).toHaveBeenCalledTimes(1);
  });

  it('seletor aceita PDF e DOCX', () => {
    const fixture = makeFixture();
    const accept = fixture.nativeElement.querySelector('input[type=file]').getAttribute('accept');
    expect(accept).toContain('.docx');
    expect(accept).toContain('.pdf');
  });

  it('400 do backend (formato) aparece no banner inline', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 400, error: { message: 'Arquivo deve ser PDF ou DOCX.' } }),
      ),
    );
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 1024)));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain(
      'Arquivo deve ser PDF ou DOCX.',
    );
  });

  describe('substituição e envio para assinatura', () => {
    function withStatus(status: string, mimeType = DOCX) {
      state.set({
        documents: [{ kind: 'CONTRACT', id: 'd1', mimeType, sizeBytes: 10 } as any],
        checkinPhotos: [],
        checkoutPhotos: [],
        contractSignature: { status } as any,
      });
    }
    const texts = (f: any) => f.nativeElement.textContent as string;

    it.each(['SIGNED', 'PENDING'])('%s: sem botão Substituir e o upload é recusado sem HTTP', (st) => {
      withStatus(st);
      const fixture = makeFixture();
      fixture.detectChanges();
      expect(texts(fixture)).not.toContain('Substituir contrato');
      (fixture.componentInstance as any).onFileSelected(
        fileEvent(makeFile('c.pdf', 'application/pdf', 1024)),
      );
      expect(rentalService.uploadContractWithProgress).not.toHaveBeenCalled();
      expect((fixture.componentInstance as any).error()).toContain('não pode ser substituído');
    });

    it.each(['NOT_REQUIRED', 'REFUSED', 'EXPIRED'])(
      '%s: contrato DOCX próprio mostra Substituir, tipo DOCX e botão de assinatura',
      (st) => {
        withStatus(st);
        const fixture = makeFixture();
        fixture.detectChanges();
        expect(texts(fixture)).toContain('Substituir contrato');
        expect(texts(fixture)).toContain('DOCX');
        expect(texts(fixture)).toMatch(/Solicitar assinatura|Reenviar para assinatura/);
        expect(texts(fixture)).toContain('Baixar Contrato');
      },
    );

    it.each(['SIGNED', 'PENDING'])('%s: sem botão Remover e remoção bloqueada sem HTTP', (st) => {
      withStatus(st);
      rentalService.deleteDocument.mockReset();
      const fixture = makeFixture();
      fixture.detectChanges();
      expect(texts(fixture)).not.toContain('Remover');
      const cmp = fixture.componentInstance as any;
      cmp.askDelete();
      expect(cmp.deleteOpen()).toBe(false);
      cmp.confirmDelete();
      expect(rentalService.deleteDocument).not.toHaveBeenCalled();
    });

    it('NOT_REQUIRED: botão Remover aparece', () => {
      withStatus('NOT_REQUIRED');
      const fixture = makeFixture();
      fixture.detectChanges();
      expect(texts(fixture)).toContain('Remover');
    });

    it('409 do backend no upload aparece no banner', () => {
      withStatus('NOT_REQUIRED');
      const msg = 'O contrato mudou durante a operação. Recarregue e tente de novo.';
      rentalService.uploadContractWithProgress.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { message: msg } })),
      );
      const fixture = makeFixture();
      (fixture.componentInstance as any).onFileSelected(
        fileEvent(makeFile('c.pdf', 'application/pdf', 1024)),
      );
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain(msg);
    });

    it('409 do backend na remoção aparece no banner', () => {
      withStatus('NOT_REQUIRED');
      const msg = 'Contrato em assinatura ou assinado não pode ser removido.';
      rentalService.deleteDocument.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { message: msg } })),
      );
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as any;
      cmp.askDelete();
      cmp.confirmDelete();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain(msg);
    });

    it('409 do backend no envio para assinatura aparece no banner', () => {
      withStatus('NOT_REQUIRED');
      const msg = 'O estado da assinatura mudou. Atualize a página.';
      rentalService.requestContractSignature.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { message: msg } })),
      );
      const fixture = makeFixture();
      const cmp = fixture.componentInstance as any;
      cmp.signers.set([{ name: 'A', email: 'a@b.co' }]);
      cmp.submitSignature();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-alert-banner')?.textContent).toContain(msg);
    });

    it('SIGNED rotula PDF mesmo com mimeType DOCX na linha', () => {
      withStatus('SIGNED', DOCX);
      const fixture = makeFixture();
      fixture.detectChanges();
      expect((fixture.componentInstance as any).fileTypeLabel()).toBe('PDF');
    });
  });

  it('upload que falha com 413 mostra a mensagem de tamanho inline', () => {
    rentalService.uploadContractWithProgress.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413 })),
    );
    const fixture = makeFixture();
    const cmp = fixture.componentInstance as any;

    cmp.onFileSelected(fileEvent(makeFile('contrato.pdf', 'application/pdf', 1024)));
    fixture.detectChanges();

    expect(cmp.error()).toContain('20MB');
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
