import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InspectionPdfResult,
  InspectionPdfService,
  compressImage,
  sanitizeForWinAnsi,
} from './inspection-pdf.service';
import { environment } from '../../../environments/environment';
import { RentalPhotoDto, RentalResponseDto } from '../../types/rental.types';
import { LoggerService } from '../../services/logger.service';

// pdf-lib is heavy + browser-only; stub it out so the spec exercises the
// download + upload orchestration without pulling the real library into
// the vitest JSDOM env.
vi.mock('pdf-lib', () => {
  const image = { width: 100, height: 100 };
  const page = {
    getSize: () => ({ width: 595.28, height: 841.89 }),
    drawText: vi.fn(),
    drawImage: vi.fn(),
  };
  const doc = {
    addPage: vi.fn(() => page),
    embedFont: vi.fn(async () => ({})),
    embedJpg: vi.fn(async () => image),
    embedPng: vi.fn(async () => image),
    save: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  return {
    PDFDocument: { create: vi.fn(async () => doc) },
    StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'HelveticaBold' },
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
  };
});

describe('InspectionPdfService.generateAndUpload', () => {
  const RID = 'rid-1';
  let httpPost: ReturnType<typeof vi.fn>;
  let service: InspectionPdfService;
  let logger: LoggerService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    httpPost = vi.fn().mockReturnValue(
      of({
        id: 'doc-1',
        storagePath: 'rentals/rid-1/inspection.pdf',
        signedUrl: 'https://example/signed',
        ttlSeconds: 300,
        sizeBytes: 3,
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        InspectionPdfService,
        {
          provide: HttpClient,
          useValue: { post: httpPost, get: vi.fn(), delete: vi.fn(), put: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(InspectionPdfService);
    logger = TestBed.inject(LoggerService);

    // Stub fetch — each photo download returns an empty ArrayBuffer/Blob.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
      blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
    })) as unknown as typeof fetch;
  });

  function rental(): RentalResponseDto {
    return {
      id: RID,
      vehicleId: 'v-1',
      driverId: 'd-1',
      startDate: '2026-07-01',
      endDate: '2026-07-10',
      periodRate: 10000,
      totalAmount: 100000,
      caucaoAmount: 0,
      caucaoPaid: false,
      status: 'ACTIVE',
      billingFrequency: 'DAILY',
      notes: null,
      initialKm: 12345,
      pickupDate: null,
      firstPaymentDate: null,
      dailyInterestAmount: null,
      lateFineType: null,
      lateFineValue: null,
      contractSource: 'MANUAL',
      franchiseKm: null,
      returnFuelPolicy: null,
      charges: [],
      createdAt: '2026-07-01T00:00:00Z',
      modifiedAt: '2026-07-01T00:00:00Z',
    };
  }

  function photo(angle: RentalPhotoDto['angle'], id: string): RentalPhotoDto {
    return {
      id,
      rentalId: RID,
      kind: 'CHECKIN',
      angle,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      signedUrl: `https://signed/${id}`,
      createdDate: '2026-07-01T00:00:00Z',
    };
  }

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads every photo with a signedUrl and POSTs the PDF blob to /upload-pdf', async () => {
    const photos = [photo('FRONT', 'p1'), photo('BACK', 'p2')];
    const done = new Promise<void>((resolve, reject) => {
      service
        .generateAndUpload(RID, 'CHECKIN', { rental: rental(), vehicle: null, driver: null }, photos)
        .subscribe({
          next: (res) => {
            try {
              expect(res.id).toBe('doc-1');
              expect(globalThis.fetch).toHaveBeenCalledTimes(2);
              expect(httpPost).toHaveBeenCalledTimes(1);
              const [url, body] = httpPost.mock.calls[0];
              expect(url).toBe(
                `${environment.apiUrl}/rentals/${RID}/inspections/checkin/upload-pdf`,
              );
              expect(body).toBeInstanceOf(FormData);
              const file = (body as FormData).get('file');
              expect(file).toBeInstanceOf(Blob);
              expect((file as Blob).type).toBe('application/pdf');
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          },
          error: reject,
        });
    });
    await done;
  });

  it('reports progress steps: downloading -> rendering -> uploading -> done', async () => {
    const steps: string[] = [];
    const photos = [photo('FRONT', 'p1')];
    await new Promise<void>((resolve, reject) => {
      // Sample the progress signal on each microtask by hooking into fetch.
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (...args) => {
        steps.push(service.progress().step);
        return (origFetch as typeof fetch).call(globalThis, ...(args as Parameters<typeof fetch>));
      }) as unknown as typeof fetch;

      service
        .generateAndUpload(RID, 'CHECKOUT', { rental: rental(), vehicle: null, driver: null }, photos)
        .subscribe({
          next: () => {
            steps.push(service.progress().step);
            try {
              expect(steps[0]).toBe('downloading');
              expect(steps).toContain('done');
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          },
          error: reject,
        });
    });
  });

  // Controle negativo do bug "falha silenciosa de foto": antes, embedJpg e
  // embedPng falhando resultavam num `continue` mudo — o PDF subia sem a
  // foto e nem usuário, nem log, nem Sentry ficavam sabendo. Este teste
  // falha se alguém reintroduzir aquele catch vazio.
  it('still uploads the PDF when a photo fails to embed, but reports the failure', async () => {
    const pdfLib = await import('pdf-lib');
    const doc = await pdfLib.PDFDocument.create();
    vi.mocked(doc.embedJpg).mockRejectedValueOnce(new Error('not a jpg'));
    vi.mocked(doc.embedPng).mockRejectedValueOnce(new Error('not a png'));
    const logged = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      const photos = [photo('FRONT', 'p1')];
      const res = await new Promise<InspectionPdfResult>((resolve, reject) => {
        service
          .generateAndUpload(
            RID,
            'CHECKIN',
            { rental: rental(), vehicle: null, driver: null },
            photos,
          )
          .subscribe({ next: resolve, error: reject });
      });

      // (a) degradação, não aborto: o PDF continua sendo gerado e enviado.
      expect(httpPost).toHaveBeenCalledTimes(1);
      expect(res.id).toBe('doc-1');

      // (b) a falha é observável: contabilizada no resultado, registrada como
      //     AVISO (degradação parcial, não erro) com contexto útil, e
      //     refletida na mensagem de progresso.
      expect(res.skippedPhotoLabels).toHaveLength(1);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0][0])).toContain('não pôde ser embutida');
      expect(logged.mock.calls[0][1]).toMatchObject({ photoId: 'p1', angle: 'FRONT' });
      expect(service.progress().message).toContain('sem 1 foto');
    } finally {
      logged.mockRestore();
    }
  });

  // Controle negativo do bug irmão: uma foto sem `signedUrl` era descartada
  // por um `continue` mudo — sem log, fora de `skippedPhotoLabels`, e ainda
  // assim contada no `total` do progresso (barra que nunca fechava). Este
  // teste falha se aquele `continue` voltar.
  it('reports a photo without signedUrl instead of dropping it silently', async () => {
    const logged = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      const withUrl = photo('FRONT', 'p1');
      const noUrl = { ...photo('BACK', 'p2'), signedUrl: null };

      const res = await new Promise<InspectionPdfResult>((resolve, reject) => {
        service
          .generateAndUpload(RID, 'CHECKIN', { rental: rental(), vehicle: null, driver: null }, [
            withUrl,
            noUrl,
          ])
          .subscribe({ next: resolve, error: reject });
      });

      // (a) não impede a geração: o PDF continua sendo gerado e enviado, e a
      //     foto válida ainda é baixada.
      expect(httpPost).toHaveBeenCalledTimes(1);
      expect(res.id).toBe('doc-1');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // (b) entra em skippedPhotoLabels, então o card consegue avisar o operador.
      expect(res.skippedPhotoLabels).toHaveLength(1);
      expect(service.progress().message).toContain('sem 1 foto');

      // (c) é logada como AVISO, com contexto e com o motivo que a distingue
      //     de "bytes recusados pelo pdf-lib".
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0][0])).toContain('sem URL assinada');
      expect(logged.mock.calls[0][1]).toMatchObject({
        photoId: 'p2',
        angle: 'BACK',
        reason: 'missing-signed-url',
      });
    } finally {
      logged.mockRestore();
    }
  });

  it('excludes photos without signedUrl from the progress total', async () => {
    const logged = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const totals: number[] = [];

    try {
      const noUrl = { ...photo('BACK', 'p2'), signedUrl: null };
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (...args) => {
        totals.push(service.progress().total);
        return (origFetch as typeof fetch).call(globalThis, ...(args as Parameters<typeof fetch>));
      }) as unknown as typeof fetch;

      await new Promise<InspectionPdfResult>((resolve, reject) => {
        service
          .generateAndUpload(RID, 'CHECKIN', { rental: rental(), vehicle: null, driver: null }, [
            photo('FRONT', 'p1'),
            noUrl,
          ])
          .subscribe({ next: resolve, error: reject });
      });

      // Só a foto baixável entra no denominador: `total` é 1, não 2. Com o
      // `continue` mudo antigo o total era 2 e o `current` parava em 1.
      expect(totals).toEqual([1]);
    } finally {
      logged.mockRestore();
    }
  });

  it('generates the PDF even when every photo lacks a signedUrl', async () => {
    const logged = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      const res = await new Promise<InspectionPdfResult>((resolve, reject) => {
        service
          .generateAndUpload(RID, 'CHECKIN', { rental: rental(), vehicle: null, driver: null }, [
            { ...photo('FRONT', 'p1'), signedUrl: null },
            { ...photo('BACK', 'p2'), signedUrl: null },
          ])
          .subscribe({ next: resolve, error: reject });
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(res.id).toBe('doc-1');
      expect(res.skippedPhotoLabels).toHaveLength(2);
      expect(logged).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
  });

  it('reports no skipped photos on the happy path', async () => {
    const res = await new Promise<InspectionPdfResult>((resolve, reject) => {
      service
        .generateAndUpload(RID, 'CHECKIN', { rental: rental(), vehicle: null, driver: null }, [
          photo('FRONT', 'p1'),
        ])
        .subscribe({ next: resolve, error: reject });
    });
    expect(res.skippedPhotoLabels).toEqual([]);
    expect(service.progress().message).toBe('PDF enviado.');
  });

it('lowercases kind in the upload URL (CHECKOUT -> checkout)', async () => {
    await new Promise<void>((resolve, reject) => {
      service
        .generateAndUpload(RID, 'CHECKOUT', { rental: rental(), vehicle: null, driver: null }, [])
        .subscribe({
          next: () => {
            try {
              expect(httpPost.mock.calls[0][0]).toBe(
                `${environment.apiUrl}/rentals/${RID}/inspections/checkout/upload-pdf`,
              );
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          },
          error: reject,
        });
    });
  });
});

describe('compressImage', () => {
  it('returns the original blob when the canvas pipeline is unavailable (JSDOM)', async () => {
    const original = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    const result = await compressImage(original);
    // In JSDOM neither createImageBitmap nor canvas.toBlob produce a usable
    // encoded image, so the fallback path must return the original blob
    // unchanged instead of throwing.
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it('returns a Blob (never rejects) even for malformed input', async () => {
    const garbage = new Blob([new Uint8Array([0, 1, 2])], { type: 'image/png' });
    const result = await compressImage(garbage, 800, 0.6);
    expect(result).toBeInstanceOf(Blob);
  });

});

describe('sanitizeForWinAnsi', () => {
  it('transliterates arrows and common punctuation to ASCII equivalents', () => {
    expect(sanitizeForWinAnsi('a → b')).toBe('a -> b');
    expect(sanitizeForWinAnsi('x ← y')).toBe('x <- y');
    expect(sanitizeForWinAnsi('one • two')).toBe('one * two');
    expect(sanitizeForWinAnsi('loading…')).toBe('loading...');
    expect(sanitizeForWinAnsi('“hello”')).toBe('"hello"');
    expect(sanitizeForWinAnsi('a — b')).toBe('a - b');
    expect(sanitizeForWinAnsi('3 × 4 ≥ 10')).toBe('3 x 4 >= 10');
  });

  it('replaces unknown codepoints above 0xFF (including emoji surrogate pairs) with `?`', () => {
    // U+2603 SNOWMAN — no explicit mapping, > 0xFF → `?`
    expect(sanitizeForWinAnsi('cold ☃ day')).toBe('cold ? day');
    // Emoji is a surrogate pair; each iterated unit starts with a high surrogate > 0xFF
    expect(sanitizeForWinAnsi('hi 🚗')).toBe('hi ?');
  });

  it('preserves Latin-1 characters used in Portuguese accents (all < 0xFF)', () => {
    const pt = 'Veículo à ção — não é só café: piauí, coração, mãe';
    // After sanitize: em-dash becomes `-`, all accented letters preserved.
    expect(sanitizeForWinAnsi(pt)).toBe('Veículo à ção - não é só café: piauí, coração, mãe');
    // Explicit codepoint check on the OUTPUT — every char must be <= 0xFF.
    for (const ch of sanitizeForWinAnsi(pt)) {
      expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0xff);
    }
  });

  it('returns empty/undefined-safe inputs unchanged', () => {
    expect(sanitizeForWinAnsi('')).toBe('');
  });
});
