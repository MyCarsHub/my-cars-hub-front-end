import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { firstValueFrom, isObservable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleDetail } from './vehicle-detail';
import { DocumentPreviewService } from '../../components/document-preview/document-preview.service';
import { ApiErrorService } from '../../services/api-error.service';
import { ImageCompressionService } from '../../services/image-compression.service';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import type { Vehicle, VehicleDocument } from '../../types/vehicle.types';

/**
 * A foto no detalhe do veículo é a mesma da lista: o backend resolve (o anexo
 * PHOTO, senão a frente da última vistoria aprovada) e a tela só mostra. A lista
 * do card de documentos serve de aviso: enviar ou remover no slot pergunta de
 * novo ao backend.
 */
describe('VehicleDetail — foto do veículo', () => {
  const VEHICLE_ID = 'veh-1';

  const vehicle = {
    id: VEHICLE_ID,
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearManufacture: 2022,
    yearModel: 2022,
    hodometer: 10_000,
    status: 'AVAILABLE',
    sale: null,
  } as unknown as Vehicle;

  const doc = (id: string, kind: VehicleDocument['kind']): VehicleDocument => ({
    id,
    vehicleId: VEHICLE_ID,
    kind,
    kindLabel: kind,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    uploadedBy: null,
    createdDate: '2026-10-29T10:00:00',
  });

  const withPhoto = (
    url: string | null,
    source: Vehicle['photoSource'] = url ? 'VEHICLE' : null,
  ): Vehicle => ({ ...vehicle, photoUrl: url, photoSource: source });

  let getOne: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let listDocuments: ReturnType<typeof vi.fn>;
  let documentSignedUrl: ReturnType<typeof vi.fn>;
  let uploadDocument: ReturnType<typeof vi.fn>;
  let deleteDocument: ReturnType<typeof vi.fn>;
  let previewOpen: ReturnType<typeof vi.fn>;
  let claim: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<VehicleDetail>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const photoButton = () => host().querySelector<HTMLButtonElement>('[data-vehicle-detail-photo]');
  const photoImg = () => host().querySelector<HTMLImageElement>('[data-vehicle-detail-photo-img]');
  const skeleton = () => host().querySelector('[data-vehicle-detail-photo-skeleton]');
  /** O ícone laranja do cabeçalho: é para ele que a tela volta sem foto. */
  const fallbackIcon = () => host().querySelector('.bg-primary-500.shadow-inner');

  function photoSlotButton(): HTMLButtonElement {
    const button = host().querySelector<HTMLButtonElement>('[data-kind="PHOTO"] > button');
    if (!button) throw new Error('o slot da foto não está na tela');
    return button;
  }

  function button(label: string, root: ParentNode = host()): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    if (!found) throw new Error(`o botão "${label}" não está na tela`);
    return found;
  }

  async function setup(): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID } } } },
        {
          provide: VehiclesService,
          useValue: {
            getOne,
            updateStatus,
            listDocuments,
            documentSignedUrl,
            uploadDocument,
            deleteDocument,
          },
        },
        { provide: DocumentPreviewService, useValue: { open: previewOpen } },
        { provide: ImageCompressionService, useValue: { compress: (f: File) => Promise.resolve(f) } },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: { claim, messageFor: (_: unknown, fallback?: string) => fallback ?? '' },
        },
      ],
    });
    fixture = TestBed.createComponent(VehicleDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Remove o anexo pela linha do slot, passando pelo diálogo real. */
  function removePhotoInTheSlot(): void {
    const row = host().querySelector<HTMLElement>('[data-kind="PHOTO"] [data-file-row]');
    if (!row) throw new Error('a linha do arquivo não está na tela');
    button('Remover', row).click();
    fixture.detectChanges();
    const dialog = Array.from(host().querySelectorAll('app-confirm-dialog')).find((d) =>
      (d.textContent ?? '').includes('será apagado do armazenamento'),
    );
    if (!dialog) throw new Error('o diálogo de remover não abriu');
    button('Remover', dialog).click();
    fixture.detectChanges();
  }

  async function uploadPhotoInTheSlot(): Promise<void> {
    photoSlotButton().click();
    fixture.detectChanges();
    const input = host().querySelector<HTMLInputElement>('app-documents-card input[type="file"]');
    if (!input) throw new Error('o seletor de arquivos não está na tela');
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'carro.jpg', { type: 'image/jpeg' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    getOne = vi.fn(() => of(withPhoto('https://cdn.test/foto.jpg')));
    updateStatus = vi.fn(() => of({ ...vehicle, status: 'MAINTENANCE' }));
    listDocuments = vi.fn(() => of([doc('foto', 'PHOTO')]));
    documentSignedUrl = vi.fn(() => of({ url: 'https://cdn.test/assinada.jpg', expiresInSeconds: 300 }));
    uploadDocument = vi.fn(() => of(doc('nova', 'PHOTO')));
    deleteDocument = vi.fn(() => of(void 0));
    previewOpen = vi.fn();
    claim = vi.fn();
  });

  it('pede a foto ao backend e mostra a URL que ele resolveu', async () => {
    await setup();

    expect(getOne).toHaveBeenCalledWith(VEHICLE_ID, { includePhoto: true });
    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/foto.jpg');
    expect(photoButton()?.getAttribute('data-photo-source')).toBe('VEHICLE');
    expect(fallbackIcon()).toBeNull();
  });

  it('a primeira lista de documentos não pergunta de novo: o GET acabou de responder', async () => {
    await setup();

    expect(getOne).toHaveBeenCalledTimes(1);
    expect(listDocuments).toHaveBeenCalledTimes(1);
    expect(documentSignedUrl).not.toHaveBeenCalled();
  });

  it('veículo sem foto mantém o ícone', async () => {
    getOne.mockReturnValue(of(withPhoto(null)));
    listDocuments.mockReturnValue(of([doc('crlv', 'CRLV')]));
    await setup();

    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
  });

  it('o esqueleto fica até a imagem carregar e então sai', async () => {
    await setup();

    expect(skeleton()).not.toBeNull();
    expect(photoImg()?.className).toContain('opacity-0');

    photoImg()?.dispatchEvent(new Event('load'));
    fixture.detectChanges();

    expect(skeleton()).toBeNull();
    expect(photoImg()?.className).not.toContain('opacity-0');
  });

  it('imagem que não baixa volta ao ícone, sem quadro quebrado', async () => {
    await setup();

    photoImg()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
  });

  it('tocar abre o visualizador do app e pede uma URL NOVA (a da tela pode ter vencido)', async () => {
    await setup();
    getOne.mockClear();
    getOne.mockReturnValue(of(withPhoto('https://cdn.test/nova.jpg')));

    photoButton()?.click();

    expect(previewOpen).toHaveBeenCalledTimes(1);
    const request = previewOpen.mock.calls[0][0] as {
      source: () => unknown;
      title: string;
      fileName: string;
    };
    expect(request.title).toBe('Foto do veículo');
    expect(request.fileName).toBe('foto.jpg');
    expect(getOne).not.toHaveBeenCalled();

    const source = request.source();
    if (!isObservable(source)) throw new Error('a origem deveria ser o carregador da URL');
    await expect(firstValueFrom(source)).resolves.toMatchObject({ url: 'https://cdn.test/nova.jpg' });
    expect(getOne).toHaveBeenCalledWith(VEHICLE_ID, { includePhoto: true });
  });

  it('o visualizador falha, em vez de abrir vazio, se a foto sumiu nesse meio-tempo', async () => {
    await setup();
    getOne.mockReturnValue(of(withPhoto(null)));

    photoButton()?.click();

    const request = previewOpen.mock.calls[0][0] as { source: () => unknown };
    const source = request.source();
    if (!isObservable(source)) throw new Error('a origem deveria ser o carregador da URL');
    await expect(firstValueFrom(source)).rejects.toThrow();
  });

  it('o botão tem nome acessível com a placa e a imagem é decorativa', async () => {
    await setup();

    expect(photoButton()?.getAttribute('aria-label')).toBe('Ampliar a foto do veículo ABC-1D23');
    expect(photoImg()?.getAttribute('alt')).toBe('');
  });

  it('venda e status respondem sem foto, e isso não apaga o quadro', async () => {
    await setup();

    (
      fixture.componentInstance as unknown as {
        transitionStatus: (t: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE') => void;
      }
    ).transitionStatus('MAINTENANCE');
    fixture.detectChanges();

    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/foto.jpg');
  });

  describe('sem anexo PHOTO, a frente da vistoria', () => {
    const FRONT = 'https://cdn.test/frente.jpg';

    beforeEach(() => {
      getOne.mockReturnValue(of(withPhoto(FRONT, 'INSPECTION')));
      listDocuments.mockReturnValue(of([doc('crlv', 'CRLV')]));
    });

    it('mostra a mesma foto da lista, com a origem marcada', async () => {
      await setup();

      expect(photoImg()?.getAttribute('src')).toBe(FRONT);
      expect(photoButton()?.getAttribute('data-photo-source')).toBe('INSPECTION');
      expect(fallbackIcon()).toBeNull();
    });

    it('não diz que é um anexo: nome acessível e título falam da vistoria', async () => {
      await setup();

      expect(photoButton()?.getAttribute('aria-label')).toBe(
        'Ampliar a foto da vistoria do veículo ABC-1D23',
      );
      photoButton()?.click();

      const request = previewOpen.mock.calls[0][0] as { title: string; fileName: string };
      expect(request.title).toBe('Frente da última vistoria aprovada');
      expect(request.fileName).toBe('foto-ABC-1D23');
    });

    it('ampliar não usa endpoint de anexo: não existe documento para assinar', async () => {
      await setup();
      getOne.mockClear();

      photoButton()?.click();
      const request = previewOpen.mock.calls[0][0] as { source: () => unknown };
      const source = request.source();
      if (!isObservable(source)) throw new Error('a origem deveria ser o carregador da URL');
      await expect(firstValueFrom(source)).resolves.toMatchObject({ url: FRONT });

      expect(getOne).toHaveBeenCalledWith(VEHICLE_ID, { includePhoto: true });
      expect(documentSignedUrl).not.toHaveBeenCalled();
    });

    it('nada de remover ou trocar: no slot PHOTO só há o convite para anexar', async () => {
      await setup();

      expect(host().querySelector('[data-kind="PHOTO"] [data-file-row]')).toBeNull();
      expect(photoSlotButton()).not.toBeNull();
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(photoButton()?.parentElement?.querySelectorAll('button')).toHaveLength(1);
    });

    it('enviar um anexo tira a frente da vistoria do quadro', async () => {
      await setup();
      getOne.mockReturnValue(of(withPhoto('https://cdn.test/nova.jpg')));

      await uploadPhotoInTheSlot();

      expect(uploadDocument).toHaveBeenCalledTimes(1);
      expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/nova.jpg');
      expect(photoButton()?.getAttribute('data-photo-source')).toBe('VEHICLE');
    });
  });

  it('remover o anexo revela a frente da vistoria, quando o backend tem uma', async () => {
    await setup();
    getOne.mockReturnValue(of(withPhoto('https://cdn.test/frente.jpg', 'INSPECTION')));

    removePhotoInTheSlot();

    expect(deleteDocument).toHaveBeenCalledWith(VEHICLE_ID, 'foto');
    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/frente.jpg');
    expect(photoButton()?.getAttribute('data-photo-source')).toBe('INSPECTION');
  });

  it('remover o anexo sem vistoria aprovada tira o quadro do cabeçalho', async () => {
    await setup();
    expect(photoButton()).not.toBeNull();
    getOne.mockReturnValue(of(withPhoto(null)));

    removePhotoInTheSlot();

    expect(deleteDocument).toHaveBeenCalledWith(VEHICLE_ID, 'foto');
    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
  });

  it('enviar a foto no card de documentos faz ela aparecer no cabeçalho', async () => {
    getOne.mockReturnValue(of(withPhoto(null)));
    listDocuments.mockReturnValue(of([]));
    await setup();
    expect(photoButton()).toBeNull();
    getOne.mockReturnValue(of(withPhoto('https://cdn.test/nova.jpg')));

    await uploadPhotoInTheSlot();

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/nova.jpg');
  });

  it('foto que falhou volta a aparecer quando o anexo muda', async () => {
    await setup();
    photoImg()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(photoButton()).toBeNull();
    getOne.mockReturnValue(of(withPhoto('https://cdn.test/nova.jpg')));

    removePhotoInTheSlot();
    await uploadPhotoInTheSlot();

    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/nova.jpg');
  });

  it('se a nova consulta falha, o quadro sai e o erro é reivindicado, sem toast de sobra', async () => {
    await setup();
    const err = new HttpErrorResponse({ status: 404 });
    getOne.mockReturnValue(throwError(() => err));

    removePhotoInTheSlot();

    expect(claim).toHaveBeenCalledWith(err);
    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
  });
});
