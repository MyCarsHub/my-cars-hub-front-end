import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ImageCompressionService } from './image-compression.service';

/**
 * jsdom não implementa canvas 2d nem toBlob — o caminho feliz é testado com
 * createImageBitmap + canvas stubbados; o caminho de falha usa o jsdom cru,
 * que é exatamente o cenário "browser não decodifica HEIC".
 */
describe('ImageCompressionService', () => {
  let service: ImageCompressionService;

  function bigFile(sizeBytes: number, type = 'image/jpeg', name = 'IMG_0001.HEIC'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: sizeBytes });
    return file;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImageCompressionService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reamostra pra JPEG menor quando o browser consegue decodificar', async () => {
    const bitmap = { width: 4032, height: 3024, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );
    const smallBlob = new Blob(['compressed']);
    Object.defineProperty(smallBlob, 'size', { value: 900 * 1024 });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((cb: (b: Blob) => void) => cb(smallBlob)),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);

    const original = bigFile(12 * 1024 * 1024);
    const result = await service.compress(original);

    expect(result).not.toBe(original);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_0001.jpg');
    expect(result.size).toBeLessThan(original.size);
    // lado maior clampado em 1600px, aspect ratio preservado
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('devolve o arquivo ORIGINAL quando a decodificação falha (HEIC não suportado)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('unsupported source'))),
    );
    const original = bigFile(12 * 1024 * 1024, 'image/heic');

    await expect(service.compress(original)).resolves.toBe(original);
  });

  it('devolve o original quando o canvas 2d não está disponível', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 100, height: 80, close: vi.fn() })),
    );
    const original = bigFile(2 * 1024 * 1024);

    await expect(service.compress(original)).resolves.toBe(original);
  });

  it('mantém o original quando a recompressão ficaria maior', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 800, height: 600, close: vi.fn() })),
    );
    const fatBlob = new Blob(['x']);
    Object.defineProperty(fatBlob, 'size', { value: 500 * 1024 });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((cb: (b: Blob) => void) => cb(fatBlob)),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);

    const original = bigFile(120 * 1024, 'image/png', 'small.png');
    await expect(service.compress(original)).resolves.toBe(original);
  });
});
