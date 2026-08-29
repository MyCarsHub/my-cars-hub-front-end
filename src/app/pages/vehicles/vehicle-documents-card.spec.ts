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
import type { VehicleDocument } from '../../types/vehicle.types';

/**
 * Anexos do veículo: GRADE DE SLOTS, um por tipo esperado.
 *
 * Todo teste de interação passa PELO DOM — `click()` de verdade no slot,
 * `dispatchEvent` de `change` de verdade no `<input type="file">`. Chamar o
 * método do componente direto provaria que o método funciona, não que a tela
 * funciona, e foi exatamente assim que um defeito atravessou uma suíte verde
 * neste projeto.
 *
 * Três pontos sensíveis, todos deliberados:
 *
 * 1. NÃO existe barra de progresso — o app usa `withFetch()`, que nunca emite
 *    `UploadProgress`, então qualquer barra seria animação desconectada do
 *    envio real. O estado é indeterminado e "Cancelar envio" ABORTA de verdade.
 * 2. NÃO existe compressão — comprimir um CRLV o deixa ilegível.
 * 3. NÃO existe unicidade por tipo. O CRLV é reemitido a cada licenciamento; o
 *    do ano passado e o deste ano CONVIVEM no MESMO slot, e enviar um novo não
 *    substitui o anterior. Também não existe portão de perfil aqui: são dois
 *    tipos fixos.
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

  /** Leitura de estado só para asserção — a AÇÃO nunca passa por aqui. */
  interface CardState {
    error(): string | null;
    documents(): VehicleDocument[];
  }

  function state(): CardState {
    return fixture.componentInstance as unknown as CardState;
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Tipos com slot na tela, lidos do DOM real, na ordem em que aparecem. */
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

  /** O botão de confirmar do diálogo real, clicado de verdade. */
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

  function photo(name = 'crlv.pdf', size = 1024, type = 'application/pdf'): File {
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
  it('mostra exatamente os slots de CRLV e Outro, sem seletor de tipo', async () => {
    await setup();

    expect(slotKinds()).toEqual(['CRLV', 'OTHER']);
    expect(host().querySelector('select')).toBeNull();
    expect(host().textContent).not.toContain('Anexar documento');
  });

  it('marca como "Falta anexar" o CRLV ainda vazio e não cobra o opcional', async () => {
    await setup();

    expect(slotEl('CRLV').getAttribute('data-filled')).toBe('false');
    expect(slotText('CRLV')).toContain('Falta anexar');
    expect(slotText('OTHER')).not.toContain('Falta anexar');
  });

  it('resume quantos tipos essenciais faltam, sem contar o opcional', async () => {
    await setup();

    expect(host().querySelector('[role="status"]')?.textContent).toContain(
      '0 de 1 documentos essenciais anexados',
    );
  });

  it('anuncia conclusão quando o CRLV está anexado', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    expect(host().querySelector('[role="status"]')?.textContent).toContain(
      'O CRLV do veículo está anexado',
    );
  });

  /**
   * DEFEITO REAL, encontrado usando a tela — a suite passava porque os testes
   * disparavam o `change` logo apos o clique e nunca observavam o meio.
   *
   * Tocar no slot abre o dialogo NATIVO de arquivos, e o usuario pode dispensa-
   * lo sem escolher nada. Nesse instante nenhum envio comecou. Se o card
   * anunciar "Enviando…" ja no toque, ele mente: oferece um "Cancelar envio"
   * que nao cancela coisa alguma (nao ha subscription) e trava todos os outros
   * slots para sempre.
   */
  it('não anuncia envio só porque o slot foi tocado, sem arquivo escolhido', async () => {
    await setup();

    slotButton('CRLV').click();
    fixture.detectChanges();

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(slotText('CRLV')).not.toContain('Enviando o documento…');
    expect(host().textContent).not.toContain('Cancelar envio');
    expect(slotButton('OTHER').disabled).toBe(false);
  });

  /** Dispensar o dialogo e tocar em OUTRO slot tem de funcionar normalmente. */
  it('permite trocar de slot depois de dispensar o seletor de arquivos', async () => {
    await setup();

    slotButton('CRLV').click();
    fixture.detectChanges();
    dispatchFile(null);

    attach('OTHER', photo('nota-fiscal.pdf', 2048));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect((uploadDocument.mock.calls[0] as [string, string, File])[1]).toBe('OTHER');
  });

  // ------------------------------------------------------------------- envio

  it('o clique no slot envia com o tipo DAQUELE slot', async () => {
    await setup();

    attach('CRLV', photo('crlv-2026.pdf', 2048));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [vehicleId, kind, file] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(vehicleId).toBe(VEHICLE_ID);
    // O tipo vem do slot tocado — não de uma escolha anterior em um combo.
    expect(kind).toBe('CRLV');
    expect(file).toBeInstanceOf(File);
    expect(successToast).toHaveBeenCalledWith('Documento enviado.');
  });

  it('o slot "Outro" envia com o tipo OTHER', async () => {
    await setup();

    attach('OTHER', photo('nota-fiscal.pdf', 2048));

    expect((uploadDocument.mock.calls[0] as [string, string, File])[1]).toBe('OTHER');
  });

  /**
   * NÃO comprimir é o requisito, não um detalhe: um CRLV comprimido fica
   * ilegível e o anexo perde a razão de existir. O arquivo tem de chegar ao
   * service como o MESMO objeto que o usuário escolheu.
   */
  it('envia o arquivo original, sem comprimir', async () => {
    await setup();

    const original = photo('crlv-scan.jpg', 4 * 1024 * 1024, 'image/jpeg');
    attach('CRLV', original);

    const [, , sent] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(sent).toBe(original);
    expect(sent.size).toBe(4 * 1024 * 1024);
  });

  it('recusa formato fora da allowlist sem gastar dados móveis', async () => {
    await setup();

    attach('CRLV', photo('planilha.xlsx', 1024, 'application/vnd.ms-excel'));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(host().textContent).toContain('PDF, JPG, PNG, WebP, HEIC/HEIF');
  });

  it('recusa arquivo acima de 20MB sem chamar a API', async () => {
    await setup();

    attach('CRLV', photo('enorme.jpg', 21 * 1024 * 1024, 'image/jpeg'));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(host().textContent).toContain('20MB');
  });

  /** Alguns Android entregam `type` vazio para HEIC — o nome salva o envio. */
  it('aceita HEIC sem content-type pelo nome do arquivo', async () => {
    await setup();

    attach('CRLV', photo('IMG_0042.HEIC', 1024, ''));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  /**
   * Estado indeterminado, nunca barra falsa — e DENTRO do slot que o usuário
   * tocou, não num aviso solto no topo do card.
   */
  it('mostra o estado indeterminado dentro do slot, sem barra de progresso', async () => {
    const pending = new Subject<VehicleDocument>();
    uploadDocument.mockReturnValue(pending.asObservable());
    await setup();

    attach('CRLV', photo());

    expect(slotText('CRLV')).toContain('Enviando o documento…');
    expect(slotText('OTHER')).not.toContain('Enviando o documento…');
    expect(host().querySelector('progress')).toBeNull();
    expect(host().querySelector('[role="progressbar"]')).toBeNull();
    expect(slotEl('CRLV').querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  /**
   * O cancelamento tem que DESFAZER A ASSINATURA, não só esconder o aviso: é o
   * `unsubscribe` que dispara o `AbortController` do FetchBackend e mata o
   * request no browser.
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
    attach('CRLV', photo());
    expect(aborted).toBe(false);

    const cancelar = Array.from(slotEl('CRLV').querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Cancelar envio'),
    );
    expect(cancelar).toBeDefined();
    cancelar?.click();
    fixture.detectChanges();

    expect(aborted).toBe(true);
    expect(slotText('CRLV')).not.toContain('Enviando o documento…');
    expect(state().documents()).toHaveLength(0);
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
    attach('CRLV', photo());
    expect(aborted).toBe(false);

    fixture.destroy();

    expect(aborted).toBe(true);
  });

  it('traduz o 413 do upload para o teto do cliente', async () => {
    uploadDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, statusText: 'Payload Too Large' })),
    );
    await setup();

    attach('CRLV', photo());

    expect(host().textContent).toContain('20MB');
    expect(slotText('CRLV')).not.toContain('Enviando o documento…');
  });

  /**
   * O backend recusa o 21º anexo com a mensagem em `fieldErrors.file`. Ela é
   * regra de negócio: aparece INLINE dentro do card, onde o usuário está
   * olhando, e nunca como toast. O texto diz que o teto é TÉCNICO — não é
   * restrição de plano e não pode virar uma venda.
   */
  it('renderiza o erro de negócio de fieldErrors.file inline, sem toast', async () => {
    const limite =
      'Limite técnico de 20 anexos por veículo atingido. Remova um documento antes de enviar outro.';
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

    attach('CRLV', photo());

    expect(state().error()).toBe(limite);
    expect(host().textContent).toContain('Limite técnico de 20 anexos por veículo atingido.');
    expect(errorToast).not.toHaveBeenCalled();
  });

  // -------------------------------------------------- N arquivos por tipo

  /**
   * ESTE é o requisito que o grid da vistoria não atende. O CRLV é reemitido a
   * cada licenciamento (COMMENT da V68): o do ano passado e o deste ano
   * CONVIVEM no mesmo slot, e o novo NÃO substitui o anterior.
   */
  it('acumula dois CRLV no mesmo slot, sem um esconder o outro', async () => {
    listDocuments.mockReturnValue(of([crlvAnterior]));
    await setup();
    expect(slotFileRows('CRLV')).toHaveLength(1);

    uploadDocument.mockReturnValue(of(savedDocument));
    attach('CRLV', photo('crlv-2025.pdf'));

    const linhas = slotFileRows('CRLV');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain('crlv-2024.pdf');
    expect(linhas[1].textContent).toContain('crlv-2025.pdf');
    expect(slotText('CRLV')).toContain('2 arquivos');
  });

  it('conta 1 arquivo no singular', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    expect(slotText('CRLV')).toContain('1 arquivo');
    expect(slotText('CRLV')).not.toContain('1 arquivos');
    expect(slotEl('CRLV').getAttribute('data-filled')).toBe('true');
  });

  it('agrupa cada arquivo sob o slot do seu próprio tipo', async () => {
    listDocuments.mockReturnValue(
      of([savedDocument, { ...savedDocument, id: 'd-o', kind: 'OTHER' as const }]),
    );
    await setup();

    expect(slotFileRows('CRLV')).toHaveLength(1);
    expect(slotFileRows('OTHER')).toHaveLength(1);
  });

  it('renderiza nome, tipo e tamanho a partir do DTO', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    const text = slotText('CRLV');
    expect(text).toContain('crlv-2025.pdf');
    // Rótulo e tamanho saem na MESMA linha de metadados, vindos do DTO.
    expect(text).toContain('CRLV · 200.0 KB');
  });

  // ------------------------------------------------------------------ abrir

  it('abre o documento navegando a aba reservada para a signed URL', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('CRLV')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir documento crlv-2025.pdf"]')
      ?.click();
    fixture.detectChanges();

    expect(documentSignedUrl).toHaveBeenCalledWith(VEHICLE_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  /** A aba reservada é a MESMA do checkout — sem cópia própria ela anuncia cobrança. */
  it('a aba reservada do documento não fala em pagamento', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('CRLV')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir documento crlv-2025.pdf"]')
      ?.click();

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

    slotFileRows('CRLV')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir documento crlv-2025.pdf"]')
      ?.click();
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(host().textContent).toContain('Não foi possível abrir o documento.');
  });

  // ----------------------------------------------------------------- remover

  it('remove só o CRLV escolhido e deixa o do outro ano', async () => {
    listDocuments.mockReturnValue(of([crlvAnterior, savedDocument]));
    await setup();
    expect(slotFileRows('CRLV')).toHaveLength(2);

    slotFileRows('CRLV')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover documento crlv-2024.pdf"]')
      ?.click();
    fixture.detectChanges();
    // A confirmação é um passo real: quem apaga é o botão do diálogo.
    confirmDialogButton('Remover').click();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(VEHICLE_ID, 'doc-0');
    const restantes = slotFileRows('CRLV');
    expect(restantes).toHaveLength(1);
    expect(restantes[0].textContent).toContain('crlv-2025.pdf');
    expect(slotText('CRLV')).toContain('1 arquivo');
    expect(successToast).toHaveBeenCalledWith('Documento removido.');
  });

  it('remoção só acontece depois da confirmação', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('CRLV')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover documento crlv-2025.pdf"]')
      ?.click();
    fixture.detectChanges();

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(slotFileRows('CRLV')).toHaveLength(1);
  });

  it('o slot volta a "Falta anexar" quando o último arquivo sai', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('CRLV')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover documento crlv-2025.pdf"]')
      ?.click();
    fixture.detectChanges();
    confirmDialogButton('Remover').click();
    fixture.detectChanges();

    expect(slotFileRows('CRLV')).toHaveLength(0);
    expect(slotEl('CRLV').getAttribute('data-filled')).toBe('false');
    expect(slotText('CRLV')).toContain('Falta anexar');
  });

  // --------------------------------------------------------- carga da lista

  /**
   * A garantia que importa é que `documents()` seja SEMPRE um array: `slots()`
   * faz `.filter` sobre ele. Um corpo de erro que não seja lista passaria por
   * um `?? []` e estouraria — a forma exata do `TypeError` que já derrubou uma
   * view aqui.
   */
  it('não estoura quando a listagem devolve um corpo que não é array', async () => {
    listDocuments.mockReturnValue(
      of({ fieldErrors: { file: 'nada disso é uma lista' } } as unknown as VehicleDocument[]),
    );

    await setup();

    expect(slotKinds()).toEqual(['CRLV', 'OTHER']);
    expect(slotFileRows('CRLV')).toHaveLength(0);
    expect(state().documents()).toEqual([]);
  });

  /**
   * O `main` do backend está congelado antes da V68: contra a API em produção
   * hoje a rota devolve 404. Vira banner inline e a tela do veículo continua
   * utilizável, nunca branca.
   */
  it('zera a lista e avisa inline quando a carga falha', async () => {
    listDocuments.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
    );

    await setup();

    expect(state().documents()).toEqual([]);
    expect(host().textContent).toContain('Não foi possível carregar os documentos.');
    expect(slotKinds()).toEqual(['CRLV', 'OTHER']);
  });

  /**
   * O caminho de ERRO zera a lista, nao so mostra o banner. Sem isso um erro
   * que chega DEPOIS de a lista ja ter conteudo deixaria na tela arquivos que
   * a carga corrente nao confirmou — o usuario leria dado velho como atual.
   * Aqui o fluxo emite e so entao falha, que e a unica forma de observar a
   * guarda pela superficie publica do card.
   */
  it('limpa a lista quando a carga falha depois de ja ter emitido', async () => {
    listDocuments.mockReturnValue(
      new Observable<VehicleDocument[]>((subscriber) => {
        subscriber.next([savedDocument]);
        subscriber.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
      }),
    );

    await setup();

    expect(state().documents()).toEqual([]);
    expect(slotFileRows('CRLV')).toHaveLength(0);
    expect(host().textContent).toContain('Não foi possível carregar os documentos.');
  });
});
