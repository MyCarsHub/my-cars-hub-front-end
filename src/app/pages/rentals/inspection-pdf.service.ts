import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, inject, signal } from '@angular/core';
import * as Sentry from '@sentry/angular';
// Type-only import — erased at runtime, so pdf-lib remains lazy-loaded.
import type { PDFPage, PDFPageDrawTextOptions } from 'pdf-lib';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  RENTAL_PHOTO_ANGLES,
  RentalPhotoAngle,
  RentalPhotoDto,
  RentalPhotoKind,
  RentalResponseDto,
} from '../../types/rental.types';
import { DriverResponse } from '../../types/driver.types';
import { Vehicle } from '../../types/vehicle.types';

/**
 * Response of the client-side inspection PDF upload — matches the new backend
 * endpoint `POST /rentals/{id}/inspections/{kind}/upload-pdf`, which only
 * persists the pre-rendered PDF (no server-side rendering, no heap pressure).
 * The generated document is picked up by the rentals state cache on the next
 * `refreshRentalState` call.
 */
export interface InspectionPdfUploadDto {
  id: string;
  storagePath: string;
  signedUrl: string;
  ttlSeconds: number;
  sizeBytes: number;
}

/**
 * What `generateAndUpload` emits: the backend upload response plus the
 * degradation report of the local render.
 *
 * A photo whose bytes `pdf-lib` refuses to embed (corrupt download, exotic
 * codec that survived compression, canvas fallback that returned a
 * non-JPEG/PNG blob) is dropped from the document so the laudo is still
 * produced — but the drop is NOT silent: each label lands here so the caller
 * can warn the operator that the PDF is incomplete.
 *
 * Empty array = every photo made it in (the normal path).
 */
export interface InspectionPdfResult extends InspectionPdfUploadDto {
  skippedPhotoLabels: string[];
}

/** Fine-grained progress reported while the PDF is generated + uploaded. */
export interface InspectionPdfProgress {
  step: 'idle' | 'downloading' | 'rendering' | 'uploading' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

/** Metadata rendered on the PDF cover page. Kept minimal on purpose. */
export interface InspectionPdfContext {
  rental: RentalResponseDto;
  vehicle: Pick<Vehicle, 'plate' | 'brand' | 'model' | 'yearModel' | 'hodometer'> | null;
  driver: Pick<DriverResponse, 'name'> | null;
}

const IDLE: InspectionPdfProgress = { step: 'idle', current: 0, total: 0, message: '' };

/**
 * pdf-lib's Helvetica StandardFont is WinAnsi-encoded (Latin-1, 0x00-0xFF),
 * so any codepoint above 0xFF (arrows, curly quotes, emoji, math symbols…)
 * crashes `drawText` with `WinAnsi cannot encode …`. Embedding a Unicode
 * font would add ~500KB to the bundle for an edge case, so we transliterate
 * to ASCII/Latin-1 instead. Latin-1 accents used in PT (à á â ã ç é ê í ó ô õ ú)
 * are all < 0xFF and pass through untouched.
 */
const WIN_ANSI_REPLACEMENTS: Record<string, string> = {
  '→': '->', // →
  '←': '<-', // ←
  '↑': '^', // ↑
  '↓': 'v', // ↓
  '•': '*', // •
  '·': '-', // ·
  '…': '...', // …
  '©': '(c)', // ©
  '®': '(R)', // ®
  '™': '(TM)', // ™
  '“': '"', // “
  '”': '"', // ”
  '‘': "'", // ‘
  '’': "'", // ’
  '–': '-', // –
  '—': '-', // —
  '‐': '-', // ‐
  '«': '"', // «
  '»': '"', // »
  '‹': '<', // ‹
  '›': '>', // ›
  '×': 'x', // ×
  '÷': '/', // ÷
  '±': '+/-', // ±
  '≥': '>=', // ≥
  '≤': '<=', // ≤
  '≠': '!=', // ≠
  '≈': '~', // ≈
  '°': '', // °
  '§': 'S', // §
  '¶': 'P', // ¶
};

/**
 * Replaces non-WinAnsi characters with ASCII equivalents so `drawText`
 * never throws. Unknown codepoints above 0xFF fall back to `?`.
 * Exported for unit testing.
 */
/**
 * Downscales + re-encodes an image blob to JPEG so pdf-lib embeds stay small.
 *
 * The PDF has one page per photo × up to 14 photos. Raw camera JPEGs from
 * modern phones easily reach 3–5 MB each, which produced ~40 MB PDFs that
 * hit the backend's multipart 502 body-size limit. Compressing every photo
 * to max `maxDim` px on the longest side + `quality` JPEG keeps individual
 * assets around 200–400 KB and the final PDF comfortably under 5 MB.
 *
 * Prefers `createImageBitmap` (fast off-thread decode on modern browsers),
 * falls back to `<img>` + `img.decode()`. Returns the original blob if the
 * pipeline throws or the environment is missing canvas support — callers
 * should still succeed, just with larger output.
 *
 * Exported for unit testing.
 */
export async function compressImage(
  blob: Blob,
  maxDim = 1600,
  quality = 0.75,
): Promise<Blob> {
  try {
    // Decode → dimensions
    let width: number;
    let height: number;
    let source: CanvasImageSource;
    let bitmapToClose: ImageBitmap | null = null;
    let objectUrl: string | null = null;

    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      bitmapToClose = bitmap;
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } else {
      objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    }

    if (!width || !height) {
      if (bitmapToClose) bitmapToClose.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return blob;
    }

    const scale = Math.min(1, maxDim / Math.max(width, height));
    const scaledW = Math.max(1, Math.round(width * scale));
    const scaledH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = scaledW;
    canvas.height = scaledH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (bitmapToClose) bitmapToClose.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return blob;
    }
    ctx.drawImage(source, 0, 0, scaledW, scaledH);

