import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ContractDropzone, formatFileSize } from './contract-dropzone';

describe('ContractDropzone', () => {
  function mount(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ContractDropzone);
    fixture.componentRef.setInput('title', 'Arraste o arquivo do Word aqui ou clique para escolher');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('vazia: ícone laranja, título, ajuda e um seletor só de Word', () => {
    const { host } = mount();
    expect(host.querySelector('.bg-primary-50.text-primary-700 svg')).toBeTruthy();
    expect(host.textContent).toContain('Arraste o arquivo do Word aqui ou clique para escolher');
    expect(host.textContent).toContain('Arquivo do Word, até 5 MB.');
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.accept).toContain('.docx');
  });

  it('arrastar por cima pinta a área de laranja; soltar entrega o arquivo', () => {
    const { fixture, host } = mount();
    const picked: File[] = [];
    fixture.componentInstance.picked.subscribe((f) => picked.push(f));
    const zone = host.querySelector<HTMLElement>('[data-dropzone]')!;
    const over = new Event('dragover', { cancelable: true });
    zone.dispatchEvent(over);
    fixture.detectChanges();
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList).toContain('border-primary-500');

    const file = new File(['x'], 'c.docx');
    const drop = Object.assign(new Event('drop', { cancelable: true }), {
      dataTransfer: { files: [file] },
    });
    zone.dispatchEvent(drop);
    fixture.detectChanges();
    expect(picked).toEqual([file]);
    expect(zone.classList).not.toContain('border-primary-500');
  });

  it('com arquivo: nome, tamanho e «Trocar arquivo»', () => {
    const { fixture, host } = mount({ fileName: 'meu.docx', fileSize: '40,5 KB', hint: 'Confira o texto ao lado.' });
    let cleared = 0;
    fixture.componentInstance.cleared.subscribe(() => cleared++);
    expect(host.textContent).toContain('meu.docx');
    expect(host.textContent).toContain('40,5 KB · Confira o texto ao lado.');
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Trocar arquivo')!;
    btn.click();
    expect(cleared).toBe(1);
    expect(host.querySelector('input[type=file]')).toBeNull();
  });

  it('formatFileSize em pt-BR', () => {
    expect(formatFileSize(41472)).toBe('40,5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2,0 MB');
  });
});
