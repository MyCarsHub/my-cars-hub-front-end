import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_PREVIEW_VIEWER, DocumentPreviewService } from './document-preview.service';
import type { DocumentPreviewGallery } from './document-preview.types';

/**
 * Um modal de mentira com o MESMO contrato do real (input `request`, output
 * `closeRequested`). O sujeito aqui é o serviço — histórico, montagem, foco — e não o
 * visualizador, que tem spec própria. O `import()` dinâmico do token não resolve no
 * runner, por isso o carregador é trocado por um síncrono.
 */
@Component({
  selector: 'app-fake-viewer',
  template: `<button type="button" data-fake-close (click)="closeRequested.emit()">x</button>
    <span data-fake-title>{{ request().items[0].fileName }}</span>`,
})
class FakeViewer {
  readonly request = input.required<DocumentPreviewGallery>();
  readonly closeRequested = output<void>();
}

@Component({ template: '' })
class Blank {}

describe('DocumentPreviewService', () => {
  let service: DocumentPreviewService;
  let trigger: HTMLButtonElement;

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
  const host = () => document.body.querySelector('app-fake-viewer');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'outra', component: Blank }]),
        { provide: DOCUMENT_PREVIEW_VIEWER, useValue: () => Promise.resolve(FakeViewer) },
      ],
    });
    service = TestBed.inject(DocumentPreviewService);
    trigger = document.createElement('button');
    trigger.textContent = 'Abrir';
    document.body.appendChild(trigger);
    trigger.focus();
  });

  afterEach(() => {
    service.close();
    trigger.remove();
    vi.restoreAllMocks();
  });

  it('monta o modal no body e empurra uma entrada no histórico', async () => {
    const push = vi.spyOn(history, 'pushState');
    service.open({ source: new Blob(['x']), fileName: 'CNH' });
    await flush();
    TestBed.tick();

    expect(host()).not.toBeNull();
    expect(host()?.textContent).toContain('CNH');
    expect(push).toHaveBeenCalledTimes(1);
    expect(service.isOpen()).toBe(true);
  });

  it('o X do modal fecha, consome a entrada com history.back() e devolve o foco', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    service.open({ source: new Blob(['x']), fileName: 'CNH' });
    await flush();
    TestBed.tick();
    (host()?.querySelector('[data-fake-close]') as HTMLButtonElement).click();

    expect(host()).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('o VOLTAR do navegador (popstate) fecha sem chamar history.back() de novo', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    service.open({ source: new Blob(['x']), fileName: 'CNH' });
    await flush();
    TestBed.tick();

    // O navegador já voltou: a entrada do modal não é mais a atual.
    history.replaceState({}, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

    expect(host()).toBeNull();
    expect(back).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('abrir de novo com o modal aberto troca o conteúdo sem outra entrada', async () => {
    const push = vi.spyOn(history, 'pushState');
    service.open({ source: new Blob(['x']), fileName: 'Primeiro' });
    await flush();
    TestBed.tick();
    service.open({ source: new Blob(['y']), fileName: 'Segundo' });
    TestBed.tick();

    expect(document.body.querySelectorAll('app-fake-viewer').length).toBe(1);
    expect(host()?.textContent).toContain('Segundo');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('uma navegação de verdade leva o modal junto', async () => {
    service.open({ source: new Blob(['x']), fileName: 'CNH' });
    await flush();
    TestBed.tick();

    await TestBed.inject(Router).navigateByUrl('/outra');

    expect(host()).toBeNull();
    expect(service.isOpen()).toBe(false);
  });

  it('fechar enquanto o chunk do modal desce não monta nada depois', async () => {
    vi.spyOn(history, 'back').mockImplementation(() => undefined);
    service.open({ source: new Blob(['x']), fileName: 'CNH' });
    service.close();
    await flush();
    TestBed.tick();

    expect(host()).toBeNull();
  });

  it('galeria vazia não abre nada', () => {
    const push = vi.spyOn(history, 'pushState');
    service.open({ items: [] });
    expect(service.isOpen()).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