    if (bitmapToClose) bitmapToClose.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
    if (!encoded) return blob;
    // If compression somehow inflated the payload (already-tiny thumbnail),
    // keep the original.
    return encoded.size < blob.size ? encoded : blob;
  } catch {
    return blob;
  }
}

export function sanitizeForWinAnsi(text: string): string {
  if (!text) return text;
  let out = '';
  for (const ch of text) {
    const mapped = WIN_ANSI_REPLACEMENTS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    // Codepoints > 0xFF cannot be encoded by WinAnsi.
    // `charCodeAt(0)` is sufficient here because surrogate pairs (emoji, etc.)
    // start with a high surrogate in the range 0xD800-0xDBFF which is > 0xFF.
    if (ch.charCodeAt(0) > 0xff) {
      out += '?';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Renders the inspection PDF entirely in the browser via `pdf-lib`, then
 * uploads the resulting Blob as multipart to the backend. Replaces the
 * legacy server-side `/generate-pdf` endpoint which was OOM-crashing the
 * Render free tier heap when embedding 14 photos.
 *
 * `pdf-lib` is lazy-imported so it stays out of the initial chunk — same
 * pattern as `docx-preview` in the contract card.
 */
@Injectable({ providedIn: 'root' })
export class InspectionPdfService {
  private readonly http = inject(HttpClient);
  private readonly _progress = signal<InspectionPdfProgress>(IDLE);

  /** Observable-ish view of the current generation step for UX feedback. */
  readonly progress: Signal<InspectionPdfProgress> = this._progress.asReadonly();

  /**
   * Renders + uploads the inspection PDF for a rental.
   *
   * Fetches each photo via its `signedUrl` (already inline on RentalPhotoDto),
   * embeds them page by page, then POSTs the resulting Blob to the new
   * upload endpoint. Photos are rendered in the canonical
   * {@link RENTAL_PHOTO_ANGLES} order — missing angles are skipped without
   * error to preserve UX parity with the old flow.
   *
   * Photos that fail to embed do not abort the run, but they are reported:
   * see {@link InspectionPdfResult.skippedPhotoLabels}.
   */
  generateAndUpload(
    rentalId: string,
    kind: RentalPhotoKind,
    context: InspectionPdfContext,
    photos: RentalPhotoDto[],
  ): Observable<InspectionPdfResult> {
    return from(this.render(kind, context, photos)).pipe(
      switchMap(({ blob, skippedPhotoLabels }) =>
        this.upload(rentalId, kind, blob, skippedPhotoLabels),
      ),
      catchError((err) => {
        this._progress.set({
          step: 'error',
          current: 0,
          total: 0,
          message: 'Falha ao gerar o PDF.',
        });
        throw err;
      }),
    );
  }

  /** Resets progress back to idle — call after the caller consumes the result. */
  reset(): void {
    this._progress.set(IDLE);
  }

  private async render(
    kind: RentalPhotoKind,
    context: InspectionPdfContext,
    photos: RentalPhotoDto[],
  ): Promise<{ blob: Blob; skippedPhotoLabels: string[] }> {
    // Lazy import — keeps pdf-lib (~200KB gz) out of the initial bundle.
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

    // Ordered + filtered list of photos with signedUrl. Angles the operator
    // never uploaded are simply omitted from the PDF.
    const orderedPhotos = this.orderPhotos(photos);
    const total = orderedPhotos.length;

    // Preload all photo bytes first so that "downloading" and "rendering"
    // are cleanly separated in the UX progress bar.
    this._progress.set({
      step: 'downloading',
      current: 0,
      total,
      message: total === 0 ? 'Sem fotos para incluir.' : `Baixando foto 0 de ${total}…`,
    });

    const photoBytes: Array<{ photo: RentalPhotoDto; label: string; bytes: ArrayBuffer }> = [];
    for (let i = 0; i < orderedPhotos.length; i++) {
      const { photo, label } = orderedPhotos[i];
      if (!photo.signedUrl) continue;
      const res = await fetch(photo.signedUrl);
      if (!res.ok) throw new Error(`Falha ao baixar a foto ${label} (${res.status}).`);
      let blob = await res.blob();
      this._progress.set({
        step: 'downloading',
        current: i + 1,
        total,
        message: `Comprimindo foto ${i + 1} de ${total}…`,
      });
      // Downscale + re-encode to JPEG to keep the final PDF under the
      // backend's multipart body-size limit. Falls back to the original
      // blob if the compression pipeline is unavailable.
      blob = await compressImage(blob);
      const bytes = await blob.arrayBuffer();
      photoBytes.push({ photo, label, bytes });
      this._progress.set({
        step: 'downloading',
        current: i + 1,
        total,
        message: `Baixando foto ${i + 1} de ${total}…`,
      });
    }

    this._progress.set({
      step: 'rendering',
      current: 0,
      total,
      message: 'Gerando PDF…',
    });

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    // -------------- Cover page --------------
    const cover = doc.addPage([595.28, 841.89]); // A4 portrait, points
    const { width, height } = cover.getSize();
    const margin = 48;
    let y = height - margin;

    const title =
      kind === 'CHECKIN' ? 'Laudo de vistoria — CHECK-IN' : 'Laudo de vistoria — CHECK-OUT';
    this.drawSafeText(cover, title, { x: margin, y, size: 18, font: fontBold, color: rgb(0, 0, 0) });
    y -= 28;
    this.drawSafeText(cover, `Gerado em ${new Date().toLocaleString('pt-BR')}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 32;

    const lines: Array<[string, string]> = [
      ['Rental', context.rental.id],
      ['Período', `${context.rental.startDate} → ${context.rental.endDate}`],
    ];
    if (context.vehicle) {
      lines.push([
        'Veículo',
        `${context.vehicle.plate} — ${context.vehicle.brand} ${context.vehicle.model} (${context.vehicle.yearModel})`,
      ]);
      lines.push(['Hodômetro (cadastro)', String(context.vehicle.hodometer ?? '—')]);
    }
    if (context.driver) {
      lines.push(['Motorista', context.driver.name]);
    }
    if (context.rental.initialKm != null) {
      lines.push(['Hodômetro inicial (rental)', String(context.rental.initialKm)]);
    }

    for (const [label, value] of lines) {
      this.drawSafeText(cover, `${label}:`, { x: margin, y, size: 11, font: fontBold });
      this.drawSafeText(cover, value, { x: margin + 170, y, size: 11, font });
      y -= 18;
      if (y < margin) break;
    }

    // -------------- One page per photo --------------
    const skippedPhotoLabels: string[] = [];
    for (let i = 0; i < photoBytes.length; i++) {
      const { photo, label, bytes } = photoBytes[i];
      this._progress.set({
        step: 'rendering',
        current: i + 1,
        total,
        message: `Renderizando página ${i + 1} de ${total}…`,
      });

      // Post-`compressImage` the bytes are always JPEG. If compression
      // fell back to the original blob (rare: canvas unavailable), try
      // PNG as a last resort; otherwise skip the page.
      let image;
      try {
        image = await doc.embedJpg(bytes);
      } catch (jpgErr) {
        try {
          image = await doc.embedPng(bytes);
        } catch (pngErr) {
          // Both encoders refused these bytes. Degrading (PDF without this
          // page) is still the right call — a laudo with 13 of 14 photos
          // beats no laudo at all — but it must never be silent: this used
          // to be a bare `continue`, so operators downloaded incomplete
          // documents believing they were complete.
          this.reportPhotoEmbedFailure(label, photo, jpgErr, pngErr);
          skippedPhotoLabels.push(label);
          continue;
        }
      }

      const page = doc.addPage([595.28, 841.89]);
      const pw = page.getSize().width;
      const ph = page.getSize().height;
      this.drawSafeText(page, label, {
        x: margin,
        y: ph - margin,
        size: 14,
        font: fontBold,
      });

      const maxW = pw - margin * 2;
      const maxH = ph - margin * 2 - 60; // reserve header
      const scale = Math.min(maxW / image.width, maxH / image.height, 1);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      page.drawImage(image, {
        x: (pw - drawW) / 2,
        y: (ph - margin - 30 - drawH),
        width: drawW,
        height: drawH,
      });
    }

    const pdfBytes = await doc.save();
    const blob = new Blob([pdfBytes as unknown as ArrayBuffer], { type: 'application/pdf' });
    return { blob, skippedPhotoLabels };
  }

  /**
   * Makes a dropped photo observable on both channels the project already
   * uses: `console.warn` for local/devtools visibility (same pattern as
   * `auth.service.ts`) and `Sentry.captureException` for prod telemetry
   * (same pattern as `onboarding-container.ts`).
   *
   * NOTE: `environment.sentryDsn` is empty in both environment files today,
   * so the Sentry call is a no-op until the DSN is configured — the
   * `console.warn` and the returned `skippedPhotoLabels` are what actually
   * surface the failure right now.
   */
  private reportPhotoEmbedFailure(
    label: string,
    photo: RentalPhotoDto,
    jpgErr: unknown,
    pngErr: unknown,
  ): void {
    console.warn(
      `[inspection-pdf] foto "${label}" não pôde ser embutida no PDF e foi omitida.`,
      { photoId: photo.id, angle: photo.angle, mimeType: photo.mimeType, jpgErr, pngErr },
    );
    Sentry.captureException(pngErr instanceof Error ? pngErr : new Error(String(pngErr)), {
      tags: { source: 'inspection-pdf.embedPhoto' },
      extra: { label, photoId: photo.id, angle: photo.angle, mimeType: photo.mimeType, jpgErr },
    });
  }

  private upload(
    rentalId: string,
    kind: RentalPhotoKind,
    blob: Blob,
    skippedPhotoLabels: string[],
  ): Observable<InspectionPdfResult> {
    this._progress.set({
      step: 'uploading',
      current: 0,
      total: 1,
      message: 'Enviando PDF…',
    });
    const form = new FormData();
    form.append('file', blob, `inspection-${kind.toLowerCase()}.pdf`);
    const url = `${environment.apiUrl}/rentals/${rentalId}/inspections/${kind.toLowerCase()}/upload-pdf`;
    return this.http.post<InspectionPdfUploadDto>(url, form).pipe(
      switchMap((res) => {
        const skipped = skippedPhotoLabels.length;
        this._progress.set({
          step: 'done',
          current: 1,
          total: 1,
          message:
            skipped === 0
              ? 'PDF enviado.'
              : `PDF enviado sem ${skipped} foto(s): ${skippedPhotoLabels.join(', ')}.`,
        });
        return of({ ...res, skippedPhotoLabels });
      }),
    );
  }

  /**
   * Sanitizes `text` via {@link sanitizeForWinAnsi} before delegating to
   * `page.drawText`. Every call site in this service goes through here so
   * unicode characters (arrows, curly quotes, emoji) never crash pdf-lib's
   * WinAnsi-encoded Helvetica.
   */
  private drawSafeText(page: PDFPage, text: string, opts: PDFPageDrawTextOptions): void {
    page.drawText(sanitizeForWinAnsi(text), opts);
  }

  /**
   * Preserves {@link RENTAL_PHOTO_ANGLES} canonical order and pairs each
   * angle with the operator-visible label. Duplicates for the same angle
   * (shouldn't happen — backend replaces on upload) collapse to the last.
   */
  private orderPhotos(
    photos: RentalPhotoDto[],
  ): Array<{ photo: RentalPhotoDto; label: string }> {
    const byAngle = new Map<RentalPhotoAngle, RentalPhotoDto>();
    for (const p of photos) byAngle.set(p.angle, p);
    const out: Array<{ photo: RentalPhotoDto; label: string }> = [];
    for (const a of RENTAL_PHOTO_ANGLES) {
      const p = byAngle.get(a.value);
      if (p) out.push({ photo: p, label: a.label });
    }
    return out;
  }
}
