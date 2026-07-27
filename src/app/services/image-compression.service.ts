import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

/** Lado maior da imagem final, em px. Suficiente pro laudo em PDF. */
const MAX_DIMENSION = 1600;
/** Qualidade do JPEG de saída — equilíbrio entre nitidez e tamanho. */
const JPEG_QUALITY = 0.8;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

/**
 * Reduz fotos de câmera antes do upload. Celulares modernos produzem arquivos
 * de 10-20MB, acima do cap de 8MB do backend — reamostrar pra 1600px/JPEG 0.8
 * mantém o arquivo bem abaixo do limite sem perda visível no laudo.
 *
 * Contrato de falha: NUNCA lança. Se o browser não decodifica o arquivo (HEIC
 * no Chrome/Firefox, canvas indisponível, SSR), devolve o arquivo ORIGINAL e
 * deixa o backend decidir — compressão é otimização, não gate de upload.
 */
@Injectable({ providedIn: 'root' })
export class ImageCompressionService {
  private readonly platformId = inject(PLATFORM_ID);

  async compress(file: File): Promise<File> {
    if (!isPlatformBrowser(this.platformId)) return file;
    let decoded: DecodedImage | null = null;
    try {
      decoded = await this.decode(file);
      const blob = await this.toJpeg(decoded);
      // Recomprimir foto já pequena costuma aumentar o arquivo — nesse caso
      // o original vence.
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], this.jpegName(file.name), {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    } catch {
      return file;
    } finally {
      decoded?.release();
    }
  }

  /**
   * `createImageBitmap` é o caminho rápido (off-main-thread) e o único que
   * respeita EXIF via `imageOrientation`. Cai pra `<img>` quando ausente ou
   * quando a flag não é suportada.
   */
  private async decode(file: File): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await this.createBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    }
    return this.decodeViaImageElement(file);
  }

  private async createBitmap(file: File): Promise<ImageBitmap> {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return await createImageBitmap(file);
    }
  }

  private decodeViaImageElement(file: File): Promise<DecodedImage> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () =>
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          release: () => URL.revokeObjectURL(url),
        });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode failed'));
      };
      img.src = url;
    });
  }

  private toJpeg(decoded: DecodedImage): Promise<Blob | null> {
    const { width, height } = decoded;
    if (!width || !height) throw new Error('invalid dimensions');
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    if (typeof canvas.toBlob !== 'function') throw new Error('toBlob unavailable');
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  }

  private jpegName(name: string): string {
    const base = name.replace(/\.[^.]+$/, '');
    return `${base || 'foto'}.jpg`;
  }
}
