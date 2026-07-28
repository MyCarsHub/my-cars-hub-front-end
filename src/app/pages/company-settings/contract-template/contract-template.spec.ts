import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ContractTemplate } from './contract-template';
import {
  ContractTemplateDto,
  ContractTemplateService,
} from './contract-template-service';
import { NotificationService } from '../../../services/notification.service';

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

  beforeEach(() => {
    service.get.mockClear();
    service.downloadTemplate.mockClear();
    notifications.push.mockClear();
    service.get.mockReturnValue(of(tpl));

    TestBed.configureTestingModule({
      providers: [
        { provide: ContractTemplateService, useValue: service },
        { provide: NotificationService, useValue: notifications },
      ],
    });
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

  it('openTemplateAsHtml: abre nova aba, chama service e reseta loading em erro', () => {
    service.downloadTemplate.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'fetch failed' } })),
    );

    const fakeWin = {
      document: {
        write: vi.fn(),
        close: vi.fn(),
        body: document.createElement('div'),
        querySelector: vi.fn(() => null),
      },
      close: vi.fn(),
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as any);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openTemplateAsHtml();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(fakeWin.document.write).toHaveBeenCalled();
    expect(service.downloadTemplate).toHaveBeenCalledOnce();
    expect((fixture.componentInstance as any).error()).toBe('fetch failed');
    expect((fixture.componentInstance as any).opening()).toBe(false);

    openSpy.mockRestore();
  });

  it('openTemplateAsHtml: pop-up bloqueado → banner inline e sem chamar service', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const fixture = makeFixture();
    (fixture.componentInstance as any).openTemplateAsHtml();

    expect(service.downloadTemplate).not.toHaveBeenCalled();
    expect((fixture.componentInstance as any).error()).toBe(
      'Permita pop-ups pra abrir o template.',
    );
    expect((fixture.componentInstance as any).opening()).toBe(false);

    openSpy.mockRestore();
  });
});
