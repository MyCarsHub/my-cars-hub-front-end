import { TestBed } from '@angular/core/testing';
import { HttpEventType } from '@angular/common/http';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { RentalInspectionCard } from './rental-inspection-card';
import { RentalService, RentalStateSnapshot } from '../rental.service';
import { InspectionPdfService } from '../inspection-pdf.service';
import { DriverService } from '../../../services/driver.service';
import { VehiclesService } from '../../../services/vehicles.service';
import { NotificationService } from '../../../services/notification.service';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { ImageCompressionService } from '../../../services/image-compression.service';

/**
 * Cobre o fluxo de foto da vistoria: escolha da fonte (câmera vs galeria) e
 * compressão client-side antes do POST — inclusive o fallback que preserva o
 * arquivo original quando o browser não consegue decodificar (HEIC).
 */
describe('RentalInspectionCard — fonte da foto e compressão', () => {
  const RID = 'rid';
  const state = signal<RentalStateSnapshot | null>(null);

  const rentalService = {
    rentalState: vi.fn(() => state),
    loadRentalState: vi.fn(),
    refreshRentalState: vi.fn(),
    uploadPhotoWithProgress: vi.fn(),
    getById: vi.fn(),
    documentSignedUrl: vi.fn(),
    deleteDocument: vi.fn(),
  };
  const inspectionPdf = {
    progress: signal({ message: '' }),
    generateAndUpload: vi.fn(),
    reset: vi.fn(),
  };
  const notifications = { push: vi.fn() };
  const compression = { compress: vi.fn() };

  function file(sizeBytes: number, type = 'image/jpeg', name = 'IMG_0001.jpg'): File {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: sizeBytes });
    return f;
  }

  function fileEvent(f: File): Event {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    return { target: input } as unknown as Event;
  }

  function makeFixture() {
    const fixture = TestBed.createComponent(RentalInspectionCard);
    fixture.componentRef.setInput('rentalId', RID);
    fixture.componentRef.setInput('kind', 'CHECKIN');
    fixture.detectChanges();
    return fixture;
  }

  /** Acesso tipado aos membros protegidos exercitados pelos testes. */
  function api(fixture: ReturnType<typeof makeFixture>) {
    return fixture.componentInstance as unknown as {
      pending: string | null;
      onFileSelected: (e: Event) => void;
      cancelUpload: (angle: string) => void;
      slots: () => Array<{ angle: string; uploading: boolean }>;
      sourceSheetOpen: () => boolean;
    };
  }

  /** Promise controlada manualmente — simula uma compressão ainda em voo. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.set({
      documents: [],
      checkinPhotos: [],
      checkoutPhotos: [],
      contractSignature: null,
    } as unknown as RentalStateSnapshot);
    rentalService.uploadPhotoWithProgress.mockReturnValue(
      of({ type: HttpEventType.Response, body: { id: 'p1' } } as never),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: RentalService, useValue: rentalService },
        { provide: InspectionPdfService, useValue: inspectionPdf },
        { provide: VehiclesService, useValue: { getOne: vi.fn() } },
        { provide: DriverService, useValue: { getOne: vi.fn() } },
        { provide: ExternalNavigationService, useValue: { openExternal: vi.fn() } },
        { provide: NotificationService, useValue: notifications },
        { provide: ImageCompressionService, useValue: compression },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compressão antes do upload', () => {
    it('sobe o arquivo COMPRIMIDO quando a compressão reduz uma foto acima do cap', async () => {
      const original = file(12 * 1024 * 1024, 'image/jpeg', 'IMG_0002.jpg');
      const compressed = file(900 * 1024);
      compression.compress.mockResolvedValue(compressed);

      const fixture = makeFixture();
      const cmp = api(fixture);
      cmp.pending = 'FRONT';
      cmp.onFileSelected(fileEvent(original));
      await Promise.resolve();
      await Promise.resolve();

      expect(compression.compress).toHaveBeenCalledWith(original);
      expect(rentalService.uploadPhotoWithProgress).toHaveBeenCalledWith(
        RID,
        'CHECKIN',
        'FRONT',
        compressed,
      );
      expect(notifications.push).toHaveBeenCalledWith('success', 'Foto enviada.');
    });

    it('fallback: compressão devolve o original (HEIC) e o upload prossegue', async () => {
      const original = file(3 * 1024 * 1024, 'image/heic', 'IMG_0003.HEIC');
      compression.compress.mockResolvedValue(original);

      const fixture = makeFixture();
      const cmp = api(fixture);
      cmp.pending = 'BACK';
      cmp.onFileSelected(fileEvent(original));
      await Promise.resolve();
      await Promise.resolve();

      expect(rentalService.uploadPhotoWithProgress).toHaveBeenCalledWith(
        RID,
        'CHECKIN',
        'BACK',
        original,
      );
      expect(notifications.push).not.toHaveBeenCalledWith('error', 'Imagem excede 8MB.');
    });

    it('bloqueia com toast quando nem a compressão traz o arquivo abaixo de 8MB', async () => {
      const original = file(30 * 1024 * 1024, 'image/heic', 'IMG_0004.HEIC');
      compression.compress.mockResolvedValue(original);

      const fixture = makeFixture();
      const cmp = api(fixture);
      cmp.pending = 'LEFT';
      cmp.onFileSelected(fileEvent(original));
      await Promise.resolve();
      await Promise.resolve();

      expect(rentalService.uploadPhotoWithProgress).not.toHaveBeenCalled();
      expect(notifications.push).toHaveBeenCalledWith('error', 'Imagem excede 8MB.');
      expect(cmp.slots().find((s) => s.angle === 'LEFT')?.uploading).toBe(false);
    });

    it('cancelar durante a compressão e re-selecionar o slot NÃO duplica o upload', async () => {
      const first = deferred<File>();
      const retryFile = file(700 * 1024, 'image/jpeg', 'IMG_retry.jpg');
      compression.compress.mockReturnValueOnce(first.promise);

      const fixture = makeFixture();
      const cmp = api(fixture);

      cmp.pending = 'FRONT';
      cmp.onFileSelected(fileEvent(file(5 * 1024 * 1024)));
      expect(cmp.slots().find((s) => s.angle === 'FRONT')?.uploading).toBe(true);

      // Usuário cancela enquanto a 1ª compressão ainda está em voo.
      cmp.cancelUpload('FRONT');
      expect(cmp.slots().find((s) => s.angle === 'FRONT')?.uploading).toBe(false);

      // ...e re-seleciona o MESMO slot; essa tentativa comprime na hora.
      compression.compress.mockResolvedValueOnce(retryFile);
      cmp.pending = 'FRONT';
      cmp.onFileSelected(fileEvent(file(5 * 1024 * 1024)));
      await Promise.resolve();
      await Promise.resolve();

      expect(rentalService.uploadPhotoWithProgress).toHaveBeenCalledTimes(1);
      expect(rentalService.uploadPhotoWithProgress).toHaveBeenCalledWith(
        RID,
        'CHECKIN',
        'FRONT',
        retryFile,
      );

      // A promise órfã resolve depois — não pode disparar um 2º POST.
      first.resolve(file(600 * 1024));
      await Promise.resolve();
      await Promise.resolve();
      expect(rentalService.uploadPhotoWithProgress).toHaveBeenCalledTimes(1);
    });

    it('compressão rejeitada libera o slot e avisa, sem unhandled rejection', async () => {
      compression.compress.mockRejectedValue(new Error('canvas indisponível'));

      const fixture = makeFixture();
      const cmp = api(fixture);
      cmp.pending = 'TRUNK';
      cmp.onFileSelected(fileEvent(file(2 * 1024 * 1024)));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(cmp.slots().find((s) => s.angle === 'TRUNK')?.uploading).toBe(false);
      expect(rentalService.uploadPhotoWithProgress).not.toHaveBeenCalled();
      expect(notifications.push).toHaveBeenCalledWith(
        'error',
        'Não foi possível preparar a foto. Tente novamente.',
      );
    });

    it('rejeita MIME fora do allowlist sem chamar a compressão', () => {
      const fixture = makeFixture();
      const cmp = api(fixture);
      cmp.pending = 'RIGHT';
      cmp.onFileSelected(fileEvent(file(1024, 'application/pdf', 'doc.pdf')));

      expect(compression.compress).not.toHaveBeenCalled();
      expect(notifications.push).toHaveBeenCalledWith(
        'error',
        'Formato inválido. Use JPG, PNG, WebP ou HEIC.',
      );
    });
  });

  describe('escolha da fonte', () => {
    /** jsdom não implementa matchMedia — injetamos o ponteiro grosso/fino. */
    function setCoarsePointer(coarse: boolean): void {
      Object.defineProperty(window, 'matchMedia', {
        value: () => ({ matches: coarse }) as MediaQueryList,
        configurable: true,
        writable: true,
      });
    }

    afterEach(() => {
      Reflect.deleteProperty(window, 'matchMedia');
    });

    function slotButton(fixture: ReturnType<typeof makeFixture>): HTMLButtonElement {
      const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button[aria-label="Enviar foto: Frente"]',
      );
      if (!el) throw new Error('slot button not found');
      return el;
    }

    function pickers(fixture: ReturnType<typeof makeFixture>) {
      const root = fixture.nativeElement as HTMLElement;
      const inputs = root.querySelectorAll<HTMLInputElement>('input[type=file]');
      return { camera: inputs[0], gallery: inputs[1] };
    }

    it('em tela de toque abre a folha com os dois botões rotulados', () => {
      setCoarsePointer(true);
      const fixture = makeFixture();
      slotButton(fixture).click();
      fixture.detectChanges();

      const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role=dialog]');
      expect(dialog).toBeTruthy();
      const labels = Array.from(dialog?.querySelectorAll('button') ?? []).map((b) =>
        b.textContent?.trim(),
      );
      expect(labels).toContain('Tirar foto');
      expect(labels).toContain('Escolher da galeria');
      expect(dialog?.getAttribute('aria-label')).toBe('Enviar foto: Frente');
    });

    it('"Tirar foto" dispara o input com capture; "Escolher da galeria" o input sem capture', () => {
      setCoarsePointer(true);
      const fixture = makeFixture();
      const { camera, gallery } = pickers(fixture);
      expect(camera.getAttribute('capture')).toBe('environment');
      expect(gallery.hasAttribute('capture')).toBe(false);
      const cameraClick = vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      const galleryClick = vi.spyOn(gallery, 'click').mockImplementation(() => undefined);

      slotButton(fixture).click();
      fixture.detectChanges();
      const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role=dialog]');
      const buttons = Array.from(dialog?.querySelectorAll('button') ?? []);
      buttons[0].click();
      expect(cameraClick).toHaveBeenCalledOnce();
      expect(api(fixture).pending).toBe('FRONT');

      fixture.detectChanges();
      slotButton(fixture).click();
      fixture.detectChanges();
      const reopened = (fixture.nativeElement as HTMLElement).querySelector('[role=dialog]');
      Array.from(reopened?.querySelectorAll('button') ?? [])[1].click();
      expect(galleryClick).toHaveBeenCalledOnce();
    });

    it('devolve o foco ao slot antes de abrir o diálogo nativo (câmera e galeria)', () => {
      setCoarsePointer(true);
      const fixture = makeFixture();
      const { camera, gallery } = pickers(fixture);
      vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      vi.spyOn(gallery, 'click').mockImplementation(() => undefined);
      const trigger = slotButton(fixture);
      const focusSpy = vi.spyOn(trigger, 'focus');

      trigger.click();
      fixture.detectChanges();
      const sheetButtons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          '[role=dialog] button',
        ),
      );
      sheetButtons[0].click();
      expect(focusSpy).toHaveBeenCalledTimes(1);

      fixture.detectChanges();
      trigger.click();
      fixture.detectChanges();
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          '[role=dialog] button',
        ),
      )[1].click();
      expect(focusSpy).toHaveBeenCalledTimes(2);
    });

    it('o Tab circula dentro da folha e o card fica inert', () => {
      setCoarsePointer(true);
      const fixture = makeFixture();
      const root = fixture.nativeElement as HTMLElement;
      slotButton(fixture).click();
      fixture.detectChanges();

      expect(root.querySelector('app-page-card')?.hasAttribute('inert')).toBe(true);

      const [first, , last] = Array.from(
        root.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
      );
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(first);

      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
      expect(document.activeElement).toBe(last);
    });

    it('no desktop abre direto o seletor de arquivos, sem folha', () => {
      setCoarsePointer(false);
      const fixture = makeFixture();
      const { camera, gallery } = pickers(fixture);
      const cameraClick = vi.spyOn(camera, 'click').mockImplementation(() => undefined);
      const galleryClick = vi.spyOn(gallery, 'click').mockImplementation(() => undefined);

      slotButton(fixture).click();
      fixture.detectChanges();

      expect(api(fixture).sourceSheetOpen()).toBe(false);
      expect(galleryClick).toHaveBeenCalledOnce();
      expect(cameraClick).not.toHaveBeenCalled();
    });
  });
});
