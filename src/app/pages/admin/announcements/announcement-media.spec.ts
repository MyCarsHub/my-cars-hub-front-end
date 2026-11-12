import { HttpEventType, HttpResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../../services/notification.service';
import { AdminAnnouncement, AnnouncementRequest } from '../../../types/announcement.types';
import { AdminAnnouncements } from './admin-announcements';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { formatBytes, mediaKindOf, validateAnnouncementMedia } from './announcement-media-file';

const MB = 1024 * 1024;

/** Arquivo com tamanho declarado, sem alocar os bytes. */
function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function ann(extra: Partial<AdminAnnouncement> = {}): AdminAnnouncement {
  return {
    id: 'd1',
    title: 'Rascunho X',
    body: 'Texto.',
    items: [],
    linkUrl: null,
    linkLabel: null,
    audiences: [],
    status: 'DRAFT',
    startsOn: null,
    endsOn: null,
    publishedAt: null,
    endedAt: null,
    createdDate: null,
    modifyDate: null,
    readCount: 0,
    mediaType: null,
    mediaUrl: null,
    mediaContentType: null,
    mediaSizeBytes: null,
    mediaWidth: null,
    mediaHeight: null,
    ...extra,
  };
}

const withImage = (extra: Partial<AdminAnnouncement> = {}) =>
  ann({
    mediaType: 'IMAGE',
    mediaUrl: 'https://cdn.test/a.webp?token=1',
    mediaContentType: 'image/webp',
    mediaSizeBytes: 412 * 1024,
    mediaWidth: 1600,
    mediaHeight: 900,
    ...extra,
  });

describe('Validação da mídia na hora de escolher', () => {
  it('aceita JPG, PNG, WEBP e MP4 dentro dos limites', () => {
    expect(validateAnnouncementMedia(file('a.jpg', 'image/jpeg', 2 * MB))).toBeNull();
    expect(validateAnnouncementMedia(file('a.png', 'image/png', 5 * MB))).toBeNull();
    expect(validateAnnouncementMedia(file('a.webp', 'image/webp', MB))).toBeNull();
    expect(validateAnnouncementMedia(file('a.mp4', 'video/mp4', 25 * MB))).toBeNull();
    // Sem `type` (alguns aparelhos): vale a extensão.
    expect(mediaKindOf(file('a.MP4', '', MB))?.type).toBe('VIDEO');
  });

  it('recusa formato, tamanho e arquivo vazio com mensagem em pt-BR', () => {
    expect(validateAnnouncementMedia(file('tela.gif', 'image/gif', MB))).toBe(
      'Esse formato não é aceito. Envie JPG, PNG, WEBP ou MP4.',
    );
    expect(validateAnnouncementMedia(file('a.mov', 'video/quicktime', MB))).toContain('formato não é aceito');
    expect(validateAnnouncementMedia(file('foto.png', 'image/png', 9.2 * MB))).toBe(
      'A imagem tem 9,2 MB. O limite é 5 MB.',
    );
    expect(validateAnnouncementMedia(file('v.mp4', 'video/mp4', 30 * MB))).toBe('O vídeo tem 30 MB. O limite é 25 MB.');
    expect(validateAnnouncementMedia(file('a.png', 'image/png', 0))).toBe('O arquivo está vazio. Escolha outro.');
    expect(formatBytes(412 * 1024)).toBe('412 KB');
  });
});

type Svc = Record<keyof AdminAnnouncementsService, ReturnType<typeof vi.fn>>;

describe('Folha da novidade: mídia', () => {
  let service: Svc;
  let uploads: Subject<unknown>;
  let aborted: Mock<() => void>;
  let rows: AdminAnnouncement[];

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    aborted = vi.fn<() => void>();
    rows = [ann(), withImage({ id: 'e1', title: 'Velha', status: 'EXPIRED' })];
    service = {
      list: vi.fn(() => of(rows)),
      get: vi.fn(),
      create: vi.fn((req: AnnouncementRequest) => of(ann({ ...req, id: 'n1' }))),
      update: vi.fn((id: string, req: AnnouncementRequest) => of(ann({ ...req, id }))),
      publish: vi.fn(),
      unpublish: vi.fn(),
      delete: vi.fn(),
      uploadMedia: vi.fn(
        () =>
          new Observable((sub) => {
            uploads = new Subject();
            const inner = uploads.subscribe(sub);
            return () => {
              inner.unsubscribe();
              aborted();
            };
          }),
      ),
      removeMedia: vi.fn((id: string) => of(ann({ id }))),
    } as unknown as Svc;
    TestBed.configureTestingModule({
      imports: [AdminAnnouncements],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AdminAnnouncementsService, useValue: service },
        { provide: NotificationService, useValue: { push: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

  function render(): ComponentFixture<AdminAnnouncements> {
    const f = TestBed.createComponent(AdminAnnouncements);
    f.detectChanges();
    return f;
  }

  function type(sel: string, value: string, f: ComponentFixture<unknown>): void {
    const input = $(sel) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function pick(f: ComponentFixture<unknown>, chosen: File, sel = '[data-testid="media-input"]'): void {
    const input = $(sel) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [chosen], configurable: true });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  function openRow(f: ComponentFixture<unknown>, index: number, item: string): void {
    const rowsEl = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="announcement-row"]'));
    rowsEl[index].querySelector<HTMLButtonElement>('app-actions-menu button')!.click();
    f.detectChanges();
    ($(`[data-testid="${item}"]`) as HTMLElement).click();
    f.detectChanges();
  }

  it('nova: arquivo recusado na hora não envia nada', () => {
    const f = render();
    ($('[data-testid="create-announcement"]') as HTMLElement).click();
    f.detectChanges();
    pick(f, file('tela.gif', 'image/gif', MB));
    expect($('[data-testid="media-error"]')?.textContent).toContain('Esse formato não é aceito');
    expect(service.uploadMedia).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('nova: cria o rascunho, envia com progresso, mostra a prévia e guarda o id para publicar', () => {
    const f = render();
    ($('[data-testid="create-announcement"]') as HTMLElement).click();
    f.detectChanges();
    // Sem título/texto ainda: pede para preencher antes.
    pick(f, file('tela-gastos.webp', 'image/webp', MB));
    expect($('[data-testid="media-error"]')?.textContent).toContain('Preencha o título e o texto');
    expect(service.create).not.toHaveBeenCalled();

    type('[data-testid="field-title"]', 'Gastos', f);
    type('[data-testid="field-body"]', 'Agora dá.', f);
    pick(f, file('tela-gastos.webp', 'image/webp', MB), '[data-testid="media-input"]');
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.uploadMedia).toHaveBeenCalledWith('n1', expect.any(File));
    expect($('[data-testid="media-uploading"]')).not.toBeNull();
    // Enviando: salvar/publicar esperam; a prévia mostra o esqueleto.
    expect(($('[data-testid="sheet-save-draft"]') as HTMLButtonElement).disabled).toBe(true);
    expect($('[data-testid="announcement-preview"] [data-testid="media-skeleton"]')).not.toBeNull();

    uploads.next({ type: HttpEventType.UploadProgress, loaded: 62, total: 100 });
    f.detectChanges();
    expect($('[data-testid="media-progress"]')?.getAttribute('aria-valuenow')).toBe('62');
    expect($('[data-testid="media-progress-label"]')?.textContent?.trim()).toBe('62%');

    uploads.next(new HttpResponse({ body: withImage({ id: 'n1', title: 'Gastos' }) }));
    f.detectChanges();
    expect($('[data-testid="media-uploading"]')).toBeNull();
    expect($('[data-testid="media-ready"]')?.getAttribute('data-type')).toBe('IMAGE');
    expect($('[data-testid="media-meta"]')?.textContent?.trim()).toBe('WEBP · 1600 × 900 · 412 KB');
    expect($('[data-testid="announcement-preview"] [data-testid="media-image"]')?.getAttribute('src')).toBe(
      'https://cdn.test/a.webp?token=1',
    );

    // Salvar depois atualiza o MESMO rascunho.
    ($('[data-testid="sheet-save-draft"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledWith('n1', expect.objectContaining({ title: 'Gastos' }));
  });

  it('cancelar aborta o envio e volta ao campo vazio', () => {
    const f = render();
    openRow(f, 0, 'menu-edit');
    pick(f, file('v.mp4', 'video/mp4', 8 * MB));
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.uploadMedia).toHaveBeenCalledWith('d1', expect.any(File));
    ($('[data-testid="media-cancel"]') as HTMLElement).click();
    f.detectChanges();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect($('[data-testid="media-uploading"]')).toBeNull();
    expect($('[data-testid="media-dropzone"]')).not.toBeNull();
  });

  it('trocar e remover numa que já tem mídia', () => {
    rows = [withImage(), withImage({ id: 'e1', title: 'Velha', status: 'EXPIRED' })];
    const f = render();
    openRow(f, 0, 'menu-edit');
    expect($('[data-testid="media-ready"]')).not.toBeNull();
    expect($('[data-testid="media-meta"]')?.textContent?.trim()).toBe('WEBP · 1600 × 900 · 412 KB');

    pick(f, file('novo.mp4', 'video/mp4', 8 * MB), '[data-testid="media-replace"]');
    expect(service.uploadMedia).toHaveBeenCalledWith('d1', expect.any(File));
    uploads.next(
      new HttpResponse({
        body: ann({ mediaType: 'VIDEO', mediaUrl: 'https://cdn.test/v.mp4', mediaContentType: 'video/mp4', mediaSizeBytes: 8 * MB, mediaWidth: 1920, mediaHeight: 1080 }),
      }),
    );
    f.detectChanges();
    expect($('[data-testid="media-ready"]')?.getAttribute('data-type')).toBe('VIDEO');
    expect($('[data-testid="media-meta"]')?.textContent?.trim()).toBe('MP4 · 8 MB · deitado');

    ($('[data-testid="media-remove"]') as HTMLElement).click();
    f.detectChanges();
    expect(service.removeMedia).toHaveBeenCalledWith('d1');
    expect($('[data-testid="media-ready"]')).toBeNull();
    expect($('[data-testid="media-dropzone"]')).not.toBeNull();
  });

  it('encerrada: só remover (sem trocar nem escolher)', () => {
    const f = render();
    openRow(f, 1, 'menu-view');
    expect($('[data-testid="media-ready"]')).not.toBeNull();
    expect($('[data-testid="media-replace"]')).toBeNull();
    expect($('[data-testid="media-input"]')).toBeNull();
    ($('[data-testid="media-remove"]') as HTMLElement).click();
    f.detectChanges();
    expect(service.removeMedia).toHaveBeenCalledWith('e1');
    expect(service.uploadMedia).not.toHaveBeenCalled();
    expect($('[data-testid="media-none"]')).not.toBeNull();
  });
});
