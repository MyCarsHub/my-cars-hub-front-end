import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAINTENANCE_DOCUMENT_PLACEHOLDER_COPY,
  MaintenanceDocumentsCard,
} from './maintenance-documents-card';
import { ApiErrorService } from '../../services/api-error.service';
import { flatErrorMessage, parseApiError } from '../../services/api-error';
import { MaintenancesService } from '../../services/maintenances.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import type { MaintenanceDocument } from '../../types/maintenance.types';

/**
 * Anexos da manutenção: GRADE DE SLOTS, um por tipo esperado.
 *
 * Todo teste de interação passa PELO DOM — `click()` de verdade no slot,
 * `dispatchEvent` de `change` de verdade no `<input type="file">`. Chamar o
 * método do componente direto provaria que o método funciona, não que a tela
 * funciona, e foi exatamente assim que um defeito atravessou uma suíte verde
 * neste projeto.
 *
 * A INVARIANTE CENTRAL desta suíte, e a razão de ela ser mais crítica aqui que
 * nos cards irmãos: uma manutenção tem NORMALMENTE várias notas fiscais — peça
 * e mão de obra saem de fornecedores diferentes. Enviar ACRESCENTA e NUNCA
 * SUBSTITUI; uma substituição apagaria em silêncio a nota do outro fornecedor.
 */
