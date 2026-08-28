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
import type { DriverDocument, DriverResponse } from '../../types/driver.types';

/**
 * Documentos do motorista: GRADE DE SLOTS, um por tipo esperado.
 *
 * Todo teste de interação passa PELO DOM — `click()` de verdade no slot,
 * `dispatchEvent` de `change` de verdade no `<input type="file">`. Chamar o
 * método do componente direto provaria que o método funciona, não que a tela
 * funciona, e foi exatamente assim que um defeito atravessou uma suíte verde
 * neste projeto.
 *
 * Quatro pontos sensíveis, todos deliberados:
 *
 * 1. NÃO existe barra de progresso — o app usa `withFetch()`, que nunca emite
 *    `UploadProgress`, então qualquer barra seria animação desconectada do
 *    envio real. O estado é indeterminado e "Cancelar envio" ABORTA de verdade.
 * 2. NÃO existe compressão — comprimir uma CNH a deixa ilegível.
 * 3. Um tipo guarda N arquivos. Frente e verso da CNH são duas linhas `CNH`, e
 *    a segunda NÃO substitui a primeira.
 * 4. O slot `APP_RIDE_RECEIPT` falha FECHADO, na exibição E no envio. Contra a
 *    API hoje em produção o campo `isAppDriver` nem chega no JSON (o `main` do
 *    backend está congelado antes da V69), e `undefined` tem de esconder o slot
 *    sem estourar a view.
 */
