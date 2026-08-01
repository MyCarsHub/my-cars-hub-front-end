import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { RentalContractCard } from './rental-contract-card';
import { ContractDocxPreviewService } from './contract-docx-preview.service';
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
 * `mimeType` da linha. Ao receber o webhook do Autentique o backend sobrescreve
 * o MESMO objeto `.docx` do storage com o PDF assinado e não atualiza
 * `mime_type` (AutentiqueWebhookService:141, RentalDocumentService:190) — um
 * contrato AUTO assinado se declara DOCX pra sempre. Decidir pelo MIME jogaria
 * bytes de PDF num parser de DOCX e quebraria justamente o contrato ASSINADO.
 *
 * Stub no HTTP boundary (RentalService.documentSignedUrl), em `fetch` e no DOM.
 */
describe('RentalContractCard — download & open PDF', () => {
  const RID = 'rid';
  /** MIME que o backend mantém mesmo depois do arquivo virar PDF. */
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
  /**
   * Dublê do serviço que embrulha o `import()` dinâmico de docx-preview. Trocar
   * por DI (e não por `vi.mock`) é deliberado: no runner do Angular + Vitest um
   * `import()` dinâmico nunca resolve, e mockar o módulo não conserta isso.
   */
  const docxPreview = { render: vi.fn() };

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

  /**
   * Aba falsa. `document.open/write/close` espelham o que o card usa, e
   * `getElementById` devolve um host REAL (deste documento) pra que o
   * renderizador tenha onde escrever. `ops` registra a SEQUÊNCIA das chamadas
   * de documento — ver {@link expectPagesReplaced}.
   */
  function fakeTab() {
    const written: string[] = [];
    const ops: string[] = [];
    const host = document.createElement('div');
    return {
      location: { href: '' },
      close: vi.fn(),
      host,
      document: {
        open: vi.fn(() => ops.push('open')),
        write: vi.fn((html: string) => {
          ops.push('write');
          written.push(html);
        }),
        close: vi.fn(() => ops.push('close')),
        getElementById: vi.fn(() => host),
      },
      written,
      ops,
    };
  }

  /**
   * Cada página escrita SUBSTITUI a anterior. Sem o `document.open()` o `write`
   * concatenaria os documentos e todas as asserções que leem a ÚLTIMA página
   * continuariam verdes — mas a aba mostraria o "Carregando…" grudado em cima
   * do erro, e o host abandonado pelo watchdog voltaria a existir. Por isso a
   * checagem é sobre a SEQUÊNCIA `open → write → close`, uma por página.
   */
  function expectPagesReplaced(tab: ReturnType<typeof fakeTab>): void {
    expect(tab.written.length).toBeGreaterThan(0);
    expect(tab.document.open).toHaveBeenCalledTimes(tab.written.length);
    expect(tab.ops.join(',')).toBe(
      Array.from({ length: tab.written.length }, () => 'open,write,close').join(','),
    );
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

  /** Resposta 206 do storage: só a fatia pedida pelo header `Range`. */
  function partialResponse(buffer: ArrayBuffer) {
    return {
      ok: true,
      status: 206,
      arrayBuffer: async () => buffer.slice(0, 5),
      blob: async () => new Blob([buffer.slice(0, 5)]),
    };
  }

  /** O header que a sonda de formato precisa mandar. */
  const SNIFF_INIT = { headers: { Range: 'bytes=0-4' } };

  /** Curto-circuito pros fluxos que só passam por promises já resolvidas. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    notifications.push.mockClear();
    docxPreview.render.mockReset();
    docxPreview.render.mockResolvedValue(undefined);
    rentalService.documentSignedUrl.mockReset();
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/c.docx' } as any));
    state.set(snapshot());
    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: DriverService, useValue: driverService },
        { provide: SessionService, useValue: session },
        { provide: NotificationService, useValue: notifications },
        { provide: ContractDocxPreviewService, useValue: docxPreview },
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

  it('openContract: bytes %PDF- (mesmo com mimeType DOCX) → aba vai direto pro arquivo', async () => {
    rentalService.documentSignedUrl.mockReturnValue(of({ url: 'https://signed/c.docx' } as any));
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(partialResponse(pdfBytes()) as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    // Fidelidade máxima: o arquivo real vai pro viewer nativo do browser.
    expect(tab.location.href).toBe('https://signed/c.docx');
    // O renderizador NUNCA é carregado — nem um PDF vira "prévia".
    expect(docxPreview.render).not.toHaveBeenCalled();
    // E nada da moldura de visualização foi escrito na aba.
    expect(tab.written.join('')).not.toContain('Visualização do contrato');
    expect((fixture.componentInstance as any).error()).toBeNull();
    expect((fixture.componentInstance as any).opening()).toBe(false);
    expectPagesReplaced(tab);
  });

  /**
   * Regressão de FRANQUIA DE DADOS. O caminho normal do app é um PDF anexado à
   * mão (até 10MB) que o browser mesmo renderiza. Puxar o arquivo inteiro só
   * pra ler 5 bytes e depois deixar a aba baixar TUDO de novo custava o dobro
   * dos dados móveis no fluxo mais usado — exatamente o que a regra
   * mobile-first do projeto proíbe.
   */
  it('openContract: fareja o formato com Range e baixa só a cabeça no caminho PDF', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue(partialResponse(pdfBytes()) as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://signed/c.docx', SNIFF_INIT);
    expect(tab.location.href).toBe('https://signed/c.docx');
    expect((fixture.componentInstance as any).opening()).toBe(false);
  });

  /**
   * Alguns proxies/CDNs ignoram `Range` e devolvem 200 com o arquivo inteiro.
   * Nesse caso os bytes JÁ ESTÃO na mão: um segundo GET desfaria toda a
   * economia que a sonda existe pra garantir.
   */
  it('openContract: resposta 200 (Range ignorado) reaproveita o corpo, sem segundo GET', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const source = docxBytes();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue(okResponse(source) as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://signed/c.docx', SNIFF_INIT);
    // E o parser recebeu o corpo COMPLETO que já havia chegado.
    expect(docxPreview.render).toHaveBeenCalledOnce();
    expect(docxPreview.render.mock.calls[0][0]).toBe(source);
  });

  /** 206 no ramo DOCX: a cabeça não basta pro parser, aí sim vai o GET cheio. */
  it('openContract: 206 + bytes DOCX busca o arquivo completo (sem Range) pro parser', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const source = docxBytes();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(partialResponse(source) as any)
      .mockResolvedValueOnce(okResponse(source) as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]).toEqual(['https://signed/c.docx', SNIFF_INIT]);
    expect(fetchSpy.mock.calls[1]).toEqual(['https://signed/c.docx']);
    expect(docxPreview.render).toHaveBeenCalledOnce();
    expect(docxPreview.render.mock.calls[0][0]).toBe(source);
  });

  /**
   * Rede de segurança do caminho PDF. Firefox Android, WebViews e um
   * `Content-Type` velho no storage transformam a navegação em DOWNLOAD e a aba
   * não sai do lugar. A página escrita ANTES do `location.href` é o que ela
   * mostra nesse caso — sem isto o usuário ficava encarando "Carregando
   * contrato…" pra sempre, que parece um app travado.
   */
  it('openContract: escreve a ponte com link ANTES de navegar pro PDF', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(partialResponse(pdfBytes()) as any);
    // Prova de ORDEM: a navegação só pode acontecer com a página já no lugar.
    const hrefAtWrite: string[] = [];
    tab.document.write.mockImplementation((html: string) => {
      hrefAtWrite.push(tab.location.href);
      tab.written.push(html);
      tab.ops.push('write');
    });

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    const bridge = tab.written[tab.written.length - 1];
    expect(bridge).toContain('Abrindo o contrato');
    // Carrega o arquivo: a aba estranhada tem como chegar no documento.
    expect(bridge).toContain('https://signed/c.docx');
    expect(bridge).toContain('download');
    expect(hrefAtWrite[hrefAtWrite.length - 1]).toBe('');
    expect(tab.location.href).toBe('https://signed/c.docx');
  });

  /**
   * A falha mais provável do mundo real: a signed URL expirou entre o clique e
   * o `fetch`. O storage responde 4xx e a aba PRECISA acabar na página com o
   * arquivo original — nunca no spinner.
   */
  it('openContract: fetch !ok (signed URL expirada) → erro inline + aba com o arquivo ORIGINAL', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    const cmp = fixture.componentInstance as any;
    expect(cmp.error()).toContain('Baixar Contrato');
    expect(docxPreview.render).not.toHaveBeenCalled();
    const last = tab.written[tab.written.length - 1];
    expect(last).toContain('Não foi possível exibir o contrato');
    expect(last).toContain('https://signed/c.docx');
    expect(tab.close).not.toHaveBeenCalled();
    expect(cmp.opening()).toBe(false);
    expectPagesReplaced(tab);
  });

  it('openContract: fetch que REJEITA (rede caiu) → erro inline + aba com o arquivo ORIGINAL', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new TypeError('Failed to fetch'));

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    const cmp = fixture.componentInstance as any;
    expect(cmp.error()).toContain('Baixar Contrato');
    expect(tab.written[tab.written.length - 1]).toContain('https://signed/c.docx');
    expect(cmp.opening()).toBe(false);
  });

  /** Objeto existe no storage mas está truncado/zerado — não dá pra farejar nada. */
  it('openContract: arquivo vazio no storage → aba com o arquivo ORIGINAL', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(okResponse(new ArrayBuffer(0)) as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    const cmp = fixture.componentInstance as any;
    expect(docxPreview.render).not.toHaveBeenCalled();
    expect(cmp.error()).toContain('Baixar Contrato');
    expect(tab.written[tab.written.length - 1]).toContain('https://signed/c.docx');
    expect(cmp.opening()).toBe(false);
  });

  it('openContract: bytes DOCX → renderizador roda e a aba recebe o documento', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const source = docxBytes();
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(okResponse(source) as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();

    // A aba é preenchida ANTES de qualquer await — nada de aba branca parada.
    expect(tab.written[0]).toContain('Carregando contrato');
    await settle();

    expect(docxPreview.render).toHaveBeenCalledOnce();
    expect(docxPreview.render.mock.calls[0][0]).toBe(source);
    // Renderiza DENTRO do host da aba nova, não navega pra lugar nenhum.
    expect(docxPreview.render.mock.calls[0][1]).toBe(tab.host);
    expect(tab.location.href).toBe('');
    expect(tab.written[tab.written.length - 1]).toContain('Visualização do contrato');
    expect((fixture.componentInstance as any).error()).toBeNull();
    expect((fixture.componentInstance as any).opening()).toBe(false);
  });

  it('openContract: falha no render → erro inline + aba com o arquivo ORIGINAL', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(okResponse(docxBytes()) as any);
    docxPreview.render.mockRejectedValue(new Error('docx corrompido'));

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();
    fixture.detectChanges();

    const cmp = fixture.componentInstance as any;
    expect(cmp.error()).toContain('Baixar Contrato');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeTruthy();
    // A aba NÃO fica branca nem fechada: recebe a página de fallback com o
    // link pro arquivo ORIGINAL.
    expect(tab.close).not.toHaveBeenCalled();
    const last = tab.written[tab.written.length - 1];
    expect(last).toContain('Não foi possível exibir o contrato');
    expect(last).toContain('https://signed/c.docx');
    expect(cmp.opening()).toBe(false);
    // Três páginas (Carregando → visualizador → erro), cada uma substituindo a
    // anterior: é o `document.open()` que descarta o host onde o render travado
    // ainda pode escrever depois do watchdog.
    expect(tab.written).toHaveLength(3);
    expectPagesReplaced(tab);
  });

  it('openContract: render travado estoura o watchdog e cai no arquivo ORIGINAL', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(okResponse(docxBytes()) as any);
    // Render que nunca resolve — o `.docx` patológico que prendia a aba.
    docxPreview.render.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await vi.advanceTimersByTimeAsync(31_000);

    const cmp = fixture.componentInstance as any;
    expect(cmp.error()).toContain('Baixar Contrato');
    expect(tab.written[tab.written.length - 1]).toContain('https://signed/c.docx');
    expect(cmp.opening()).toBe(false);

    vi.useRealTimers();
  });

  it('openContract: arquivo grande demais nem chega ao parser', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    // 9MB de DOCX: acima do teto de render — uma aba de celular não aguenta.
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      okResponse(docxBytes(9 * 1024 * 1024)) as any,
    );

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();
    await settle();

    expect(docxPreview.render).not.toHaveBeenCalled();
    expect(tab.written[tab.written.length - 1]).toContain('https://signed/c.docx');
    expect((fixture.componentInstance as any).opening()).toBe(false);
  });

  /**
   * Sem signed URL não há arquivo pra oferecer, então a aba é fechada. Mas
   * `close()` é NO-OP silencioso em vários browsers mobile e o `catch` do card
   * engole isso: a mensagem tem que estar escrita ANTES, senão a aba sobrevive
   * presa no "Carregando contrato…".
   */
  it('openContract: erro do signed URL escreve a explicação ANTES de tentar fechar a aba', () => {
    rentalService.documentSignedUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'fetch failed' } })),
    );
    const tab = fakeTab();
    // Simula o browser que RECUSA fechar — a aba continua viva depois do close.
    tab.close.mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockReturnValue(tab as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();

    expect(rentalService.documentSignedUrl).toHaveBeenCalledWith(RID, 'd1');
    expect(tab.close).toHaveBeenCalled();
    const last = tab.written[tab.written.length - 1];
    expect(last).toContain('Não foi possível abrir o contrato');
    expect(last).not.toContain('Carregando contrato');
    // Sem link: a signed URL nunca chegou, não existe arquivo pra apontar.
    expect(last).toContain('Baixar Contrato');
    expect((fixture.componentInstance as any).error()).toBe('fetch failed');
    expect(notifications.push).not.toHaveBeenCalledWith('error', 'fetch failed');
    expect((fixture.componentInstance as any).opening()).toBe(false);
    expectPagesReplaced(tab);
  });

  it('openContract: pop-up bloqueado → banner inline e sem chamar service', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openContract();

    expect(rentalService.documentSignedUrl).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).error()).toBe(
      'Permita pop-ups pra abrir o contrato.',
    );
    expect(notifications.push).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).opening()).toBe(false);
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
