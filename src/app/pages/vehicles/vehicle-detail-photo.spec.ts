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
 * A foto no detalhe do veículo. Sai do anexo PHOTO, da lista que o card de
 * documentos já carrega: nada de endpoint novo e nada de segundo GET. Enviar ou
 * remover no slot atualiza o quadro do cabeçalho na mesma tela.
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
            getOne: () => of(vehicle),
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

  beforeEach(() => {
    listDocuments = vi.fn(() => of([doc('foto', 'PHOTO')]));
    documentSignedUrl = vi.fn(() => of({ url: 'https://cdn.test/foto.jpg', expiresInSeconds: 300 }));
    uploadDocument = vi.fn(() => of(doc('nova', 'PHOTO')));
    deleteDocument = vi.fn(() => of(void 0));
    previewOpen = vi.fn();
    claim = vi.fn();
  });

  it('mostra a foto gravada, com a URL assinada do anexo PHOTO', async () => {
    await setup();

    expect(documentSignedUrl).toHaveBeenCalledWith(VEHICLE_ID, 'foto');
    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/foto.jpg');
    expect(fallbackIcon()).toBeNull();
  });

  it('não faz um segundo GET de documentos: usa a lista do card', async () => {
    await setup();

    expect(listDocuments).toHaveBeenCalledTimes(1);
  });

  it('veículo sem foto mantém o ícone e não assina nada', async () => {
    listDocuments.mockReturnValue(of([doc('crlv', 'CRLV')]));
    await setup();

    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
    expect(documentSignedUrl).not.toHaveBeenCalled();
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

  it('assinatura recusada volta ao ícone e o erro é reivindicado, sem toast de sobra', async () => {
    const err = new HttpErrorResponse({ status: 404 });
    documentSignedUrl.mockReturnValue(throwError(() => err));
    await setup();

    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
    expect(claim).toHaveBeenCalledWith(err);
  });

  it('tocar abre o visualizador do app e pede uma URL NOVA (a da tela pode ter vencido)', async () => {
    await setup();
    documentSignedUrl.mockClear();
    documentSignedUrl.mockReturnValue(of({ url: 'https://cdn.test/nova.jpg', expiresInSeconds: 300 }));

    photoButton()?.click();

    expect(previewOpen).toHaveBeenCalledTimes(1);
    const request = previewOpen.mock.calls[0][0] as { source: () => unknown; title: string };
    expect(request.title).toBe('Foto do veículo');
    expect(documentSignedUrl).not.toHaveBeenCalled();

    const source = request.source();
    if (!isObservable(source)) throw new Error('a origem deveria ser o carregador da URL');
    await expect(firstValueFrom(source)).resolves.toMatchObject({ url: 'https://cdn.test/nova.jpg' });
    expect(documentSignedUrl).toHaveBeenCalledWith(VEHICLE_ID, 'foto');
  });

  it('o botão tem nome acessível com a placa e a imagem é decorativa', async () => {
    await setup();

    expect(photoButton()?.getAttribute('aria-label')).toBe('Ampliar a foto do veículo ABC-1D23');
    expect(photoImg()?.getAttribute('alt')).toBe('');
  });

  it('remover a foto no card de documentos tira o quadro do cabeçalho', async () => {
    await setup();
    expect(photoButton()).not.toBeNull();

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

    expect(deleteDocument).toHaveBeenCalledWith(VEHICLE_ID, 'foto');
    expect(photoButton()).toBeNull();
    expect(fallbackIcon()).not.toBeNull();
  });

  it('enviar a foto no card de documentos faz ela aparecer no cabeçalho', async () => {
    listDocuments.mockReturnValue(of([]));
    await setup();
    expect(photoButton()).toBeNull();

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

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(documentSignedUrl).toHaveBeenCalledWith(VEHICLE_ID, 'nova');
    expect(photoImg()?.getAttribute('src')).toBe('https://cdn.test/foto.jpg');
  });
});