describe('DriverDocumentsCard', () => {
  const DRIVER_ID = 'drv-1';

  const cnhFrente: DriverDocument = {
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

  const cnhVerso: DriverDocument = {
    ...cnhFrente,
    id: 'doc-2',
    fileName: 'cnh-verso.jpg',
    sizeBytes: 194_560,
  };

  const extratoApp: DriverDocument = {
    ...cnhFrente,
    id: 'doc-9',
    kind: 'APP_RIDE_RECEIPT',
    kindLabel: 'Recibo de app',
    fileName: 'extrato-marco.pdf',
    mimeType: 'application/pdf',
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

  /** Leitura de estado só para asserção — a AÇÃO nunca passa por aqui. */
  interface CardState {
    error(): string | null;
    documents(): DriverDocument[];
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

  /** O botao de confirmar do dialogo real, clicado de verdade. */
  function confirmDialogButton(label: string): HTMLButtonElement {
    const dialog = host().querySelector('app-confirm-dialog');
    if (!dialog) throw new Error('o dialogo de confirmacao nao esta na tela');
    const btn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    if (!btn) throw new Error(`o dialogo nao tem o botao "${label}"`);
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
    uploadDocument = vi.fn(() => of(cnhFrente));
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

  // ------------------------------------------------------------ a grade

  /**
   * O ganho estrutural: sem tocar em nada, a tela já diz o que falta. Não
   * existe `<select>` e não existe botão "Anexar documento" solto — a lista de
   * tipos ESTÁ na tela, cada um com o próprio estado.
   */
  it('mostra um slot por tipo esperado, sem seletor e sem botão de anexar solto', async () => {
    await setup(true);

    expect(slotKinds()).toEqual([
      'CNH',
      'ADDRESS_PROOF',
      'INCOME_PROOF',
      'APP_RIDE_RECEIPT',
      'OTHER',
    ]);
    expect(host().querySelector('select')).toBeNull();
    expect(host().textContent).not.toContain('Anexar documento');
  });

  it('marca como "Falta anexar" o slot essencial ainda vazio', async () => {
    await setup(false);

    expect(slotEl('CNH').getAttribute('data-filled')).toBe('false');
    expect(slotText('CNH')).toContain('Falta anexar');
    // `OTHER` é opcional: nunca é cobrado do usuário.
    expect(slotText('OTHER')).not.toContain('Falta anexar');
  });

  it('resume quantos tipos essenciais faltam, sem contar o opcional', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    // 3 essenciais visíveis sem o portão (CNH, residência, renda); 1 preenchido.
    expect(host().querySelector('[role="status"]')?.textContent).toContain(
      '1 de 3 documentos essenciais anexados',
    );
  });

  it('anuncia conclusão quando todos os essenciais têm arquivo', async () => {
    listDocuments.mockReturnValue(
      of([
        cnhFrente,
        { ...cnhFrente, id: 'd-a', kind: 'ADDRESS_PROOF' as const },
        { ...cnhFrente, id: 'd-b', kind: 'INCOME_PROOF' as const },
      ]),
    );
    await setup(false);

    expect(host().querySelector('[role="status"]')?.textContent).toContain(
      'Todos os documentos essenciais foram anexados',
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
    await setup(true);

    slotButton('CNH').click();
    fixture.detectChanges();

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(slotText('CNH')).not.toContain('Enviando o documento…');
    expect(host().textContent).not.toContain('Cancelar envio');
    // E os outros slots continuam utilizaveis.
    expect(slotButton('ADDRESS_PROOF').disabled).toBe(false);
  });

  /** Dispensar o dialogo e tocar em OUTRO slot tem de funcionar normalmente. */
  it('permite trocar de slot depois de dispensar o seletor de arquivos', async () => {
    await setup(true);

    slotButton('CNH').click();
    fixture.detectChanges();
    // Dialogo dispensado: `change` chega sem arquivo nenhum.
    dispatchFile(null);

    attach('INCOME_PROOF', photo('holerite.pdf', 2048, 'application/pdf'));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect((uploadDocument.mock.calls[0] as [string, string, File])[1]).toBe('INCOME_PROOF');
  });

  // ------------------------------------------------------------------- envio

  it('o clique no slot envia com o tipo DAQUELE slot', async () => {
    await setup(true);

    attach('ADDRESS_PROOF', photo('conta-luz.pdf', 2048, 'application/pdf'));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [driverId, kind, file] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(driverId).toBe(DRIVER_ID);
    // O tipo vem do slot tocado — não de uma escolha anterior em um combo.
    expect(kind).toBe('ADDRESS_PROOF');
    expect(file).toBeInstanceOf(File);
    expect(successToast).toHaveBeenCalledWith('Documento enviado.');
  });

  it('slots diferentes enviam tipos diferentes', async () => {
    await setup(true);

    attach('INCOME_PROOF', photo('holerite.pdf', 2048, 'application/pdf'));
    expect((uploadDocument.mock.calls[0] as [string, string, File])[1]).toBe('INCOME_PROOF');

    attach('OTHER', photo('outro.pdf', 2048, 'application/pdf'));
    expect((uploadDocument.mock.calls[1] as [string, string, File])[1]).toBe('OTHER');
  });

  /**
   * NÃO comprimir é o requisito, não um detalhe: uma CNH comprimida fica
   * ilegível e o anexo perde a razão de existir. O arquivo tem de chegar ao
   * service como o MESMO objeto que o usuário escolheu.
   */
  it('envia o arquivo original, sem comprimir', async () => {
    await setup(false);

    const original = photo('cnh-verso.jpg', 4 * 1024 * 1024);
    attach('CNH', original);

    const [, , sent] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(sent).toBe(original);
    expect(sent.size).toBe(4 * 1024 * 1024);
  });

  it('recusa formato fora da allowlist sem gastar dados móveis', async () => {
    await setup(false);

    attach('CNH', photo('planilha.xlsx', 1024, 'application/vnd.ms-excel'));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(host().textContent).toContain('PDF, JPG, PNG, WebP, HEIC/HEIF');
  });

  it('recusa arquivo acima de 20MB sem chamar a API', async () => {
    await setup(false);

    attach('CNH', photo('enorme.jpg', 21 * 1024 * 1024));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(host().textContent).toContain('20MB');
  });

  /** Alguns Android entregam `type` vazio para HEIC — o nome salva o envio. */
  it('aceita HEIC sem content-type pelo nome do arquivo', async () => {
    await setup(false);

    attach('CNH', photo('IMG_0042.HEIC', 1024, ''));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  /**
   * Estado indeterminado, nunca barra falsa — e DENTRO do slot que o usuário
   * tocou, não num aviso solto no topo do card.
   */
  it('mostra o estado indeterminado dentro do slot, sem barra de progresso', async () => {
    const pending = new Subject<DriverDocument>();
    uploadDocument.mockReturnValue(pending.asObservable());
    await setup(false);

    attach('INCOME_PROOF', photo());

    expect(slotText('INCOME_PROOF')).toContain('Enviando o documento…');
    // O aviso está no slot tocado, não em outro.
    expect(slotText('CNH')).not.toContain('Enviando o documento…');
    expect(host().querySelector('progress')).toBeNull();
    expect(host().querySelector('[role="progressbar"]')).toBeNull();
    expect(slotEl('INCOME_PROOF').querySelector('[aria-live="polite"]')).not.toBeNull();
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
    attach('CNH', photo());
    expect(aborted).toBe(false);

    // Botão real, dentro do slot, clicado de verdade.
    const cancelar = Array.from(slotEl('CNH').querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Cancelar envio'),
    );
    expect(cancelar).toBeDefined();
    cancelar?.click();
    fixture.detectChanges();

    expect(aborted).toBe(true);
    expect(slotText('CNH')).not.toContain('Enviando o documento…');
    expect(state().documents()).toHaveLength(0);
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
    attach('CNH', photo());
    expect(aborted).toBe(false);

    fixture.destroy();

    expect(aborted).toBe(true);
  });

  it('traduz o 413 do upload para o teto do cliente', async () => {
    uploadDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, statusText: 'Payload Too Large' })),
    );
    await setup(false);

    attach('CNH', photo());

    expect(host().textContent).toContain('20MB');
    expect(slotText('CNH')).not.toContain('Enviando o documento…');
  });

  /**
   * O backend recusa o 21º anexo com a mensagem em `fieldErrors.file`. Ela é
   * regra de negócio: aparece INLINE dentro do card, onde o usuário está
   * olhando, e nunca como toast. O texto diz que o teto é TÉCNICO — não é
   * restrição de plano e não pode virar uma venda.
   */
  it('renderiza o erro de negócio de fieldErrors.file inline, sem toast', async () => {
    const limite =
      'Limite técnico de 20 anexos por motorista atingido. Remova um documento antes de enviar outro.';
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

    attach('CNH', photo());

    expect(state().error()).toBe(limite);
    expect(host().textContent).toContain('Limite técnico de 20 anexos por motorista atingido.');
    expect(errorToast).not.toHaveBeenCalled();
  });

  // -------------------------------------------------- N arquivos por tipo

  /**
   * ESTE é o requisito que o grid da vistoria não atende. Frente e verso da CNH
   * são dois arquivos do MESMO tipo (COMMENT da V65) e o segundo NÃO substitui
   * o primeiro: os dois têm de continuar visíveis e removíveis.
   */
  it('acumula dois arquivos no mesmo slot, sem um esconder o outro', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);
    expect(slotFileRows('CNH')).toHaveLength(1);

    uploadDocument.mockReturnValue(of(cnhVerso));
    attach('CNH', photo('cnh-verso.jpg'));

    const linhas = slotFileRows('CNH');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain('cnh-frente.jpg');
    expect(linhas[1].textContent).toContain('cnh-verso.jpg');
    expect(slotText('CNH')).toContain('2 arquivos');
  });

  it('conta 1 arquivo no singular', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    expect(slotText('CNH')).toContain('1 arquivo');
    expect(slotText('CNH')).not.toContain('1 arquivos');
    expect(slotEl('CNH').getAttribute('data-filled')).toBe('true');
  });

  it('agrupa cada arquivo sob o slot do seu próprio tipo', async () => {
    listDocuments.mockReturnValue(
      of([cnhFrente, { ...cnhFrente, id: 'd-a', kind: 'ADDRESS_PROOF' as const }]),
    );
    await setup(false);

    expect(slotFileRows('CNH')).toHaveLength(1);
    expect(slotFileRows('ADDRESS_PROOF')).toHaveLength(1);
    expect(slotFileRows('INCOME_PROOF')).toHaveLength(0);
  });

  it('renderiza nome, tipo e tamanho a partir do DTO', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    const text = slotText('CNH');
    expect(text).toContain('cnh-frente.jpg');
    // Rótulo e tamanho saem na MESMA linha de metadados, vindos do DTO.
    expect(text).toContain('CNH · 200.0 KB');
  });

  // ------------------------------------------------------------------ abrir

  it('abre o documento navegando a aba reservada para a signed URL', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    const abrir = slotFileRows('CNH')[0].querySelector<HTMLButtonElement>(
      '[aria-label="Abrir documento cnh-frente.jpg"]',
    );
    abrir?.click();
    fixture.detectChanges();

    expect(documentSignedUrl).toHaveBeenCalledWith(DRIVER_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  /** A aba reservada é a MESMA do checkout — sem cópia própria ela anuncia cobrança. */
  it('a aba reservada do documento não fala em pagamento', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    slotFileRows('CNH')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir documento cnh-frente.jpg"]')
      ?.click();

    expect(openPendingTab).toHaveBeenCalledWith(DRIVER_DOCUMENT_PLACEHOLDER_COPY);
    const [copy] = openPendingTab.mock.calls[0] as [PendingTabPlaceholderCopy];
    expect(`${copy.documentTitle} ${copy.title} ${copy.note} ${copy.stalledNote}`).not.toContain(
      'pagamento',
    );
  });

  it('fecha a aba reservada quando a signed URL falha', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    documentSignedUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    await setup(false);

    slotFileRows('CNH')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir documento cnh-frente.jpg"]')
      ?.click();
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(host().textContent).toContain('Não foi possível abrir o documento.');
  });

  // ----------------------------------------------------------------- remover

  it('remove só o arquivo escolhido e deixa o outro do mesmo tipo', async () => {
    listDocuments.mockReturnValue(of([cnhFrente, cnhVerso]));
    await setup(false);
    expect(slotFileRows('CNH')).toHaveLength(2);

    slotFileRows('CNH')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover documento cnh-frente.jpg"]')
      ?.click();
    fixture.detectChanges();
    // A confirmação é um passo real: quem apaga é o botão do diálogo.
    confirmDialogButton('Remover').click();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(DRIVER_ID, 'doc-1');
    const restantes = slotFileRows('CNH');
    expect(restantes).toHaveLength(1);
    expect(restantes[0].textContent).toContain('cnh-verso.jpg');
    expect(slotText('CNH')).toContain('1 arquivo');
    expect(successToast).toHaveBeenCalledWith('Documento removido.');
  });

  it('remoção só acontece depois da confirmação', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    slotFileRows('CNH')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover documento cnh-frente.jpg"]')
      ?.click();
    fixture.detectChanges();

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(slotFileRows('CNH')).toHaveLength(1);
  });

  it('o slot volta a "Falta anexar" quando o último arquivo sai', async () => {
    listDocuments.mockReturnValue(of([cnhFrente]));
    await setup(false);

    slotFileRows('CNH')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover documento cnh-frente.jpg"]')
      ?.click();
    fixture.detectChanges();
    confirmDialogButton('Remover').click();
    fixture.detectChanges();

    expect(slotFileRows('CNH')).toHaveLength(0);
    expect(slotEl('CNH').getAttribute('data-filled')).toBe('false');
    expect(slotText('CNH')).toContain('Falta anexar');
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
      of({ fieldErrors: { file: 'nada disso é uma lista' } } as unknown as DriverDocument[]),
    );

    await setup(false);

    // A tela continua de pé, com os slots vazios.
    expect(slotKinds()).toContain('CNH');
    expect(slotFileRows('CNH')).toHaveLength(0);
    expect(state().documents()).toEqual([]);
  });

  it('zera a lista e avisa inline quando a carga falha', async () => {
    listDocuments.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
    );

    await setup(false);

    expect(state().documents()).toEqual([]);
    expect(host().textContent).toContain('Não foi possível carregar os documentos.');
    // A tela do motorista continua utilizável, nunca branca.
    expect(slotKinds()).toContain('CNH');
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
      new Observable<DriverDocument[]>((subscriber) => {
        subscriber.next([cnhFrente]);
        subscriber.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
      }),
    );

    await setup(false);

    expect(state().documents()).toEqual([]);
    expect(slotFileRows('CNH')).toHaveLength(0);
    expect(host().textContent).toContain('Não foi possível carregar os documentos.');
  });

  // ------------------------------------------- portão do extrato de aplicativo

  it('oferece o slot APP_RIDE_RECEIPT quando isAppDriver é true', async () => {
    await setup(true);

    expect(slotKinds()).toContain('APP_RIDE_RECEIPT');
    // O portão abre um slot, não troca a lista: os tipos comuns continuam lá.
    expect(slotKinds()).toContain('CNH');
    expect(slotKinds()).toContain('ADDRESS_PROOF');
  });

  it('esconde o slot APP_RIDE_RECEIPT quando isAppDriver é false', async () => {
    await setup(false);

    expect(slotKinds()).not.toContain('APP_RIDE_RECEIPT');
    expect(slotKinds()).toContain('CNH');
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

    expect(slotKinds()).not.toContain('APP_RIDE_RECEIPT');
    expect(slotKinds()).toContain('CNH');
    // Ausência de campo é degradação silenciosa, não erro para o usuário.
    expect(state().error()).toBeNull();
    expect(errorToast).not.toHaveBeenCalled();
  });

  /** Esquecer o binding também tem de falhar fechado. */
  it('esconde o slot quando o binding isAppDriver nem é passado', async () => {
    await setup();

    expect(slotKinds()).not.toContain('APP_RIDE_RECEIPT');
    expect(slotKinds()).toContain('CNH');
    expect(state().error()).toBeNull();
  });

  /**
   * A comparação é `=== true`, não truthiness, e a diferença é observável: um
   * valor truthy que NÃO é o booleano `true` (um `1` vindo de coluna legada,
   * uma string) tem procedência desconhecida, e procedência desconhecida falha
   * fechado. Trocar por `!!isAppDriver()` abre o portão aqui.
   */
  it('não abre o portão para um valor truthy que não é o booleano true', async () => {
    await setup(1);

    expect(slotKinds()).not.toContain('APP_RIDE_RECEIPT');
    expect(state().error()).toBeNull();
  });

  /**
   * O portão não pode ser decorativo, e no slot grid isso ficou MAIS sutil que
   * no `<select>`: entre tocar no slot e escolher o arquivo o diálogo nativo do
   * sistema fica aberto por segundos, e nesse intervalo o `isAppDriver` pode
   * mudar. O tipo já apanhado subiria um kind vedado.
   *
   * Recusa sem reclassificar em silêncio — arquivo arquivado sob o tipo errado
   * é pior que envio negado.
   */
  it('recusa o envio quando o portão FECHA entre o toque no slot e a escolha do arquivo', async () => {
    await setup(true);

    // Toque no slot com o portão aberto: o tipo fica pendente.
    slotButton('APP_RIDE_RECEIPT').click();
    fixture.detectChanges();

    // O portão fecha ANTES de o arquivo ser escolhido (recarga do motorista).
    fixture.componentRef.setInput('isAppDriver', undefined);
    fixture.detectChanges();

    dispatchFile(photo('extrato.pdf', 2048, 'application/pdf'));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(host().textContent).toContain('Extrato de aplicativo não está disponível');
    // E não reclassificou o arquivo para outro tipo pelo usuário.
    expect(state().documents()).toHaveLength(0);
  });

  /**
   * Portão fechado veda ENVIO; não apaga dado que já existe. Um motorista que
   * era de app, anexou o extrato e depois teve a flag desligada continuaria com
   * o arquivo no banco — escondê-lo tiraria a única forma de vê-lo e removê-lo.
   */
  it('mantém visível o extrato já anexado com o portão fechado, mas sem aceitar envio novo', async () => {
    listDocuments.mockReturnValue(of([extratoApp]));
    await setup(false);

    expect(slotKinds()).toContain('APP_RIDE_RECEIPT');
    expect(slotFileRows('APP_RIDE_RECEIPT')).toHaveLength(1);
    expect(slotText('APP_RIDE_RECEIPT')).toContain('extrato-marco.pdf');
    // O cabeçalho não abre o seletor: o slot está lá para ler e remover.
    expect(slotButton('APP_RIDE_RECEIPT').disabled).toBe(true);
  });
});
