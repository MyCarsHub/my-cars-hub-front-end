import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VEHICLE_DOCUMENT_PLACEHOLDER_COPY, VehicleDocumentsCard } from './vehicle-documents-card';
import { ApiErrorService } from '../../services/api-error.service';
import { flatErrorMessage, parseApiError } from '../../services/api-error';
import { VehiclesService } from '../../services/vehicles.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import type { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import type { VehicleDocument, VehicleDocumentKind } from '../../types/vehicle.types';

/**
 * Anexos do veículo: enviar, listar, abrir por URL assinada e remover.
 *
 * Três pontos sensíveis, todos deliberados:
 *
 * 1. NÃO existe barra de progresso — o app usa `withFetch()`, que nunca emite
 *    `UploadProgress`, então qualquer barra seria animação desconectada do
 *    envio real. O estado é indeterminado e "Cancelar envio" ABORTA de verdade.
 * 2. NÃO existe compressão — comprimir um CRLV o deixa ilegível.
 * 3. NÃO existe unicidade por tipo. O CRLV é reemitido a cada licenciamento;
 *    o do ano passado e o deste ano CONVIVEM, e enviar um novo não substitui
 *    o anterior. Também não existe portão de perfil aqui: são dois tipos fixos.
 */
describe('VehicleDocumentsCard', () => {
  const VEHICLE_ID = 'veh-1';

  const savedDocument: VehicleDocument = {
    id: 'doc-1',
    vehicleId: VEHICLE_ID,
    kind: 'CRLV',
    kindLabel: 'CRLV',
    fileName: 'crlv-2025.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 204_800,
    uploadedBy: 'user-1',
    createdDate: '2026-03-02T12:00:00',
  };

  const crlvAnterior: VehicleDocument = {
    ...savedDocument,
    id: 'doc-0',
    fileName: 'crlv-2024.pdf',
    createdDate: '2025-03-02T12:00:00',
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
  let fixture: ComponentFixture<VehicleDocumentsCard>;

  interface CardInternals {
    error(): string | null;
    uploading(): boolean;
    documents(): VehicleDocument[];
    selectedKind: { set(k: VehicleDocumentKind): void };
    onFileSelected(event: Event): void;
    openDocument(doc: VehicleDocument): void;
    askDelete(doc: VehicleDocument): void;
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
    return Array.from(host().querySelectorAll('#vehicle-doc-kind option')).map(
      (option) => (option as HTMLOptionElement).value,
    );
  }

  /**
   * Alcança a linha pelo BOTÃO e sobe com `closest`. Buscar a linha por um
   * seletor de binding do Angular não funcionaria: property binding não vira
   * atributo no DOM, então o seletor casaria com nada.
   */
  function rowFor(fileName: string): HTMLElement | null {
    const button = host().querySelector(`[aria-label="Remover documento ${fileName}"]`);
    return button?.closest('li') ?? null;
  }

  /** `change` de um `<input type="file">` sem depender de DataTransfer. */
  function fileEvent(file: File | null): Event {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    return { target: input } as unknown as Event;
  }

  function photo(name = 'crlv.jpg', size = 1024, type = 'image/jpeg'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
  }

  async function setup(): Promise<void> {
    fixture = TestBed.createComponent(VehicleDocumentsCard);
    fixture.componentRef.setInput('vehicleId', VEHICLE_ID);
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
          provide: VehiclesService,
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

  // -------------------------------------------------------------------- tipos

  /** São só DOIS tipos, e não há portão de perfil que esconda qualquer um. */
  it('oferece exatamente CRLV e Outro no seletor de tipo', async () => {
    await setup();

    expect(kindValues()).toEqual(['CRLV', 'OTHER']);
  });

  // ------------------------------------------------------------------- envio

  it('envia o arquivo com o tipo escolhido e publica o documento salvo', async () => {
    await setup();

    api().selectedKind.set('OTHER');
    api().onFileSelected(fileEvent(photo('nota-fiscal.pdf', 2048, 'application/pdf')));
    fixture.detectChanges();

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [vehicleId, kind, file] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(vehicleId).toBe(VEHICLE_ID);
    // O backend exige `kind` junto do arquivo — não é um passo posterior.
    expect(kind).toBe('OTHER');
    expect(file).toBeInstanceOf(File);

    expect(api().documents()).toEqual([savedDocument]);
    expect(api().uploading()).toBe(false);
    expect(successToast).toHaveBeenCalledWith('Documento enviado.');
  });

  /**
   * O ponto que separa este card do de motorista não é o número de tipos, é a
   * AUSÊNCIA de unicidade: o CRLV é reemitido a cada licenciamento e a V68
   * aceita N linhas do mesmo kind. Um CRLV novo ACRESCENTA; substituir o
   * anterior apagaria o comprovante do ano passado da tela.
   */
  it('acrescenta um novo CRLV sem substituir o CRLV já existente', async () => {
    listDocuments.mockReturnValue(of([crlvAnterior]));
    uploadDocument.mockReturnValue(of(savedDocument));
    await setup();

    api().selectedKind.set('CRLV');
    api().onFileSelected(fileEvent(photo('crlv-2025.pdf', 2048, 'application/pdf')));
    fixture.detectChanges();

    expect(api().documents()).toHaveLength(2);
    expect(api().documents().map((d) => d.fileName)).toEqual(['crlv-2024.pdf', 'crlv-2025.pdf']);
    // Os dois anos convivem na tela, cada um na sua linha.
    expect(rowFor('crlv-2024.pdf')).not.toBeNull();
    expect(rowFor('crlv-2025.pdf')).not.toBeNull();
  });

  /**
   * NÃO comprimir é o requisito, não um detalhe: um CRLV comprimido fica
   * ilegível e o anexo perde a razão de existir. O arquivo tem de chegar ao
   * service como o MESMO objeto que o usuário escolheu.
   */
  it('envia o arquivo original, sem comprimir', async () => {
    await setup();

    const original = photo('crlv-foto.jpg', 4 * 1024 * 1024);
    api().onFileSelected(fileEvent(original));
    fixture.detectChanges();

    const [, , sent] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(sent).toBe(original);
    expect(sent.size).toBe(4 * 1024 * 1024);
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
    const pending = new Subject<VehicleDocument>();
    uploadDocument.mockReturnValue(pending.asObservable());
    await setup();

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
      new Observable<VehicleDocument>(() => {
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

  /** `ngOnDestroy` também aborta: sair da tela não pode deixar request órfão. */
  it('aborta o envio em voo quando o card é destruído', async () => {
    let aborted = false;
    uploadDocument.mockReturnValue(
      new Observable<VehicleDocument>(() => () => {
        aborted = true;
      }),
    );

    await setup();
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
    await setup();

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().error()).toContain('20MB');
    expect(api().uploading()).toBe(false);
  });

  /**
   * O backend recusa o 21º anexo com a mensagem em `fieldErrors.file`, e essa
   * mensagem diz explicitamente que o teto é TÉCNICO e não restrição de plano.
   * Ela é regra de negócio: aparece INLINE dentro do card, onde o usuário está
   * olhando, e nunca como toast — inclusive porque um toast some antes de o
   * usuário ler a segunda frase.
   */
  it('renderiza o erro de negócio de fieldErrors.file inline, sem toast', async () => {
    const limite =
      'Limite de 20 anexos por veículo atingido. ' +
      'É um teto técnico de armazenamento, não uma restrição do seu plano.';
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
    await setup();

    api().onFileSelected(fileEvent(photo()));
    fixture.detectChanges();

    expect(api().error()).toBe(limite);
    expect(host().textContent).toContain('não uma restrição do seu plano');
    expect(errorToast).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ abrir

  it('abre o documento navegando a aba reservada para a signed URL', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    api().openDocument(savedDocument);
    fixture.detectChanges();

    expect(documentSignedUrl).toHaveBeenCalledWith(VEHICLE_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  /** A aba reservada é a MESMA do checkout — sem cópia própria ela anuncia cobrança. */
  it('a aba reservada do documento não fala em pagamento', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    api().openDocument(savedDocument);

    expect(openPendingTab).toHaveBeenCalledWith(VEHICLE_DOCUMENT_PLACEHOLDER_COPY);
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
    expect(api().error()).toBe('Não foi possível abrir o documento.');
  });

  // ----------------------------------------------------------------- remover

  it('remove o documento e tira a linha da lista', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();
    expect(api().documents()).toHaveLength(1);

    api().askDelete(savedDocument);
    api().confirmDelete();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(VEHICLE_ID, 'doc-1');
    expect(api().documents()).toHaveLength(0);
    expect(rowFor('crlv-2025.pdf')).toBeNull();
    expect(successToast).toHaveBeenCalledWith('Documento removido.');
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

    const row = rowFor('crlv-2025.pdf');
    expect(row).not.toBeNull();
    const text = row?.textContent ?? '';
    expect(text).toContain('crlv-2025.pdf');
    // Rótulo e tamanho saem na MESMA linha de metadados, vindos do DTO.
    expect(text).toContain('CRLV · 200.0 KB');
  });

  // ------------------------------------------------- degradação antes da V68

  /**
   * ESTE é o caso que roda em produção primeiro. O `main` do backend está
   * congelado ANTES da V68, então contra a API viva hoje a rota
   * `/v1/vehicles/{id}/documents` NÃO EXISTE e a listagem volta 404.
   *
   * O card tem de degradar para um erro INLINE e continuar renderizando —
   * nunca uma tela branca, que é o que a view do veículo inteira viraria se o
   * card estourasse.
   */
  it('degrada para erro inline quando a rota ainda não existe (404), sem tela branca', async () => {
    listDocuments.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
    );
    await setup();

    expect(api().error()).toBe('Não foi possível carregar os documentos.');
    expect(api().documents()).toEqual([]);
    // O card continua de pé: título e seletor de tipo seguem no DOM.
    expect(host().textContent).toContain('Documentos anexados');
    expect(kindValues()).toEqual(['CRLV', 'OTHER']);
  });

  /**
   * Um corpo que não é lista não pode chegar ao `@for`. `documents()` é sempre
   * um array porque a leitura é rasa e verificada com `Array.isArray` — nada de
   * encadear propriedade de objeto possivelmente nulo, que é a forma exata do
   * `TypeError` que já derrubou uma view neste repo.
   */
  it('não estoura quando a listagem devolve um corpo que não é lista', async () => {
    listDocuments.mockReturnValue(of({ message: 'Not Found' } as unknown as VehicleDocument[]));
    await setup();

    expect(api().documents()).toEqual([]);
    expect(host().textContent).toContain('Nenhum documento ainda');
    expect(errorToast).not.toHaveBeenCalled();
  });
});
