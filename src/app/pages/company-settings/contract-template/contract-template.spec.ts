import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ContractTemplate } from './contract-template';
import {
  ContractTemplateDto,
  ContractTemplateService,
} from './contract-template-service';
import { NotificationService } from '../../../services/notification.service';
import { DocumentPreviewService } from '../../../components/document-preview/document-preview.service';

/**
 * Covers the two new "open" / "download" flows for the raw DOCX template.
 * We stub the HTTP boundary (`ContractTemplateService`) and the DOM sinks
 * (`window.open`, `URL.createObjectURL`) — the goal is to verify wiring:
 * service call + blob URL lifecycle + anchor click on download.
 */
describe('ContractTemplate — open/download raw template', () => {
  const tpl: ContractTemplateDto = {
    id: 't1',
    filename: 'my-contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 1024,
    uploadedAt: '2026-01-01T00:00:00Z',
    uploadedBy: 'u1',
    detectedPlaceholders: [],
    supportedVariables: [],
  };

  const service = {
    get: vi.fn(() => of(tpl)),
    downloadTemplate: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    aiInstructions: vi.fn(),
    example: vi.fn(),
    renderUrl: vi.fn(),
  };
  const notifications = { push: vi.fn() };
  const preview = { open: vi.fn() };

  beforeEach(async () => {
    service.get.mockClear();
    service.downloadTemplate.mockClear();
    notifications.push.mockClear();
    preview.open.mockClear();
    service.get.mockReturnValue(of(tpl));

    TestBed.configureTestingModule({
      imports: [ContractTemplate],
      providers: [
        { provide: ContractTemplateService, useValue: service },
        { provide: NotificationService, useValue: notifications },
        { provide: DocumentPreviewService, useValue: preview },
      ],
    });
    // O ponto de montagem do fluxo com IA usa @defer: as dependências resolvem async.
    await TestBed.compileComponents();
  });

  function makeFixture() {
    const fixture = TestBed.createComponent(ContractTemplate);
    fixture.detectChanges();
    return fixture;
  }

  it('downloadTemplate: cria anchor com filename do template e revoga blob URL', () => {
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
    (fixture.componentInstance as any).downloadTemplate();

    expect(service.downloadTemplate).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:mock');

    createEl.mockRestore();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  });

  it('downloadTemplate: erro HTTP vira banner inline, nunca toast', () => {
    service.downloadTemplate.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'boom' } })),
    );
    const fixture = makeFixture();
    (fixture.componentInstance as any).downloadTemplate();

    expect((fixture.componentInstance as any).error()).toBe('boom');
    expect(notifications.push).not.toHaveBeenCalledWith('error', 'boom');
    expect((fixture.componentInstance as any).downloading()).toBe(false);
  });

  it('"Abrir template" abre o visualizador do app com o DOCX autenticado, sem aba nova', () => {
    const windowOpen = vi.spyOn(window, 'open');
    const blob = new Blob(['PK']);
    service.downloadTemplate.mockReturnValue(of(blob));
    const fixture = makeFixture();

    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === 'Abrir template');
    button?.click();

    expect(windowOpen).not.toHaveBeenCalled();
    expect(preview.open).toHaveBeenCalledTimes(1);
    const [request] = preview.open.mock.calls[0] as [
      { source: () => Observable<Blob>; fileName: string; errorMessage: string },
    ];
    expect(request.fileName).toBe('my-contract.docx');
    // Os bytes só descem quando o visualizador chama o carregador.
    expect(service.downloadTemplate).not.toHaveBeenCalled();
    let received: Blob | null = null;
    request.source().subscribe((b) => (received = b));
    expect(service.downloadTemplate).toHaveBeenCalledOnce();
    expect(received).toBe(blob);
    windowOpen.mockRestore();
  });
});
