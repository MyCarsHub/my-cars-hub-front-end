import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DRIVER_DOCUMENT_PLACEHOLDER_COPY, DriverDocumentsCard } from './driver-documents-card';
import { ApiErrorService } from '../../services/api-error.service';
import { flatErrorMessage, parseApiError } from '../../services/api-error';
import { DriverService } from '../../services/driver.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import type { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import type {
  DriverDocument,
  DriverDocumentKind,
  DriverResponse,
} from '../../types/driver.types';

/**
 * Documentos do motorista: enviar, listar, abrir por URL assinada e remover.
 *
 * Três pontos sensíveis, todos deliberados:
 *
 * 1. NÃO existe barra de progresso — o app usa `withFetch()`, que nunca emite
 *    `UploadProgress`, então qualquer barra seria animação desconectada do
 *    envio real. O estado é indeterminado e "Cancelar envio" ABORTA de verdade.
 * 2. NÃO existe compressão — comprimir uma CNH a deixa ilegível.
 * 3. O slot `APP_RIDE_RECEIPT` falha FECHADO. Contra a API hoje em produção o
 *    campo `isAppDriver` nem chega no JSON (o `main` do backend está congelado
 *    antes da V69), e `undefined` tem de esconder o slot sem estourar a view.
 */
describe('DriverDocumentsCard', () => {
  const DRIVER_ID = 'drv-1';

  const savedDocument: DriverDocument = {
    id: 'doc-1',
    driverId: DRIVER_ID,
    kind: 'CNH',
    kindLabel: 'CNH',
    fileName: 'cnh-frente.jpg',
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
  let errorToast: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<DriverDocumentsCard>;

  interface CardInternals {
    error(): string | null;
    uploading(): boolean;
    documents(): DriverDocument[];
    selectedKind: { set(k: DriverDocumentKind): void };
    onFileSelected(event: Event): void;
    openDocument(doc: DriverDocument): void;
    askDelete(doc: DriverDocument): void;
    confirmDelete(): void;
    cancelUpload(): void;
  }

  function api(): CardInternals {
    return fixture.componentInstance as unknown as CardInternals;
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Valores oferecidos no seletor de tipo, lidos do DOM real. */
  function kindValues(): string[] {
    return Array.from(host().querySelectorAll('#driver-doc-kind option')).map(
      (option) => (option as HTMLOptionElement).value,
    );
  }

  /** `change` de um `<input type="file">` sem depender de DataTransfer. */
  function fileEvent(file: File | null): Event {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    return { target: input } as unknown as Event;
  }

  function photo(name = 'cnh.jpg', size = 1024, type = 'image/jpeg'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
  }

  /**
   * `isAppDriver` é passado como `unknown` de propósito: o teste do campo
   * AUSENTE precisa entregar `undefined` sem que o TypeScript o proíba, que é
   * exatamente o que o backend em produção entrega hoje.
   */
  const BINDING_AUSENTE = Symbol('binding não passado');

  async function setup(isAppDriver: unknown = BINDING_AUSENTE): Promise<void> {
    fixture = TestBed.createComponent(DriverDocumentsCard);
    fixture.componentRef.setInput('driverId', DRIVER_ID);
    if (isAppDriver !== BINDING_AUSENTE) {
      fixture.componentRef.setInput('isAppDriver', isAppDriver);
    }
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
    errorToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: DriverService,
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

  // ------------------------------------------------------------------- envio

  it('envia o arquivo com o tipo escolhido e publica o documento salvo', async () => {
    await setup(true);

    api().selectedKind.set('ADDRESS_PROOF');
    api().onFileSelected(fileEvent(photo('conta-luz.pdf', 2048, 'application/pdf')));
    fixture.detectChanges();

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [driverId, kind, file] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(driverId).toBe(DRIVER_ID);
    // O backend exige `kind` junto do arquivo — não é um passo posterior.
    expect(kind).toBe('ADDRESS_PROOF');
    expect(file).toBeInstanceOf(File);

    expect(api().documents()).toEqual([savedDocument]);
    expect(api().uploading()).toBe(false);
    expect(successToast).toHaveBeenCalledWith('Documento enviado.');
  });

  /**
   * NÃO comprimir é o requisito, não um detalhe: uma CNH comprimida fica
   * ilegível e o anexo perde a razão de existir. O arquivo tem de chegar ao
   * service como o MESMO objeto que o usuário escolheu.
   */
  it('envia o arquivo original, sem comprimir', async () => {
    await setup(false);

    const original = photo('cnh-verso.jpg', 4 * 1024 * 1024);
    api().onFileSelected(fileEvent(original));
    fixture.detectChanges();

    const [, , sent] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(sent).toBe(original);
    expect(sent.size).toBe(4 * 1024 * 1024);
  });

  it('recusa formato fora da allowlist sem gastar dados móveis', async () => {
    await setup(false);

    api().onFileSelected(fileEvent(photo('planilha.xlsx', 1024, 'application/vnd.ms-excel')));
    fixture.detectChanges();

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('PDF, JPG, PNG, WebP, HEIC/HEIF');
  });

  it('recusa arquivo acima de 20MB sem chamar a API', async () => {
    await setup(false);

    api().onFileSelected(fileEvent(photo('enorme.jpg', 21 * 1024 * 1024)));
    fixture.detectChanges();

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('20MB');
  });

  /** Alguns Android entregam `type` vazio para HEIC — o nome salva o envio. */
  it('aceita HEIC sem content-type pelo nome do arquivo', async () => {
    await setup(false);

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
    const pending = new Subject<DriverDocument>();
    uploadDocument.mockReturnValue(pending.asObservable());
    await setup(false);

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().uploading()).toBe(true);
    expect(host().textContent).toContain('Enviando o documento…');
    expect(host().querySelector('progress')).toBeNull();
    expect(host().querySelector('[role="progressbar"]')).toBeNull();
    expect(host().querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
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
      new Observable<DriverDocument>(() => {
        // Teardown do Observable: só roda em unsubscribe.
        return () => {
          aborted = true;
        };
      }),
    );

    await setup(false);
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

  /** `ngOnDestroy` também aborta: sair da tela não pode deixar request órfão. */
  it('aborta o envio em voo quando o card é destruído', async () => {
    let aborted = false;
    uploadDocument.mockReturnValue(
      new Observable<DriverDocument>(() => () => {
        aborted = true;
      }),
    );

    await setup(false);
    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();
    expect(aborted).toBe(false);

    fixture.destroy();

    expect(aborted).toBe(true);
  });

  it('traduz o 413 do upload para o teto do cliente', async () => {
    uploadDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, statusText: 'Payload Too Large' })),
    );
    await setup(false);

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().error()).toContain('20MB');
    expect(api().uploading()).toBe(false);
  });

  /**
   * O backend recusa o 21º anexo com a mensagem em `fieldErrors.file`. Ela é
   * regra de negócio: aparece INLINE dentro do card, onde o usuário está
   * olhando, e nunca como toast.
   */
  it('renderiza o erro de negócio de fieldErrors.file inline, sem toast', async () => {
    const limite =
      'Limite de 20 anexos por motorista atingido. Remova um documento antes de enviar outro.';
    uploadDocument.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            statusText: 'Bad Request',
            error: { fieldErrors: { file: limite } },
          }),
      ),
    );
    await setup(false);

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().error()).toBe(limite);
    expect(host().textContent).toContain('Limite de 20 anexos por motorista atingido.');
    expect(errorToast).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ abrir

  it('abre o documento navegando a aba reservada para a signed URL', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup(false);

    api().openDocument(savedDocument);
    fixture.detectChanges();

    expect(documentSignedUrl).toHaveBeenCalledWith(DRIVER_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  /** A aba reservada é a MESMA do checkout — sem cópia própria ela anuncia cobrança. */
  it('a aba reservada do documento não fala em pagamento', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup(false);

    api().openDocument(savedDocument);

    expect(openPendingTab).toHaveBeenCalledWith(DRIVER_DOCUMENT_PLACEHOLDER_COPY);
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
    await setup(false);

    api().openDocument(savedDocument);
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(api().error()).toBe('Não foi possível abrir o documento.');
  });

  // ----------------------------------------------------------------- remover

  it('remove o documento e tira a linha da lista', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup(false);
    expect(api().documents()).toHaveLength(1);

    api().askDelete(savedDocument);
    api().confirmDelete();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(DRIVER_ID, 'doc-1');
    expect(api().documents()).toHaveLength(0);
    expect(successToast).toHaveBeenCalledWith('Documento removido.');
  });

  it('remoção só acontece depois da confirmação', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup(false);

    api().askDelete(savedDocument);
    fixture.detectChanges();

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(api().documents()).toHaveLength(1);
  });

  it('renderiza nome, tipo e tamanho a partir do DTO', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup(false);

    const text = host().textContent ?? '';
    expect(text).toContain('cnh-frente.jpg');
    // Rótulo e tamanho saem na MESMA linha de metadados, vindos do DTO.
    expect(text).toContain('CNH · 200.0 KB');
  });

  // ------------------------------------------- portão do extrato de aplicativo

  it('oferece o slot APP_RIDE_RECEIPT quando isAppDriver é true', async () => {
    await setup(true);

    expect(kindValues()).toContain('APP_RIDE_RECEIPT');
    // O portão abre um slot, não troca a lista: os tipos comuns continuam lá.
    expect(kindValues()).toContain('CNH');
    expect(kindValues()).toContain('ADDRESS_PROOF');
  });

  it('esconde o slot APP_RIDE_RECEIPT quando isAppDriver é false', async () => {
    await setup(false);

    expect(kindValues()).not.toContain('APP_RIDE_RECEIPT');
    expect(kindValues()).toContain('CNH');
  });

  /**
   * ESTE é o caso que roda em produção primeiro. O `main` do backend está
   * congelado antes da V69, então `DriverResponse` chega SEM a chave
   * `isAppDriver` e ler o campo devolve `undefined`, não `false`.
   *
   * O portão tem de falhar FECHADO — slot escondido — e a view não pode
   * estourar. Um portão por truthiness de leitura aninhada opcional foi
   * exatamente o que derrubou uma view neste repo antes.
   */
  it('esconde o slot e não estoura quando o campo isAppDriver está AUSENTE do JSON', async () => {
    // JSON como a API em produção devolve hoje: sem a chave.
    const driverSemCampo = {
      id: DRIVER_ID,
      name: 'João da Silva',
    } as unknown as DriverResponse;
    expect(driverSemCampo.isAppDriver).toBeUndefined();

    await setup(driverSemCampo.isAppDriver);

    expect(kindValues()).not.toContain('APP_RIDE_RECEIPT');
    expect(kindValues()).toContain('CNH');
    // Ausência de campo é degradação silenciosa, não erro para o usuário.
    expect(api().error()).toBeNull();
    expect(errorToast).not.toHaveBeenCalled();
  });

  /** Esquecer o binding também tem de falhar fechado. */
  it('esconde o slot quando o binding isAppDriver nem é passado', async () => {
    await setup();

    expect(kindValues()).not.toContain('APP_RIDE_RECEIPT');
    expect(kindValues()).toContain('CNH');
    expect(api().error()).toBeNull();
  });
});
