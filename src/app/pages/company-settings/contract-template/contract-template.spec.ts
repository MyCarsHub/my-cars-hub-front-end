import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ContractTemplate } from './contract-template';
import { ContractTemplateDto, ContractTemplateService } from './contract-template-service';
import { NotificationService } from '../../../services/notification.service';
import { DocumentPreviewService } from '../../../components/document-preview/document-preview.service';

/**
 * Cartão «Contrato atual» e os estados da página. A esteira tem o próprio spec; aqui ela
 * só monta (o HttpClient de teste segura as leituras dela sem responder).
 */
describe('ContractTemplate', () => {
  const tpl: ContractTemplateDto = {
    id: 't1',
    filename: 'my-contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 41472,
    uploadedAt: '2026-09-25T12:00:00Z',
    uploadedBy: 'u1',
    detectedPlaceholders: [],
    supportedVariables: [],
  };

  const service = {
    get: vi.fn(),
    downloadTemplate: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    aiInstructions: vi.fn(),
    example: vi.fn(),
    renderUrl: vi.fn(),
  };
  const notifications = { push: vi.fn(), success: vi.fn(), error: vi.fn() };
  const preview = { open: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    service.get.mockReturnValue(of(tpl));
    TestBed.configureTestingModule({
      imports: [ContractTemplate],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: ContractTemplateService, useValue: service },
        { provide: NotificationService, useValue: notifications },
        { provide: DocumentPreviewService, useValue: preview },
      ],
    });
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(ContractTemplate);
    fixture.detectChanges();
    return fixture;
  }

  const findButton = (root: HTMLElement, label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === label,
    );

  it('mostra nome, tamanho e data do contrato atual com as três ações', () => {
    const fixture = makeFixture();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Contrato');
    expect(host.textContent).toContain('my-contract.docx');
    expect(host.textContent).toContain('40,5 KB · Atualizado 25/09/2026');
    expect(findButton(host, 'Baixar Contrato')).toBeTruthy();
    expect(findButton(host, 'Abrir contrato')).toBeTruthy();
    expect(findButton(host, 'Remover')).toBeTruthy();
    expect(host.textContent).not.toMatch(/template|placeholder/i);
  });

  it('404 = sem contrato: frase de estado vazio, sem erro', () => {
    service.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const fixture = makeFixture();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Nenhum contrato cadastrado. Monte o seu abaixo.');
    expect(host.querySelector('[role=alert]')).toBeNull();
  });

  it('falha de leitura: banner de erro com «Tentar novamente» que relê', () => {
    service.get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    const fixture = makeFixture();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[role=alert]')?.textContent).toContain(
      'Não foi possível carregar o seu contrato.',
    );
    findButton(host, 'Tentar novamente')!.click();
    fixture.detectChanges();
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('my-contract.docx');
  });

  it('«Baixar Contrato»: anchor com o nome do arquivo e revoga a URL', () => {
    const blob = new Blob(['docx-bytes'], { type: tpl.mimeType });
    service.downloadTemplate.mockReturnValue(of(blob));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    const fixture = makeFixture();
    findButton(fixture.nativeElement, 'Baixar Contrato')!.click();

    expect(service.downloadTemplate).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:mock');
    createEl.mockRestore();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  });

  it('«Baixar Contrato» com erro HTTP vira banner inline, nunca toast', () => {
    service.downloadTemplate.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'boom' } })),
    );
    const fixture = makeFixture();
    findButton(fixture.nativeElement, 'Baixar Contrato')!.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain(
      'boom',
    );
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('«Abrir contrato» abre o visualizador do app com o DOCX autenticado, sem aba nova', () => {
    const windowOpen = vi.spyOn(window, 'open');
    const blob = new Blob(['PK']);
    service.downloadTemplate.mockReturnValue(of(blob));
    const fixture = makeFixture();

    findButton(fixture.nativeElement, 'Abrir contrato')!.click();

    expect(windowOpen).not.toHaveBeenCalled();
    expect(preview.open).toHaveBeenCalledTimes(1);
    const [request] = preview.open.mock.calls[0] as [
      { source: () => Observable<Blob>; fileName: string },
    ];
    expect(request.fileName).toBe('my-contract.docx');
    expect(service.downloadTemplate).not.toHaveBeenCalled();
    let received: Blob | null = null;
    request.source().subscribe((b) => (received = b));
    expect(received).toBe(blob);
    windowOpen.mockRestore();
  });

  it('«Remover» confirma antes e, removido, mostra o estado vazio', () => {
    service.delete.mockReturnValue(of(void 0));
    const fixture = makeFixture();
    const host: HTMLElement = fixture.nativeElement;
    findButton(host, 'Remover')!.click();
    fixture.detectChanges();
    expect(service.delete).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Tem certeza que deseja remover o contrato «my-contract.docx»?');

    const confirm = Array.from(host.querySelectorAll<HTMLButtonElement>('[role=dialog] button')).find(
      (b) => b.textContent?.trim() === 'Remover',
    );
    confirm!.click();
    fixture.detectChanges();
    expect(service.delete).toHaveBeenCalledOnce();
    expect(notifications.success).toHaveBeenCalledWith('Contrato «my-contract.docx» removido.');
    expect(host.textContent).toContain('Nenhum contrato cadastrado. Monte o seu abaixo.');
  });
});
