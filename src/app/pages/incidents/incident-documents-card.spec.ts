import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INCIDENT_DOCUMENT_PLACEHOLDER_COPY,
  IncidentDocumentsCard,
} from './incident-documents-card';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { ApiErrorService } from '../../services/api-error.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import type { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import type { IncidentDocument, IncidentDocumentKind } from '../../types/vehicle-incident.types';

/**
 * Anexos do sinistro: enviar, abrir por URL assinada e remover.
 *
 * O ponto sensível é o upload. NÃO existe barra de progresso aqui e isso é
 * deliberado — o app usa `withFetch()`, que nunca emite `UploadProgress`, então
 * qualquer barra seria uma animação desconectada do envio real. O estado é
 * indeterminado, e "Cancelar envio" precisa ABORTAR de verdade.
 */
describe('IncidentDocumentsCard', () => {
  const INCIDENT_ID = 'inc-1';

  const savedDocument: IncidentDocument = {
    id: 'doc-1',
    incidentId: INCIDENT_ID,
    kind: 'DAMAGE_PHOTO',
    kindLabel: 'Foto do dano',
    fileName: 'dano-frontal.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 204_800,
    uploadedBy: 'user-1',
    createdDate: '2026-03-02T12:00:00',
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
  let fixture: ComponentFixture<IncidentDocumentsCard>;

  interface CardInternals {
    error(): string | null;
    uploading(): boolean;
    documents(): IncidentDocument[];
    selectedKind: { set(k: IncidentDocumentKind): void };
    onFileSelected(event: Event): void;
    openDocument(doc: IncidentDocument): void;
    askDelete(doc: IncidentDocument): void;
    confirmDelete(): void;
    cancelUpload(): void;
  }

  function api(): CardInternals {
    return fixture.componentInstance as unknown as CardInternals;
  }

  /** `change` de um `<input type="file">` sem depender de DataTransfer. */
  function fileEvent(file: File | null): Event {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    return { target: input } as unknown as Event;
  }

  function photo(name = 'dano.jpg', size = 1024, type = 'image/jpeg'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
  }

  async function setup(): Promise<void> {
    fixture = TestBed.createComponent(IncidentDocumentsCard);
    fixture.componentRef.setInput('incidentId', INCIDENT_ID);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    listDocuments = vi.fn(() => of([]));
    uploadDocument = vi.fn(() => of(savedDocument));
    deleteDocument = vi.fn(() => of(void 0));
    documentSignedUrl = vi.fn(() => of({ url: 'https://signed/doc', expiresInSeconds: 60 }));
    navigate = vi.fn();
    closeTab = vi.fn();
    openPendingTab = vi.fn(() => ({ blocked: false, navigate, close: closeTab }));
    successToast = vi.fn();
    infoToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: VehicleIncidentsService,
          useValue: { listDocuments, uploadDocument, deleteDocument, documentSignedUrl },
        },
        { provide: ExternalNavigationService, useValue: { openPendingTab } },
        {
          provide: NotificationService,
          useValue: { success: successToast, info: infoToast, error: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim: vi.fn(),
            messageFor: vi.fn((_e: unknown, fallback?: string) => fallback ?? 'Erro'),
          },
        },
      ],
    });
  });

  it('envia o arquivo com o tipo escolhido e publica o anexo salvo', async () => {
    await setup();

    api().selectedKind.set('POLICE_REPORT');
    api().onFileSelected(fileEvent(photo('bo.pdf', 2048, 'application/pdf')));
    fixture.detectChanges();

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [incidentId, kind, file] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(incidentId).toBe(INCIDENT_ID);
    // O backend exige `kind` junto do arquivo — não é um passo posterior.
    expect(kind).toBe('POLICE_REPORT');
    expect(file).toBeInstanceOf(File);

    expect(api().documents()).toEqual([savedDocument]);
    expect(api().uploading()).toBe(false);
    expect(successToast).toHaveBeenCalledWith('Anexo enviado.');
  });

  it('recusa formato fora da allowlist sem gastar dados móveis', async () => {
    await setup();

    api().onFileSelected(fileEvent(photo('planilha.xlsx', 1024, 'application/vnd.ms-excel')));
    fixture.detectChanges();

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('PDF, JPG, PNG, WebP, HEIC/HEIF');
  });

  it('recusa arquivo acima de 20MB sem chamar a API', async () => {
    await setup();

    api().onFileSelected(fileEvent(photo('enorme.jpg', 21 * 1024 * 1024)));
    fixture.detectChanges();

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('20MB');
  });

  /** Alguns Android entregam `type` vazio para HEIC — o nome salva o envio. */
  it('aceita HEIC sem content-type pelo nome do arquivo', async () => {
    await setup();

    api().onFileSelected(fileEvent(photo('IMG_0042.HEIC', 1024, '')));
    fixture.detectChanges();

    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  /**
   * Estado indeterminado, nunca barra falsa: enquanto o upload está em voo a
   * tela diz "Enviando…" e oferece um cancelamento que ABORTA o request
   * (unsubscribe dispara o AbortController do FetchBackend).
   */
  it('mostra estado indeterminado sem barra de progresso durante o envio', async () => {
    const pending = new Subject<IncidentDocument>();
    uploadDocument.mockReturnValue(pending.asObservable());
    await setup();

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().uploading()).toBe(true);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Enviando o anexo…');
    expect(host.querySelector('progress')).toBeNull();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  /**
   * O cancelamento tem que DESFAZER A ASSINATURA, não só esconder o aviso: é o
   * `unsubscribe` que dispara o `AbortController` do FetchBackend e mata o
   * request no browser. Um botão que apenas trocasse o estado visual deixaria o
   * upload correndo e consumindo a franquia de dados do usuário.
   */
  it('"Cancelar envio" desfaz a assinatura, abortando o request de verdade', async () => {
    let aborted = false;
    uploadDocument.mockReturnValue(
      new Observable<IncidentDocument>(() => {
        // Teardown do Observable: só roda em unsubscribe.
        return () => {
          aborted = true;
        };
      }),
    );

    await setup();
    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();
    expect(api().uploading()).toBe(true);
    expect(aborted).toBe(false);

    api().cancelUpload();
    fixture.detectChanges();

    expect(aborted).toBe(true);
    expect(api().uploading()).toBe(false);
    expect(api().documents()).toHaveLength(0);
    expect(infoToast).toHaveBeenCalledWith('Envio cancelado.');
    expect(successToast).not.toHaveBeenCalled();
  });

  it('traduz o 413 do upload para o teto do cliente', async () => {
    uploadDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, statusText: 'Payload Too Large' })),
    );
    await setup();

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().error()).toContain('20MB');
    expect(api().uploading()).toBe(false);
  });

  it('abre o anexo navegando a aba reservada para a signed URL', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    api().openDocument(savedDocument);
    fixture.detectChanges();

    expect(documentSignedUrl).toHaveBeenCalledWith(INCIDENT_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  /** A aba reservada é a MESMA do checkout — sem cópia própria ela anuncia cobrança. */
  it('a aba reservada do anexo não fala em pagamento', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    api().openDocument(savedDocument);

    expect(openPendingTab).toHaveBeenCalledWith(INCIDENT_DOCUMENT_PLACEHOLDER_COPY);
    const [copy] = openPendingTab.mock.calls[0] as [PendingTabPlaceholderCopy];
    expect(`${copy.documentTitle} ${copy.title} ${copy.note} ${copy.stalledNote}`).not.toContain(
      'pagamento',
    );
  });

  it('fecha a aba reservada quando a signed URL falha', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    documentSignedUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    await setup();

    api().openDocument(savedDocument);
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(api().error()).toBe('Não foi possível abrir o anexo.');
  });

  it('remove o anexo e tira a linha da lista', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();
    expect(api().documents()).toHaveLength(1);

    api().askDelete(savedDocument);
    api().confirmDelete();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(INCIDENT_ID, 'doc-1');
    expect(api().documents()).toHaveLength(0);
    expect(successToast).toHaveBeenCalledWith('Anexo removido.');
  });

  it('remoção só acontece depois da confirmação', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    api().askDelete(savedDocument);
    fixture.detectChanges();

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(api().documents()).toHaveLength(1);
  });

  it('renderiza nome, tipo e tamanho a partir do DTO', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('dano-frontal.jpg');
    expect(text).toContain('Foto do dano');
    expect(text).toContain('200.0 KB');
  });
});
