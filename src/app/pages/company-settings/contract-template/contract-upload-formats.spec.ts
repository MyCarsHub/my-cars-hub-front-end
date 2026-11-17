import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { httpErrorMessage } from './ai/contract-ai.messages';
import { CONTRACT_ACCEPT, contractFileKind, hasPdfSignature } from './contract-dropzone';
import { ContractUploadStep } from './steps/upload-step';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('envio do contrato: Word, PDF ou Markdown', () => {
  it('reconhece os três formatos pelo nome e pelo tipo, e recusa o resto', () => {
    expect(contractFileKind(new File(['x'], 'c.docx', { type: DOCX_MIME }))).toBe('docx');
    expect(contractFileKind(new File(['x'], 'c.pdf', { type: 'application/pdf' }))).toBe('pdf');
    expect(contractFileKind(new File(['x'], 'c.md', { type: '' }))).toBe('md');
    expect(contractFileKind(new File(['x'], 'c.md', { type: 'text/markdown' }))).toBe('md');
    expect(contractFileKind(new File(['x'], 'c.odt', { type: '' }))).toBeNull();
    expect(contractFileKind(new File(['x'], 'c.pdf', { type: 'image/png' }))).toBeNull();
    expect(contractFileKind(new File(['x'], 'c.docm', { type: '' }))).toBeNull();
    expect(CONTRACT_ACCEPT).toContain('.pdf');
    expect(CONTRACT_ACCEPT).toContain('.md');
  });

  it('PDF de verdade começa com %PDF-', async () => {
    expect(await hasPdfSignature(new Blob(['%PDF-1.7\n...']))).toBe(true);
    expect(await hasPdfSignature(new Blob(['PK\u0003\u0004']))).toBe(false);
  });

  it('PDF digitalizado: a tela mostra a frase do servidor', () => {
    const message =
      'Este PDF é uma imagem (foi digitalizado ou fotografado) e não tem texto que possamos ler. Envie o contrato em Word (.docx), em PDF com texto ou em Markdown (.md).';
    const err = new HttpErrorResponse({
      status: 400,
      error: { code: 'PDF_WITHOUT_TEXT', field: 'file', message },
    });
    expect(httpErrorMessage(err, 'falhou')).toBe(message);
    // Sem a frase no corpo, a reserva local diz o mesmo.
    const bare = new HttpErrorResponse({ status: 400, error: { code: 'PDF_WITHOUT_TEXT' } });
    expect(httpErrorMessage(bare, 'falhou')).toContain('Este PDF é uma imagem');
  });

  it('a frase do servidor só vale para as recusas do arquivo', () => {
    const err = new HttpErrorResponse({ status: 400, error: { code: 'DRAFT_LIMIT_REACHED', message: 'texto do servidor' } });
    expect(httpErrorMessage(err, 'falhou')).not.toBe('texto do servidor');
  });

  it('a área de envio diz os três formatos e o limite', () => {
    const fixture = TestBed.createComponent(ContractUploadStep);
    fixture.componentRef.setInput('touch', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Toque para escolher o arquivo (Word, PDF ou Markdown)');
    expect(host.textContent).toContain('Word, PDF ou Markdown, até 5 MB');
    expect(host.querySelector('input[type=file]')?.getAttribute('accept')).toContain('.md');
    // Sem aviso de macro.
    expect(host.textContent).not.toMatch(/macro/i);
  });
});
