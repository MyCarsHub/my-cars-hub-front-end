import { describe, expect, it } from 'vitest';
import { downloadFileName, sniffFormat } from './document-format';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));

describe('sniffFormat', () => {
  it('reconhece cada formato pelos primeiros bytes', () => {
    expect(sniffFormat(ascii('%PDF-1.7'))).toBe('pdf');
    expect(sniffFormat(bytes(0x50, 0x4b, 0x03, 0x04, 0x14))).toBe('docx');
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffFormat(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffFormat(ascii('GIF89a'))).toBe('gif');
    expect(sniffFormat(ascii('\0\0\0\x18ftypheic'))).toBe('heic');
    expect(sniffFormat(ascii('olá, texto'))).toBe('unknown');
  });

  it('arquivo menor que a assinatura não estoura', () => {
    expect(sniffFormat(bytes(0x25))).toBe('unknown');
    expect(sniffFormat(new Uint8Array(0))).toBe('unknown');
  });
});

describe('downloadFileName', () => {
  it('troca uma extensão conhecida mas errada pela que os bytes pedem', () => {
    // Contrato AUTO assinado: a linha diz DOCX, os bytes são PDF.
    expect(downloadFileName('Contrato.docx', 'pdf')).toBe('Contrato.pdf');
    expect(downloadFileName('Contrato-123', 'docx')).toBe('Contrato-123.docx');
    expect(downloadFileName('foto.JPEG', 'png')).toBe('foto.png');
  });

  it('não soma a extensão quando o nome já tem a certa', () => {
    expect(downloadFileName('apolice.pdf', 'pdf')).toBe('apolice.pdf');
  });

  it('formato desconhecido mantém o nome; nome vazio vira "documento"', () => {
    expect(downloadFileName('anotacoes.txt', 'unknown')).toBe('anotacoes.txt');
    expect(downloadFileName('  ', 'pdf')).toBe('documento.pdf');
  });

  it('tira caracteres que o sistema de arquivos recusa', () => {
    expect(downloadFileName('CNH: frente/verso', 'jpeg')).toBe('CNH- frente-verso.jpg');
  });
});
