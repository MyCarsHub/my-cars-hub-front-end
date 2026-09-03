import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INCIDENT_DOCUMENT_PLACEHOLDER_COPY,
  IncidentDocumentsCard,
} from './incident-documents-card';
import { DocumentsCard } from '../../components/documents/documents-card';
import { VehicleIncidentsService } from '../../services/vehicle-incidents.service';
import { ApiErrorService } from '../../services/api-error.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import type { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import type { IncidentDocument } from '../../types/vehicle-incident.types';

/**
 * Anexos do sinistro via o card COMPARTILHADO em MODO N (FIX-0234): o antigo
 * `<select>` de tipo virou grade de slots, mas o PRODUTO não mudou — várias
 * fotos do dano na mesma ocorrência seguem sendo o caso normal, e nenhum slot
 * tranca por ter arquivo. Interações pelo DOM real, como nos cards irmãos.
 *
 * O vocabulário do sinistro é ANEXO (iteração 3): o card compartilhado recebe
 * `nounSingular="anexo"`, então toasts, erros e rótulos acessíveis voltam a
 * combinar com o título "Anexos".
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

  const segundaFoto: IncidentDocument = {
    ...savedDocument,
    id: 'doc-2',
    fileName: 'dano-lateral.jpg',
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

  /** Leitura de estado só para asserção — a AÇÃO nunca passa por aqui. */
  interface CardState {
    error(): string | null;
    documents(): IncidentDocument[];
  }

  function state(): CardState {
    const inner = fixture.debugElement.query(By.directive(DocumentsCard))?.componentInstance;
    if (!inner) throw new Error('o card compartilhado não está na tela');
    return inner as CardState;
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

  function slotButton(kind: string): HTMLButtonElement {
    const el = slotEl(kind).querySelector<HTMLButtonElement>(':scope > button');
    if (!el) throw new Error(`slot ${kind} não tem botão de anexar`);
    return el;
  }

  function slotFileRows(kind: string): HTMLElement[] {
    return Array.from(slotEl(kind).querySelectorAll<HTMLElement>('[data-file-row]'));
  }

  function dispatchFile(file: File | null): void {
    const input = host().querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('o seletor de arquivos não está na tela');
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function attach(kind: string, file: File): void {
    slotButton(kind).click();
    fixture.detectChanges();
    dispatchFile(file);
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

  it('mostra um slot por tipo do backend, sem `<select>` de tipo', async () => {
    await setup();

    expect(slotKinds()).toEqual([
      'DAMAGE_PHOTO',
      'POLICE_REPORT',
      'REPAIR_QUOTE',
      'INSURANCE_CLAIM',
      'OTHER',
    ]);
    expect(host().querySelector('select')).toBeNull();
    // Nenhum tipo é essencial: não existe contador "N de M" aqui.
    expect(host().textContent).not.toContain('documentos essenciais');
  });

  it('envia o arquivo com o tipo do slot tocado', async () => {
    await setup();

    attach('POLICE_REPORT', photo('bo.pdf', 2048, 'application/pdf'));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [incidentId, kind, file] = uploadDocument.mock.calls[0] as [string, string, File];
    expect(incidentId).toBe(INCIDENT_ID);
    expect(kind).toBe('POLICE_REPORT');
    expect(file).toBeInstanceOf(File);
    expect(successToast).toHaveBeenCalledWith('Anexo enviado.');
  });

  /**
   * MODO N — o produto não mudou no FIX-0234: a segunda foto do dano
   * ACRESCENTA, o slot nunca tranca por ter arquivo.
   */
  it('acumula duas fotos do dano no mesmo slot — nenhum teto por tipo', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();
    expect(slotFileRows('DAMAGE_PHOTO')).toHaveLength(1);
    expect(slotButton('DAMAGE_PHOTO').disabled).toBe(false);

    uploadDocument.mockReturnValue(of(segundaFoto));
    attach('DAMAGE_PHOTO', photo('dano-lateral.jpg'));

    const rows = slotFileRows('DAMAGE_PHOTO');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('dano-frontal.jpg');
    expect(rows[1].textContent).toContain('dano-lateral.jpg');
    // E o slot CONTINUA anexável: modo N não conhece "cheio".
    expect(slotButton('DAMAGE_PHOTO').disabled).toBe(false);
    expect(slotButton('DAMAGE_PHOTO').getAttribute('aria-label')).toBe(
      'Anexar Foto do dano — anexo anexado, ainda há vaga',
    );
  });

  it('recusa formato fora da allowlist sem gastar dados móveis', async () => {
    await setup();

    attach('DAMAGE_PHOTO', photo('planilha.xlsx', 1024, 'application/vnd.ms-excel'));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(state().error()).toContain('PDF, JPG, PNG, WebP, HEIC/HEIF');
  });

  it('recusa arquivo acima de 20MB sem chamar a API', async () => {
    await setup();

    attach('DAMAGE_PHOTO', photo('enorme.jpg', 21 * 1024 * 1024));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(state().error()).toContain('20MB');
  });

  /** Alguns Android entregam `type` vazio para HEIC — o nome salva o envio. */
  it('aceita HEIC sem content-type pelo nome do arquivo', async () => {
    await setup();

    attach('DAMAGE_PHOTO', photo('IMG_0042.HEIC', 1024, ''));

    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it('mostra estado indeterminado no slot tocado, sem barra de progresso', async () => {
    const pending = new Subject<IncidentDocument>();
    uploadDocument.mockReturnValue(pending.asObservable());
    await setup();

    attach('DAMAGE_PHOTO', photo());

    expect(slotEl('DAMAGE_PHOTO').textContent).toContain('Enviando o anexo…');
    expect(host().querySelector('progress')).toBeNull();
    expect(host().querySelector('[role="progressbar"]')).toBeNull();
  });

  it('"Cancelar envio" desfaz a assinatura, abortando o request de verdade', async () => {
    let aborted = false;
    uploadDocument.mockReturnValue(
      new Observable<IncidentDocument>(() => () => {
        aborted = true;
      }),
    );

    await setup();
    attach('DAMAGE_PHOTO', photo());
    expect(aborted).toBe(false);

    const cancelar = Array.from(slotEl('DAMAGE_PHOTO').querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Cancelar envio'),
    );
    expect(cancelar).toBeDefined();
    cancelar?.click();
    fixture.detectChanges();

    expect(aborted).toBe(true);
    expect(state().documents()).toHaveLength(0);
    expect(infoToast).toHaveBeenCalledWith('Envio cancelado.');
    expect(successToast).not.toHaveBeenCalled();
  });

  it('traduz o 413 do upload para o teto do cliente', async () => {
    uploadDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, statusText: 'Payload Too Large' })),
    );
    await setup();

    attach('DAMAGE_PHOTO', photo());

    expect(state().error()).toContain('20MB');
  });

  it('abre o anexo navegando a aba reservada para a signed URL', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('DAMAGE_PHOTO')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir anexo dano-frontal.jpg"]')
      ?.click();
    fixture.detectChanges();

    expect(documentSignedUrl).toHaveBeenCalledWith(INCIDENT_ID, 'doc-1');
    expect(navigate).toHaveBeenCalledWith('https://signed/doc');
  });

  /** A aba reservada é a MESMA do checkout — sem cópia própria ela anuncia cobrança. */
  it('a aba reservada do anexo não fala em pagamento', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('DAMAGE_PHOTO')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir anexo dano-frontal.jpg"]')
      ?.click();

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

    slotFileRows('DAMAGE_PHOTO')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Abrir anexo dano-frontal.jpg"]')
      ?.click();
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('remove o anexo depois da confirmação e tira a linha da lista', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    slotFileRows('DAMAGE_PHOTO')[0]
      .querySelector<HTMLButtonElement>('[aria-label="Remover anexo dano-frontal.jpg"]')
      ?.click();
    fixture.detectChanges();
    expect(deleteDocument).not.toHaveBeenCalled();

    const dialog = host().querySelector('app-confirm-dialog');
    const confirmar = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (b) => (b.textContent ?? '').trim() === 'Remover',
    );
    confirmar?.click();
    fixture.detectChanges();

    expect(deleteDocument).toHaveBeenCalledWith(INCIDENT_ID, 'doc-1');
    expect(state().documents()).toHaveLength(0);
    expect(successToast).toHaveBeenCalledWith('Anexo removido.');
  });

  it('renderiza nome, tipo e tamanho a partir do DTO — e o título "Anexos"', async () => {
    listDocuments.mockReturnValue(of([savedDocument]));
    await setup();

    const text = host().textContent ?? '';
    expect(text).toContain('Anexos');
    expect(text).toContain('dano-frontal.jpg');
    expect(text).toContain('Foto do dano');
    expect(text).toContain('200.0 KB');
  });
});
