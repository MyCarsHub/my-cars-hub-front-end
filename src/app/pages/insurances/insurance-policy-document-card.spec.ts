import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InsurancePolicyDocumentCard } from './insurance-policy-document-card';
import { InsurancesService } from '../../services/insurances.service';
import { ApiErrorService } from '../../services/api-error.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { POLICY_DOCUMENT_PLACEHOLDER_COPY } from '../../services/pending-tab-placeholder';
import type { PendingTabPlaceholderCopy } from '../../services/pending-tab-placeholder';
import type { InsurancePolicyDocument } from '../../types/insurance.types';

/**
 * Upload / visualização / remoção da apólice em PDF.
 *
 * O ponto sensível coberto aqui é o upload: guardas client-side antes de gastar
 * dados móveis, e o estado indeterminado (o app usa `withFetch()`, que nunca
 * emite progresso — nada de barra falsa).
 */
describe('InsurancePolicyDocumentCard', () => {
  const INSURANCE_ID = 'ins-1';

  /** Espelha `InsurancePolicyDocumentDto`: sem `id`, e `uploadedAt` sem offset. */
  const savedDocument: InsurancePolicyDocument = {
    insuranceId: INSURANCE_ID,
    mimeType: 'application/pdf',
    sizeBytes: 204_800,
    uploadedBy: 'user-1',
    uploadedAt: '2026-02-10T12:00:00',
  };

  let uploadPolicyDocument: ReturnType<typeof vi.fn>;
  let deletePolicyDocument: ReturnType<typeof vi.fn>;
  let policyDocumentSignedUrl: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let closeTab: ReturnType<typeof vi.fn>;
  let openPendingTab: ReturnType<typeof vi.fn>;
  let successToast: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<InsurancePolicyDocumentCard>;

  /** Acesso tipado aos membros `protected` exercitados pelo teste. */
  interface CardInternals {
    error(): string | null;
    uploading(): boolean;
    document(): InsurancePolicyDocument | null;
    onFileSelected(event: Event): void;
    openDocument(): void;
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
    Object.defineProperty(input, 'files', {
      value: file ? [file] : [],
      configurable: true,
    });
    return { target: input } as unknown as Event;
  }

  function pdf(name = 'apolice.pdf', size = 1024): File {
    const file = new File(['%PDF-1.7'], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
  }

  async function setup(initial: InsurancePolicyDocument | null = null): Promise<void> {
    fixture = TestBed.createComponent(InsurancePolicyDocumentCard);
    fixture.componentRef.setInput('insuranceId', INSURANCE_ID);
    fixture.componentRef.setInput('policyDocument', initial);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    uploadPolicyDocument = vi.fn(() => of(savedDocument));
    deletePolicyDocument = vi.fn(() => of(void 0));
    policyDocumentSignedUrl = vi.fn(() => of({ url: 'https://signed/x', expiresInSeconds: 60 }));
    navigate = vi.fn();
    closeTab = vi.fn();
    openPendingTab = vi.fn(() => ({ blocked: false, navigate, close: closeTab }));
    successToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: InsurancesService,
          useValue: { uploadPolicyDocument, deletePolicyDocument, policyDocumentSignedUrl },
        },
        { provide: ExternalNavigationService, useValue: { openPendingTab } },
        {
          provide: NotificationService,
          useValue: { success: successToast, info: vi.fn(), error: vi.fn(), warning: vi.fn() },
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

  it('envia o PDF por multipart e publica o documento salvo', async () => {
    await setup(null);

    api().onFileSelected(fileEvent(pdf()));
    fixture.detectChanges();

    expect(uploadPolicyDocument).toHaveBeenCalledTimes(1);
    const [insuranceId, file] = uploadPolicyDocument.mock.calls[0];
    expect(insuranceId).toBe(INSURANCE_ID);
    expect(file).toBeInstanceOf(File);
    expect(api().document()).toEqual(savedDocument);
    expect(api().uploading()).toBe(false);
    expect(successToast).toHaveBeenCalledWith('Apólice anexada.');
  });

  it('recusa arquivo que não é PDF sem chamar a API', async () => {
    await setup(null);

    const notPdf = new File(['x'], 'apolice.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    api().onFileSelected(fileEvent(notPdf));
    fixture.detectChanges();

    expect(uploadPolicyDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('PDF');
  });

  /**
   * A guarda exige media type PDF **E** extensão `.pdf` — antes bastava uma das
   * duas, então um `.docx` renomeado para `.pdf` passava batido no cliente e o
   * usuário só descobria o problema depois de gastar o upload. O servidor
   * valida media type declarado E magic bytes, então recusar aqui só antecipa
   * a mesma resposta.
   */
  it('recusa arquivo apenas renomeado para .pdf sem chamar a API', async () => {
    await setup(null);

    const renamed = new File(['x'], 'apolice.pdf', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    api().onFileSelected(fileEvent(renamed));
    fixture.detectChanges();

    expect(uploadPolicyDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('PDF');
  });

  it('recusa PDF declarado com extensão errada sem chamar a API', async () => {
    await setup(null);

    const wrongExtension = new File(['%PDF-1.7'], 'apolice.txt', { type: 'application/pdf' });
    api().onFileSelected(fileEvent(wrongExtension));
    fixture.detectChanges();

    expect(uploadPolicyDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('PDF');
  });

  it('recusa arquivo acima de 20MB sem chamar a API', async () => {
    await setup(null);

    api().onFileSelected(fileEvent(pdf('grande.pdf', 21 * 1024 * 1024)));
    fixture.detectChanges();

    expect(uploadPolicyDocument).not.toHaveBeenCalled();
    expect(api().error()).toContain('20MB');
  });

  /**
   * O teto do cliente espelha o do servidor
   * (`InsurancePolicyDocumentService.MAX_PDF_BYTES` = 20MB). Antes o cliente
   * parava em 10MB e barrava no navegador um PDF de 12MB que o servidor
   * aceitaria — citando um limite que não era o real.
   */
  it('aceita PDF de 12MB, que o servidor aceita', async () => {
    await setup(null);

    api().onFileSelected(fileEvent(pdf('scan.pdf', 12 * 1024 * 1024)));
    fixture.detectChanges();

    expect(uploadPolicyDocument).toHaveBeenCalledTimes(1);
    expect(api().error()).toBeNull();
  });

  it('traduz o 413 do upload para o teto do cliente', async () => {
    uploadPolicyDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 413, statusText: 'Payload Too Large' })),
    );
    await setup(null);

    api().onFileSelected(fileEvent(pdf()));
    fixture.detectChanges();

    expect(api().error()).toContain('20MB');
    expect(api().uploading()).toBe(false);
  });

  it('abre a apólice navegando a aba reservada para a signed URL', async () => {
    await setup(savedDocument);

    api().openDocument();
    fixture.detectChanges();

    expect(policyDocumentSignedUrl).toHaveBeenCalledWith(INSURANCE_ID);
    expect(navigate).toHaveBeenCalledWith('https://signed/x');
  });

  /**
   * A aba reservada é a MESMA do checkout. Sem cópia própria ela mostra o texto
   * padrão dela, e quem pediu o PDF de uma apólice já emitida lia "Abrindo o
   * pagamento seguro. Não feche esta aba." — anúncio de cobrança que não existe.
   */
  it('a aba reservada da apólice não anuncia pagamento', async () => {
    await setup(savedDocument);

    api().openDocument();
    fixture.detectChanges();

    expect(openPendingTab).toHaveBeenCalledWith(POLICY_DOCUMENT_PLACEHOLDER_COPY);
    const [copy] = openPendingTab.mock.calls[0] as [PendingTabPlaceholderCopy];
    expect(`${copy.documentTitle} ${copy.title} ${copy.note} ${copy.stalledNote}`).not.toContain(
      'pagamento',
    );
    expect(closeTab).not.toHaveBeenCalled();
  });

  it('fecha a aba reservada quando a signed URL falha', async () => {
    policyDocumentSignedUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    await setup(savedDocument);

    api().openDocument();
    fixture.detectChanges();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(api().error()).toBe('Não foi possível abrir a apólice.');
  });

  /**
   * Trava os nomes de campo contra `InsurancePolicyDocumentDto`: o DTO usa
   * `uploadedAt` (não `createdDate`) e NÃO tem `id`. Um rename silencioso do
   * backend viraria "—" na tela em vez de quebrar o build — por isso o assert.
   */
  it('renderiza tamanho e data a partir de sizeBytes/uploadedAt do DTO', async () => {
    await setup(savedDocument);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('200.0 KB');
    expect(text).toContain(new Date('2026-02-10T12:00:00').toLocaleDateString('pt-BR'));
  });

  it('remove a apólice e zera o documento local', async () => {
    await setup(savedDocument);
    expect(api().document()).toEqual(savedDocument);

    api().confirmDelete();
    fixture.detectChanges();

    expect(deletePolicyDocument).toHaveBeenCalledWith(INSURANCE_ID);
    expect(api().document()).toBeNull();
    expect(successToast).toHaveBeenCalledWith('Apólice removida.');
  });
});