describe('MaintenanceDocumentsCard', () => {
  const MAINTENANCE_ID = 'mnt-1';

  const notaPeca: MaintenanceDocument = {
    id: 'doc-1',
    maintenanceId: MAINTENANCE_ID,
    kind: 'NOTA_FISCAL',
    kindLabel: 'Nota fiscal',
    fileName: 'nota-peca.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 204_800,
    uploadedBy: 'user-1',
    createdDate: '2026-03-02T12:00:00',
  };

  /** A segunda nota, do OUTRO fornecedor — a que uma substituição mataria. */
  const notaMaoDeObra: MaintenanceDocument = {
    ...notaPeca,
    id: 'doc-2',
    fileName: 'nota-mao-de-obra.pdf',
    createdDate: '2026-03-05T12:00:00',
  };

  let listDocuments: ReturnType<typeof vi.fn>;
  let uploadDocument: ReturnType<typeof vi.fn>;
  let deleteDocument: ReturnType<typeof vi.fn>;
  let documentSignedUrl: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let closeTab: ReturnType<typeof vi.fn>;
  let openPendingTab: ReturnType<typeof vi.fn>;
  let successToast: ReturnType<typeof vi.fn>;
  let infoToast: ReturnType<typeof vi.fn>;
  let errorToast: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<MaintenanceDocumentsCard>;

  /** Leitura de estado só para asserção — a AÇÃO nunca passa por aqui. */
  interface CardState {
    error(): string | null;
    documents(): MaintenanceDocument[];
  }

  function state(): CardState {
    return fixture.componentInstance as unknown as CardState;
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function slotKinds(): string[] {
    return Array.from(host().querySelectorAll('[data-kind]')).map(
      (el) => el.getAttribute('data-kind') ?? '',
    );
  }

  function slotEl(kind: string): HTMLElement {
    const el = host().querySelector<HTMLElement>(`[data-kind="${kind}"]`);
    if (!el) throw new Error(`slot ${kind} não está na tela`);
    return el;
  }

  /** O cabeçalho do slot: o botão que É a afordância de anexar. */
  function slotButton(kind: string): HTMLButtonElement {
    const el = slotEl(kind).querySelector<HTMLButtonElement>(':scope > button');
    if (!el) throw new Error(`slot ${kind} não tem botão de anexar`);
    return el;
  }

  function slotFileRows(kind: string): HTMLElement[] {
    return Array.from(slotEl(kind).querySelectorAll<HTMLElement>('[data-file-row]'));
  }

  function slotText(kind: string): string {
    return slotEl(kind).textContent ?? '';
  }

  function rowButton(row: HTMLElement, label: string): HTMLButtonElement {
    const btn = Array.from(row.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    if (!btn) throw new Error(`a linha do arquivo não tem o botão "${label}"`);
    return btn;
  }

  function confirmDialogButton(label: string): HTMLButtonElement {
    const dialog = host().querySelector('app-confirm-dialog');
    if (!dialog) throw new Error('o diálogo de confirmação não está na tela');
    const btn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    if (!btn) throw new Error(`o diálogo não tem o botão "${label}"`);
    return btn;
  }

  function fileInput(): HTMLInputElement {
    const el = host().querySelector<HTMLInputElement>('input[type="file"]');
    if (!el) throw new Error('o seletor de arquivos não está na tela');
    return el;
  }

  /** `change` no input REAL, sem depender de DataTransfer (jsdom não tem). */
  function dispatchFile(file: File | null): void {
    const input = fileInput();
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /**
   * O gesto completo do usuário: toca no slot do tipo, o seletor abre, escolhe
   * o arquivo. Duas interações de DOM de verdade, nenhuma chamada de método.
   */
  function attach(kind: string, file: File): void {
    slotButton(kind).click();
    fixture.detectChanges();
    dispatchFile(file);
  }

  function doc(name = 'nota.pdf', size = 1024, type = 'application/pdf'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
  }

  async function setup(): Promise<void> {
    fixture = TestBed.createComponent(MaintenanceDocumentsCard);
    fixture.componentRef.setInput('maintenanceId', MAINTENANCE_ID);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    listDocuments = vi.fn(() => of([]));
    uploadDocument = vi.fn(() => of(notaPeca));
    deleteDocument = vi.fn(() => of(void 0));
    documentSignedUrl = vi.fn(() => of({ url: 'https://signed/doc', expiresInSeconds: 60 }));
    navigate = vi.fn();
    closeTab = vi.fn();
    openPendingTab = vi.fn(() => ({ blocked: false, navigate, close: closeTab }));
    successToast = vi.fn();
    infoToast = vi.fn();
    errorToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: MaintenancesService,
          useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
        },
        { provide: ExternalNavigationService, useValue: { openPendingTab } },
        {
          provide: NotificationService,
          useValue: {
            success: successToast,
            info: infoToast,
            error: errorToast,
            warning: vi.fn(),
          },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim: vi.fn(),
            // Delega ao pipeline REAL de parsing: sem isso o teste do erro de
            // negócio provaria apenas que o mock devolve o que mandaram nele.
            messageFor: vi.fn((e: unknown, fallback?: string) =>
              flatErrorMessage(parseApiError(e), fallback),
            ),
          },
        },
      ],
    });
  });

  it('mostra exatamente os dois slots do backend, nesta ordem', async () => {
    await setup();
    expect(slotKinds()).toEqual(['NOTA_FISCAL', 'OTHER']);
  });

  it('lista na carga os anexos já existentes, no slot do seu tipo', async () => {
    listDocuments = vi.fn(() => of([notaPeca]));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    expect(listDocuments).toHaveBeenCalledWith(MAINTENANCE_ID);
    expect(slotFileRows('NOTA_FISCAL')).toHaveLength(1);
    expect(slotText('NOTA_FISCAL')).toContain('nota-peca.pdf');
  });

  // ------------------------------------------------------- a invariante central

  it('ANEXA e NUNCA SUBSTITUI: a segunda nota fiscal convive com a primeira', async () => {
    listDocuments = vi.fn(() => of([notaPeca]));
    uploadDocument = vi.fn(() => of(notaMaoDeObra));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();
    expect(slotFileRows('NOTA_FISCAL')).toHaveLength(1);

    attach('NOTA_FISCAL', doc('nota-mao-de-obra.pdf'));

    // As DUAS na tela, no mesmo slot. Se virar 1, a nota do outro fornecedor
    // foi apagada em silêncio — que é exatamente o defeito que este teste
    // existe para impedir.
    const rows = slotFileRows('NOTA_FISCAL');
    expect(rows).toHaveLength(2);
    const texto = slotText('NOTA_FISCAL');
    expect(texto).toContain('nota-peca.pdf');
    expect(texto).toContain('nota-mao-de-obra.pdf');
    expect(
      state()
        .documents()
        .map((d) => d.id),
    ).toEqual(['doc-1', 'doc-2']);
  });

  it('envia multipart com o kind do slot tocado', async () => {
    await setup();
    const file = doc('nota.pdf');

    attach('NOTA_FISCAL', file);

    expect(uploadDocument).toHaveBeenCalledWith(MAINTENANCE_ID, 'NOTA_FISCAL', file);
    expect(successToast).toHaveBeenCalledWith('Documento enviado.');
  });

  it('o slot OTHER envia com o seu próprio kind', async () => {
    await setup();

    attach('OTHER', doc('foto.jpg', 1024, 'image/jpeg'));

    expect(uploadDocument).toHaveBeenCalledWith(MAINTENANCE_ID, 'OTHER', expect.any(File));
  });

  // ------------------------------------------------------------------ guardas

  it('recusa formato fora da allowlist ANTES de chamar a API', async () => {
    await setup();

    attach('NOTA_FISCAL', doc('planilha.xlsx', 1024, 'application/vnd.ms-excel'));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(state().error()).toContain('Formato não suportado');
  });

  it('recusa arquivo acima de 20MB ANTES de gastar a franquia de dados', async () => {
    await setup();

    attach('NOTA_FISCAL', doc('nota.pdf', 21 * 1024 * 1024));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(state().error()).toContain('o limite é 20MB');
  });

  it('um corpo de erro não-array não chega no @for — a lista fica array', async () => {
    // FIX-0205: `docs ?? []` deixaria um objeto atravessar e estourar o
    // `.filter` de slots(). A guarda é `Array.isArray`.
    listDocuments = vi.fn(() => of({ message: 'boom' } as unknown as MaintenanceDocument[]));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    expect(state().documents()).toEqual([]);
    expect(slotFileRows('NOTA_FISCAL')).toHaveLength(0);
  });

  it('falha ao carregar vira banner inline e zera a lista, sem derrubar a tela', async () => {
    listDocuments = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    expect(state().documents()).toEqual([]);
    expect(state().error()).toContain('Não foi possível carregar os documentos.');
  });

  // ------------------------------------------------------------- signed URL

  it('abre pela signed URL numa aba reservada no gesto', async () => {
    listDocuments = vi.fn(() => of([notaPeca]));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    rowButton(slotFileRows('NOTA_FISCAL')[0], 'Abrir').click();
    fixture.detectChanges();

    expect(openPendingTab).toHaveBeenCalledWith(MAINTENANCE_DOCUMENT_PLACEHOLDER_COPY);
    expect(documentSignedUrl).toHaveBeenCalledWith(MAINTENANCE_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  it('falha na signed URL fecha a aba em vez de deixar aba branca órfã', async () => {
    listDocuments = vi.fn(() => of([notaPeca]));
    documentSignedUrl = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    rowButton(slotFileRows('NOTA_FISCAL')[0], 'Abrir').click();
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(state().error()).toContain('Não foi possível abrir o documento.');
  });

  // ---------------------------------------------------------------- remoção

  it('remove só o arquivo confirmado e mantém o outro na tela', async () => {
    listDocuments = vi.fn(() => of([notaPeca, notaMaoDeObra]));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();
    expect(slotFileRows('NOTA_FISCAL')).toHaveLength(2);

    rowButton(slotFileRows('NOTA_FISCAL')[0], 'Remover').click();
    fixture.detectChanges();
    confirmDialogButton('Remover').click();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(MAINTENANCE_ID, 'doc-1');
    expect(slotFileRows('NOTA_FISCAL')).toHaveLength(1);
    expect(slotText('NOTA_FISCAL')).toContain('nota-mao-de-obra.pdf');
  });

  // ----------------------------------------------------------- envio em voo

  it('anuncia "Enviando" só depois de o request começar, e cancela de verdade', async () => {
    const inflight = new Subject<MaintenanceDocument>();
    uploadDocument = vi.fn(() => inflight.asObservable());
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    // Só o toque no slot: o diálogo nativo pode ser dispensado sem escolher
    // nada, então NADA pode anunciar envio ainda.
    slotButton('NOTA_FISCAL').click();
    fixture.detectChanges();
    expect(slotText('NOTA_FISCAL')).not.toContain('Enviando');

    dispatchFile(doc('nota.pdf'));
    expect(slotText('NOTA_FISCAL')).toContain('Enviando');

    const cancelar = Array.from(slotEl('NOTA_FISCAL').querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Cancelar envio',
    );
    expect(cancelar).toBeTruthy();
    cancelar!.click();
    fixture.detectChanges();

    expect(infoToast).toHaveBeenCalledWith('Envio cancelado.');
    expect(slotText('NOTA_FISCAL')).not.toContain('Enviando');
  });

  it('não existe barra de progresso — o estado é indeterminado de propósito', async () => {
    const inflight = new Subject<MaintenanceDocument>();
    uploadDocument = vi.fn(() => inflight.asObservable());
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    attach('NOTA_FISCAL', doc('nota.pdf'));

    expect(host().querySelector('progress')).toBeNull();
    expect(host().querySelector('[role="progressbar"]')).toBeNull();
  });

  // ---------------------------------------------------------- acessibilidade

  it('cada slot tem alvo de toque confortável e rótulo lido pelo leitor de tela', async () => {
    await setup();

    const botao = slotButton('NOTA_FISCAL');
    // Mobile-first: 64px de altura mínima no cabeçalho do slot.
    expect(botao.className).toContain('min-h-[64px]');
    expect(botao.getAttribute('aria-label')).toBe('Anexar Nota fiscal — nenhum arquivo anexado');
  });

  it('o rótulo acessível conta os arquivos já anexados', async () => {
    listDocuments = vi.fn(() => of([notaPeca, notaMaoDeObra]));
    TestBed.overrideProvider(MaintenancesService, {
      useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
    });
    await setup();

    expect(slotButton('NOTA_FISCAL').getAttribute('aria-label')).toBe(
      'Anexar Nota fiscal — 2 arquivos',
    );
  });
});
